import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { pool, tx, HttpError } from "./db.js";
import { requireAdmin } from "./auth.js";
import { checkQuota, storeFile, deferDelete } from "./storage.js";
import {
  postCaptionDocument,
  publicationKind,
  validateDocument,
} from "./publication-document.js";

const uuid = z.string().uuid();
export function publishingRoutes(uploadDir: string) {
  const router = Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(uploadDir, ".staging"),
      filename: (_r, _f, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 1 },
  });
  router.get("/publications", requireAdmin, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*,(SELECT json_agg(json_build_object('id',m.id,'url','/api/post-media/'||m.id,'mime',m.mime_type,'alt',m.alt,'name',m.original_name) ORDER BY m.position) FROM post_media m WHERE m.post_id=p.id) AS media FROM posts p WHERE company_id=$1 AND status='draft' ORDER BY updated_at DESC LIMIT 100`,
      [req.auth!.companyId],
    );
    res.json(rows);
  });
  router.post("/publications", requireAdmin, async (req, res) => {
    const { kind } = z
      .object({ kind: publicationKind.default("post") })
      .parse(req.body);
    const { rows } = await pool.query(
      "INSERT INTO posts(company_id,author_id,status,kind) VALUES($1,$2,'draft',$3) RETURNING *",
      [
        req.auth!.companyId,
        req.auth!.userId,
        kind === "post" ? "post" : "press_release",
      ],
    );
    res.status(201).json({ ...rows[0], media: [] });
  });
  router.patch("/publications/:id", requireAdmin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z
      .object({
        kind: publicationKind,
        title: z.string().trim().max(180).default(""),
        subtitle: z.string().trim().max(300).default(""),
        body: z.string().trim().max(50000).default(""),
        document: z.any().optional(),
        status: z.enum(["draft", "published"]),
        version: z.number().int().positive(),
        coverMediaId: uuid.nullable().default(null),
      })
      .parse(req.body);
    const doc = validateDocument(b.document);
    const result = await tx(async (db) => {
      const current = (
        await db.query(
          "SELECT * FROM posts WHERE id=$1 AND company_id=$2 FOR UPDATE",
          [id, req.auth!.companyId],
        )
      ).rows[0];
      if (!current) throw new HttpError(404, "Draft not found.");
      // Old clients may still send retired formats. Preserve historical rows,
      // but all new long-form writing uses the press-release format.
      const kind = ["article", "case_study"].includes(b.kind)
        ? current.kind === b.kind
          ? b.kind
          : "press_release"
        : b.kind;
      if (current.version !== b.version)
        throw new HttpError(
          409,
          "A teammate updated this story. Reopen it from Drafts before saving again.",
        );
      const media = (
        await db.query("SELECT id,mime_type FROM post_media WHERE post_id=$1", [
          id,
        ])
      ).rows;
      if (
        doc.mediaIds.some(
          (m) =>
            !media.some((f) => f.id === m && f.mime_type.startsWith("image/")),
        ) ||
        (b.coverMediaId &&
          !media.some(
            (f) => f.id === b.coverMediaId && f.mime_type.startsWith("image/"),
          ))
      )
        throw new HttpError(400, "Choose media uploaded to this story.");
      // Validate ownership before normalization so a hidden inline image cannot
      // bypass the attachment boundary. Existing uploads remain attached below.
      const stored =
        kind === "post"
          ? validateDocument(postCaptionDocument(doc.document))
          : doc;
      const body = stored.document ? stored.text : b.body;
      if (b.status === "published") {
        if (kind === "post" && !body && !media.length)
          throw new HttpError(
            400,
            "Write something or add a photo, video, or document.",
          );
        if (kind === "post" && body.length > 4000)
          throw new HttpError(
            400,
            "Use a press release for updates longer than 4,000 characters.",
          );
        if (
          kind === "post" &&
          (current.status !== "published" || current.kind !== "post") &&
          (media.length > 4 ||
            (media.some((m) => !m.mime_type.startsWith("image/")) &&
              media.length > 1))
        )
          throw new HttpError(
            400,
            "A post can include up to 4 photos, or one video or PDF. Use a press release for more attachments.",
          );
        if (kind !== "post" && (b.title.length < 3 || body.length < 20))
          throw new HttpError(
            400,
            "Add a title and at least 20 characters to your story.",
          );
      }
      return (
        await db.query(
          `UPDATE posts SET kind=$1,title=$2,subtitle=$3,body=$4,document=$5,status=$6,cover_media_id=$7,version=version+1,updated_at=now(),published_at=CASE WHEN $6='published' THEN COALESCE(published_at,now()) ELSE published_at END,sequence=CASE WHEN status='draft' AND $6='published' THEN nextval('posts_sequence_seq') ELSE sequence END WHERE id=$8 RETURNING *`,
          [
            kind,
            b.title,
            b.subtitle,
            body,
            stored.document,
            b.status,
            b.coverMediaId,
            id,
          ],
        )
      ).rows[0];
    });
    res.json(result);
  });
  router.post(
    "/publications/:id/media",
    requireAdmin,
    upload.single("file"),
    async (req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, "Choose a file.");
      const key = "posts/" + file.filename;
      let stored = false,
        committed = false;
      try {
        const id = uuid.parse(req.params.id);
        const type = await fileTypeFromFile(file.path);
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
          throw new HttpError(400, "Use a JPG, PNG, WebP, MP4, WebM, or PDF.");
        const max = type.mime.startsWith("image/")
          ? 10
          : type.mime === "application/pdf"
            ? 20
            : 100;
        if (file.size > max * 1024 * 1024)
          throw new HttpError(413, `This file must be under ${max} MB.`);
        const row = await tx(async (db) => {
          const p = (
            await db.query(
              "SELECT id,kind FROM posts WHERE id=$1 AND company_id=$2 FOR UPDATE",
              [id, req.auth!.companyId],
            )
          ).rows[0];
          if (!p) throw new HttpError(404, "Story not found.");
          const attachments = (
            await db.query(
              "SELECT mime_type FROM post_media WHERE post_id=$1",
              [id],
            )
          ).rows;
          if (
            p.kind === "post" &&
            (attachments.length >= 4 ||
              (attachments.length > 0 &&
                (!type.mime.startsWith("image/") ||
                  attachments.some((m) => !m.mime_type.startsWith("image/")))))
          )
            throw new HttpError(
              400,
              "A post can include up to 4 photos, or one video or PDF. Use a press release for more attachments.",
            );
          if (
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM post_media WHERE post_id=$1",
                  [id],
                )
              ).rows[0].count,
            ) >= 20
          )
            throw new HttpError(
              400,
              "A story can contain up to 20 attachments.",
            );
          await checkQuota(db, req.auth!.companyId!, file.size);
          stored = true;
          const s = await storeFile(key, file.path, type.mime);
          return (
            await db.query(
              `INSERT INTO post_media(post_id,storage_name,original_name,mime_type,size,position,alt,storage_backend,sha256) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(position),-1)+1 FROM post_media WHERE post_id=$1),$6,$7,$8) RETURNING id,original_name AS name,mime_type AS mime,alt,size`,
              [
                id,
                file.filename,
                file.originalname.slice(0, 200),
                type.mime,
                file.size,
                String(req.body.alt || "").slice(0, 250),
                s.storage_backend,
                s.sha256,
              ],
            )
          ).rows[0];
        });
        committed = true;
        res.status(201).json({ ...row, url: "/api/post-media/" + row.id });
      } finally {
        await fs.unlink(file.path).catch(() => {});
        if (stored && !committed)
          await deferDelete(
            process.env.STORAGE_BACKEND === "s3" ? "s3" : "local",
            key,
          );
      }
    },
  );
  router.patch(
    "/publications/:id/media/:mediaId",
    requireAdmin,
    async (req, res) => {
      const { alt } = z
        .object({ alt: z.string().trim().max(250) })
        .parse(req.body);
      const r = await pool.query(
        "UPDATE post_media SET alt=$1 WHERE id=$2 AND post_id=$3 AND EXISTS(SELECT 1 FROM posts p WHERE p.id=post_media.post_id AND p.company_id=$4) RETURNING id",
        [
          alt,
          uuid.parse(req.params.mediaId),
          uuid.parse(req.params.id),
          req.auth!.companyId,
        ],
      );
      if (!r.rowCount) throw new HttpError(404, "Attachment not found.");
      res.json({ ok: true });
    },
  );
  router.delete(
    "/publications/:id/media/:mediaId",
    requireAdmin,
    async (req, res) => {
      const id = uuid.parse(req.params.id),
        mediaId = uuid.parse(req.params.mediaId);
      await tx(async (db) => {
        const p = (
          await db.query(
            "SELECT document FROM posts WHERE id=$1 AND company_id=$2 FOR UPDATE",
            [id, req.auth!.companyId],
          )
        ).rows[0];
        if (!p) throw new HttpError(404, "Story not found.");
        if (validateDocument(p.document).mediaIds.includes(mediaId))
          throw new HttpError(
            409,
            "Remove this image from the story text and save before deleting it.",
          );
        const m = (
          await db.query(
            "DELETE FROM post_media WHERE id=$1 AND post_id=$2 RETURNING storage_backend,storage_name",
            [mediaId, id],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, "Attachment not found.");
        await db.query(
          "INSERT INTO storage_deletions(storage_backend,storage_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [m.storage_backend, "posts/" + m.storage_name],
        );
      });
      res.json({ ok: true });
    },
  );
  return router;
}
