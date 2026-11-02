import type { Router } from "express";
import { z } from "zod";
import emojiRegex from "emoji-regex";
import { pool, tx, HttpError } from "./db.js";
import { requireCompany } from "./auth.js";

const uuid = z.string().uuid();
const cursor = z.string().regex(/^[1-9][0-9]{0,18}$/);
const emoji = z
  .string()
  .trim()
  .max(64)
  .refine((value) => {
    const matches = [...value.matchAll(emojiRegex())];
    return matches.length === 1 && matches[0][0] === value;
  }, "Choose one emoji.");

// Only internal aliases/parameter names are interpolated into these fragments.
export const unblocked = (alias: string, actor: string) =>
  `NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=${actor} AND b.blocked_id=${alias}.company_id) OR (b.blocked_id=${actor} AND b.blocker_id=${alias}.company_id))`;

const commentProjection = `SELECT cm.id,cm.sequence,cm.body,cm.created_at,cm.author_id,
  cm.parent_id,cm.reply_to_id,cm.deleted_at,u.name AS author_name,row_to_json(c) AS company,
  CASE WHEN target.deleted_at IS NULL AND ${unblocked("target", "$2")} THEN target_user.name END AS reply_to_name,
  (SELECT count(*)::int FROM post_comments reply WHERE reply.parent_id=cm.id AND reply.deleted_at IS NULL AND ${unblocked("reply", "$2")}) AS reply_count,
  (cm.deleted_at IS NULL AND $2::uuid IS NOT NULL AND
    (cm.author_id=$3 AND cm.company_id=$2 OR $4 AND (cm.company_id=$2 OR p.company_id=$2))) AS can_delete
  FROM post_comments cm JOIN posts p ON p.id=cm.post_id JOIN companies c ON c.id=cm.company_id
  JOIN users u ON u.id=cm.author_id LEFT JOIN post_comments target ON target.id=cm.reply_to_id
  LEFT JOIN users target_user ON target_user.id=target.author_id`;

type GetPost = (
  id: string,
  company: string | null,
  user?: string | null,
) => Promise<any>;
export function installPostInteractions(router: Router, getPost: GetPost) {
  async function publishedPost(id: string, actor: string | null) {
    const post = await getPost(id, actor);
    if (post.status !== "published")
      throw new HttpError(404, "Post not found.");
    return post;
  }
  async function setReaction(
    id: string,
    actor: string,
    author: string,
    symbol: string,
    reacted: boolean,
  ) {
    await publishedPost(id, actor);
    await tx(async (db) => {
      // Serialize toggles with older clients that still use the Celebrate endpoint.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `reaction:${id}:${actor}:${symbol}`,
      ]);
      if (reacted) {
        await db.query(
          "INSERT INTO post_reactions(post_id,company_id,author_id,emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [id, actor, author, symbol],
        );
      } else {
        await db.query(
          "DELETE FROM post_reactions WHERE post_id=$1 AND company_id=$2 AND emoji=$3",
          [id, actor, symbol],
        );
      }
      if (symbol === "🎉") {
        if (reacted)
          await db.query(
            "INSERT INTO post_likes(post_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [id, actor],
          );
        else
          await db.query(
            "DELETE FROM post_likes WHERE post_id=$1 AND company_id=$2",
            [id, actor],
          );
      }
    });
    return getPost(id, actor);
  }
  router.post("/posts/:id/like", requireCompany, async (req, res) => {
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
    res.json(
      await setReaction(
        uuid.parse(req.params.id),
        req.auth!.companyId!,
        req.auth!.userId,
        "🎉",
        liked,
      ),
    );
  });
  router.post("/posts/:id/reactions", requireCompany, async (req, res) => {
    const input = z.object({ emoji, reacted: z.boolean() }).parse(req.body);
    res.json(
      await setReaction(
        uuid.parse(req.params.id),
        req.auth!.companyId!,
        req.auth!.userId,
        input.emoji,
        input.reacted,
      ),
    );
  });
  router.get("/posts/:id/reactions", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth?.companyId || null;
    await publishedPost(id, actor);
    const filter = req.query.emoji ? emoji.parse(req.query.emoji) : null;
    const after = req.query.after ? cursor.parse(req.query.after) : null;
    const { rows } = await pool.query(
      `SELECT r.id,r.sequence,r.emoji,r.created_at,row_to_json(c) AS company,
      json_build_object('id',u.id,'name',u.name) AS "user"
      FROM post_reactions r JOIN companies c ON c.id=r.company_id LEFT JOIN users u ON u.id=r.author_id
      WHERE r.post_id=$1 AND ${unblocked("r", "$2")} AND ($3::text IS NULL OR r.emoji=$3)
        AND ($4::bigint IS NULL OR r.sequence>$4) ORDER BY r.sequence LIMIT 31`,
      [id, actor, filter, after],
    );
    res.json({
      reactions: rows.slice(0, 30),
      nextCursor: rows.length > 30 ? rows[29].sequence : null,
    });
  });
  router.get("/posts/:id/comments", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth?.companyId || null;
    await publishedPost(id, actor);
    const before = req.query.before ? cursor.parse(req.query.before) : null;
    const { rows } = await pool.query(
      `${commentProjection} WHERE cm.post_id=$1 AND cm.parent_id IS NULL
      AND ${unblocked("cm", "$2")} AND ($5::bigint IS NULL OR cm.sequence<$5)
      AND (cm.deleted_at IS NULL OR EXISTS(SELECT 1 FROM post_comments reply WHERE reply.parent_id=cm.id AND reply.deleted_at IS NULL AND ${unblocked("reply", "$2")}))
      ORDER BY cm.sequence DESC LIMIT 31`,
      [
        id,
        actor,
        req.auth?.userId || null,
        ["owner", "admin"].includes(req.auth?.role || ""),
        before,
      ],
    );
    res.json({
      comments: rows.slice(0, 30).reverse(),
      nextCursor: rows.length > 30 ? rows[29].sequence : null,
    });
  });
  router.get("/posts/:postId/comments/:id/replies", async (req, res) => {
    const postId = uuid.parse(req.params.postId),
      id = uuid.parse(req.params.id),
      actor = req.auth?.companyId || null;
    await publishedPost(postId, actor);
    const root = await pool.query(
      `SELECT cm.id FROM post_comments cm WHERE cm.id=$1 AND cm.post_id=$2 AND cm.parent_id IS NULL AND ${unblocked("cm", "$3")}`,
      [id, postId, actor],
    );
    if (!root.rowCount) throw new HttpError(404, "Comment not found.");
    const after = req.query.after ? cursor.parse(req.query.after) : null;
    const { rows } = await pool.query(
      `${commentProjection} WHERE cm.post_id=$1 AND cm.parent_id=$5 AND cm.deleted_at IS NULL
      AND ${unblocked("cm", "$2")} AND ($6::bigint IS NULL OR cm.sequence>$6) ORDER BY cm.sequence LIMIT 21`,
      [
        postId,
        actor,
        req.auth?.userId || null,
        ["owner", "admin"].includes(req.auth?.role || ""),
        id,
        after,
      ],
    );
    res.json({
      comments: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? rows[19].sequence : null,
    });
  });
  router.post("/posts/:id/comments", requireCompany, async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.auth!.companyId!;
    const input = z
      .object({
        body: z.string().trim().min(1).max(1500),
        parentId: uuid.optional(),
      })
      .parse(req.body);
    await publishedPost(id, actor);
    const createdId = await tx(async (db) => {
      let rootId: string | null = null;
      if (input.parentId) {
        const { rows } = await db.query(
          `SELECT cm.id,cm.parent_id FROM post_comments cm WHERE cm.id=$1 AND cm.post_id=$2 AND cm.deleted_at IS NULL AND ${unblocked("cm", "$3")} FOR UPDATE`,
          [input.parentId, id, actor],
        );
        if (!rows[0])
          throw new HttpError(404, "This comment is no longer available.");
        rootId = rows[0].parent_id || rows[0].id;
        // Replies to replies remain in the same thread; blocked roots cannot be bypassed.
        if (
          rows[0].parent_id &&
          !(
            await db.query(
              `SELECT cm.id FROM post_comments cm WHERE cm.id=$1 AND ${unblocked("cm", "$2")}`,
              [rootId, actor],
            )
          ).rowCount
        )
          throw new HttpError(404, "This thread is unavailable.");
      }
      const { rows } = await db.query(
        "INSERT INTO post_comments(post_id,company_id,author_id,body,parent_id,reply_to_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          id,
          actor,
          req.auth!.userId,
          input.body,
          rootId,
          input.parentId || null,
        ],
      );
      return rows[0].id;
    });
    const { rows } = await pool.query(
      `${commentProjection} WHERE cm.post_id=$1 AND cm.id=$5`,
      [
        id,
        actor,
        req.auth!.userId,
        ["owner", "admin"].includes(req.auth!.role || ""),
        createdId,
      ],
    );
    res
      .status(201)
      .json({ ...(await getPost(id, actor)), created_comment: rows[0] });
  });
  router.delete(
    "/posts/:postId/comments/:id",
    requireCompany,
    async (req, res) => {
      const postId = uuid.parse(req.params.postId),
        id = uuid.parse(req.params.id);
      await publishedPost(postId, req.auth!.companyId!);
      const isAdmin = ["owner", "admin"].includes(req.auth!.role || "");
      const { rowCount } = await pool.query(
        `UPDATE post_comments cm SET body='',deleted_at=clock_timestamp() FROM posts p
      WHERE cm.id=$1 AND cm.post_id=$2 AND p.id=cm.post_id AND cm.deleted_at IS NULL AND
      (cm.author_id=$3 AND cm.company_id=$4 OR $5 AND (cm.company_id=$4 OR p.company_id=$4))`,
        [id, postId, req.auth!.userId, req.auth!.companyId, isAdmin],
      );
      if (!rowCount) throw new HttpError(404, "Comment not found.");
      res.json(await getPost(postId, req.auth!.companyId!));
    },
  );
}
