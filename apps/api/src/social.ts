import { Router } from "express";
import multer from "multer";
import { fileTypeFromFile } from "file-type";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { pool, tx, lockPair, HttpError } from "./db.js";
import { requireAdmin, requireCompany } from "./auth.js";
import { storeFile, sendStored, deferDelete, checkQuota } from "./storage.js";

const uuid = z.string().uuid();
const cursor = z.string().regex(/^[1-9][0-9]{0,18}$/);
const visible = `($1::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=p.company_id) OR (b.blocked_id=$1 AND b.blocker_id=p.company_id)))`;
const projection = `SELECT p.*,row_to_json(c) AS company,u.name AS author_name,
  (SELECT count(*)::int FROM post_likes l WHERE l.post_id=p.id) AS like_count,
  (SELECT count(*)::int FROM post_comments cm WHERE cm.post_id=p.id) AS comment_count,
  EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.company_id=$1) AS liked,
  EXISTS(SELECT 1 FROM company_follows f WHERE f.follower_id=$1 AND f.followed_id=p.company_id) AS following,
  COALESCE((SELECT json_agg(json_build_object('id',m.id,'name',m.original_name,'mime',m.mime_type,'size',m.size,'alt',m.alt,'url','/api/post-media/'||m.id) ORDER BY m.position) FROM post_media m WHERE m.post_id=p.id),'[]') AS media
  FROM posts p JOIN companies c ON c.id=p.company_id JOIN users u ON u.id=p.author_id`;
async function getPost(id: string, actor: string | null) {
  const r = await pool.query(`${projection} WHERE p.id=$2 AND ${visible}`, [
    actor,
    id,
  ]);
  if (!r.rows[0]) throw new HttpError(404, "Post not found.");
  return r.rows[0];
}
export async function socialRoutes(uploadDir: string) {
  const router = Router();
  const mediaDir = path.join(uploadDir, "posts");
  await fs.mkdir(mediaDir, { recursive: true });
  const staging = path.join(uploadDir, ".staging");
  await fs.mkdir(staging, {recursive:true});
  const upload = multer({
    storage: multer.diskStorage({
      destination: staging,
      filename: (_r, _f, cb) => cb(null, randomUUID()),
    }),
    limits: {
      files: 4,
      fileSize: 100 * 1024 * 1024,
      fields: 2,
      fieldSize: 20000,
    },
  });
  router.get("/feed", async (req, res) => {
    const actor = req.auth?.companyId || null;
    const scope = z.enum(["all", "following"]).parse(req.query.scope || "all");
    const company = req.query.companyId
      ? uuid.parse(req.query.companyId)
      : null;
    const before = req.query.before ? cursor.parse(req.query.before) : null;
    if (scope === "following" && !actor)
      throw new HttpError(
        401,
        "Sign in with your company to see its following feed.",
      );
    const { rows } = await pool.query(
      `${projection} WHERE ${visible} AND ($2::uuid IS NULL OR p.company_id=$2)
    AND ($3::bigint IS NULL OR p.sequence<$3) AND ($4='all' OR p.company_id=$1 OR EXISTS(SELECT 1 FROM company_follows f WHERE f.follower_id=$1 AND f.followed_id=p.company_id))
    ORDER BY p.sequence DESC LIMIT 21`,
      [actor, company, before, scope],
    );
    res.json({
      posts: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? rows[19].sequence : null,
    });
  });
  router.get("/social/suggestions", async (req, res) => {
    const actor = req.auth?.companyId || null;
    const { rows } = await pool.query(
      `SELECT c.*,(SELECT count(*)::int FROM company_follows f WHERE f.followed_id=c.id) AS followers
     FROM companies c WHERE ($1::uuid IS NULL OR c.id<>$1) AND NOT EXISTS(SELECT 1 FROM company_follows f WHERE f.follower_id=$1 AND f.followed_id=c.id)
     AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=c.id) OR (b.blocked_id=$1 AND b.blocker_id=c.id)) ORDER BY followers DESC,c.name LIMIT 5`,
      [actor],
    );
    res.json(rows);
  });
  router.get("/social/companies/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth?.companyId || null;
    const { rows } = await pool.query(
      `SELECT (SELECT count(*)::int FROM company_follows WHERE followed_id=c.id) AS followers,
    (SELECT count(*)::int FROM company_follows WHERE follower_id=c.id) AS following_count,
    (SELECT count(*)::int FROM posts WHERE company_id=c.id) AS post_count,
    EXISTS(SELECT 1 FROM company_follows WHERE follower_id=$1 AND followed_id=c.id) AS following,
    EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=c.id) OR (blocked_id=$1 AND blocker_id=c.id)) AS blocked
    FROM companies c WHERE c.id=$2`,
      [actor, id],
    );
    if (!rows[0]) throw new HttpError(404, "Company not found.");
    res.json(rows[0]);
  });
  router.post(
    "/social/companies/:id/follow",
    requireAdmin,
    async (req, res) => {
      const id = uuid.parse(req.params.id),
        actor = req.auth!.companyId!;
      const { following } = z
        .object({ following: z.boolean() })
        .parse(req.body);
      if (id === actor)
        throw new HttpError(400, "You cannot follow your own company.");
      await tx(async (db) => {
        await lockPair(db, actor, id);
        if (
          !(await db.query("SELECT 1 FROM companies WHERE id=$1", [id]))
            .rowCount
        )
          throw new HttpError(404, "Company not found.");
        if (following) {
          if (
            (
              await db.query(
                "SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocked_id=$1 AND blocker_id=$2)",
                [actor, id],
              )
            ).rowCount
          )
            throw new HttpError(403, "This company is unavailable.");
          await db.query(
            "INSERT INTO company_follows(follower_id,followed_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [actor, id],
          );
        } else
          await db.query(
            "DELETE FROM company_follows WHERE follower_id=$1 AND followed_id=$2",
            [actor, id],
          );
      });
      res.json({ following });
    },
  );
  router.post(
    "/posts",
    requireAdmin,
    upload.array("files", 4),
    async (req, res) => {
      const files = (req.files || []) as Express.Multer.File[];
      let committed = false;
      const storedKeys: {key:string; backend:string}[] = [];
      try {
        const body = z
          .string()
          .trim()
          .max(4000)
          .parse(req.body.body || "");
        let alts: string[] = [];
        if (req.body.alts) {
          try {
            alts = z
              .array(z.string().max(250))
              .max(4)
              .parse(JSON.parse(req.body.alts));
          } catch {
            throw new HttpError(400, "Invalid image descriptions.");
          }
        }
        if (!body && !files.length)
          throw new HttpError(
            400,
            "Write something or add a photo, video, or document.",
          );
        const validated: {
          file: Express.Multer.File;
          mime: string;
          alt: string;
        }[] = [];
        for (const [i, file] of files.entries()) {
          const type = await fileTypeFromFile(file.path).catch(() => undefined);
          if (
            !type ||
            ![
              "image/jpeg",
              "image/png",
              "image/webp",
              "video/mp4",
              "video/webm",
              "application/pdf",
            ].includes(type.mime)
          )
            throw new HttpError(
              400,
              "Use JPG, PNG, WebP, MP4, WebM, or PDF files.",
            );
          const limit = type.mime.startsWith("image/")
            ? 10
            : type.mime === "application/pdf"
              ? 20
              : 100;
          if (file.size > limit * 1024 * 1024)
            throw new HttpError(
              400,
              `This ${type.mime.startsWith("image/") ? "photo" : "document"} is too large. Maximum ${limit} MB.`,
            );
          validated.push({ file, mime: type.mime, alt: alts[i] || "" });
        }
        if (
          validated.some((m) => !m.mime.startsWith("image/")) &&
          files.length !== 1
        )
          throw new HttpError(
            400,
            "Add up to 4 photos, or one video or PDF per post.",
          );
        const id = await tx(async (db) => {
          await checkQuota(db, req.auth!.companyId!, files.reduce((sum,f)=>sum+f.size,0));
          const p = (
            await db.query(
              "INSERT INTO posts(company_id,author_id,body) VALUES($1,$2,$3) RETURNING id",
              [req.auth!.companyId, req.auth!.userId, body],
            )
          ).rows[0];
          for (const [i, m] of validated.entries()) {
            const key = "posts/"+m.file.filename;
            storedKeys.push({key,backend:process.env.STORAGE_BACKEND === "s3" ? "s3" : "local"});
            const stored = await storeFile(key,m.file.path,m.mime);
            await db.query(
              "INSERT INTO post_media(post_id,storage_name,original_name,mime_type,size,position,alt,storage_backend,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                p.id,
                m.file.filename,
                m.file.originalname.slice(0, 200),
                m.mime,
                m.file.size,
                i,
                m.alt, stored.storage_backend, stored.sha256,
              ],
            );
          }
          return p.id;
        });
        committed = true;
        res.status(201).json(await getPost(id, req.auth!.companyId));
      } catch (error) {
        if (!committed) await Promise.all(storedKeys.map(f => deferDelete(f.backend,f.key)));
        throw error;
      } finally { await Promise.all(files.map(f => fs.unlink(f.path).catch(() => {}))); }
    },
  );
  router.get("/posts/:id", async (req, res) =>
    res.json(
      await getPost(uuid.parse(req.params.id), req.auth?.companyId || null),
    ),
  );
  router.delete("/posts/:id", requireAdmin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const files = await tx(async (db) => {
      if (
        !(
          await db.query(
            "SELECT 1 FROM posts WHERE id=$1 AND company_id=$2 FOR UPDATE",
            [id, req.auth!.companyId],
          )
        ).rowCount
      )
        throw new HttpError(404, "Post not found.");
      const { rows } = await db.query(
        "SELECT storage_name,storage_backend FROM post_media WHERE post_id=$1",
        [id],
      );
      for (const f of rows) await db.query("INSERT INTO storage_deletions(storage_backend,storage_key) VALUES($1,$2) ON CONFLICT DO NOTHING",[f.storage_backend,"posts/"+f.storage_name]);
      await db.query("DELETE FROM posts WHERE id=$1", [id]);
      return rows;
    });
    res.json({ ok: true });
  });
  router.post("/posts/:id/like", requireCompany, async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth!.companyId!;
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
    await getPost(id, actor);
    if (liked)
      await pool.query(
        "INSERT INTO post_likes(post_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, actor],
      );
    else
      await pool.query(
        "DELETE FROM post_likes WHERE post_id=$1 AND company_id=$2",
        [id, actor],
      );
    res.json(await getPost(id, actor));
  });
  router.get("/posts/:id/comments", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth?.companyId || null;
    await getPost(id, actor);
    const before = req.query.before ? cursor.parse(req.query.before) : null;
    const { rows } = await pool.query(
      `SELECT cm.id,cm.sequence,cm.body,cm.created_at,cm.author_id,u.name AS author_name,row_to_json(c) AS company FROM post_comments cm JOIN companies c ON c.id=cm.company_id JOIN users u ON u.id=cm.author_id
     WHERE cm.post_id=$1 AND ($2::bigint IS NULL OR cm.sequence<$2) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$3 AND b.blocked_id=cm.company_id) OR (b.blocked_id=$3 AND b.blocker_id=cm.company_id)) ORDER BY cm.sequence DESC LIMIT 31`,
      [id, before, actor],
    );
    res.json({
      comments: rows.slice(0, 30).reverse(),
      nextCursor: rows.length > 30 ? rows[29].sequence : null,
    });
  });
  router.post("/posts/:id/comments", requireCompany, async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth!.companyId!;
    const { body } = z
      .object({ body: z.string().trim().min(1).max(1500) })
      .parse(req.body);
    await getPost(id, actor);
    await pool.query(
      "INSERT INTO post_comments(post_id,company_id,author_id,body) VALUES($1,$2,$3,$4)",
      [id, actor, req.auth!.userId, body],
    );
    res.status(201).json(await getPost(id, actor));
  });
  router.delete(
    "/posts/:postId/comments/:id",
    requireCompany,
    async (req, res) => {
      const postId = uuid.parse(req.params.postId),
        id = uuid.parse(req.params.id);
      const isAdmin = ["owner", "admin"].includes(req.auth!.role || "");
      const { rowCount } = await pool.query(
        `DELETE FROM post_comments cm USING posts p WHERE cm.id=$1 AND cm.post_id=$2 AND p.id=cm.post_id AND
     (cm.author_id=$3 AND cm.company_id=$4 OR $5 AND (cm.company_id=$4 OR p.company_id=$4))`,
        [id, postId, req.auth!.userId, req.auth!.companyId, isAdmin],
      );
      if (!rowCount) throw new HttpError(404, "Comment not found.");
      res.json(await getPost(postId, req.auth!.companyId));
    },
  );
  router.get("/post-media/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth?.companyId || null;
    const { rows } = await pool.query(
      `SELECT m.* FROM post_media m JOIN posts p ON p.id=m.post_id WHERE m.id=$2 AND ${visible}`,
      [actor, id],
    );
    const media = rows[0];
    if (!media) throw new HttpError(404, "Attachment not found.");
    res.type(media.mime_type);
    if (media.mime_type === "application/pdf")
      res.attachment(media.original_name);
    await sendStored(req,res,media.storage_backend,"posts/"+media.storage_name);
  });
  return router;
}
