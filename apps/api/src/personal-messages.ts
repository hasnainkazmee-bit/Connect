import { Router } from "express";
import { z } from "zod";
import { pool, tx, HttpError } from "./db.js";
import { requireVerified, type Auth } from "./auth.js";
import { requireManagedCompany } from "./directory.js";
const uuid = z.string().uuid();
function side(t: any, a: Auth) {
  if (a.accountType === "individual" && t.user_id === a.userId)
    return "individual";
  if (a.companyId && t.company_id === a.companyId) return "company";
  throw new HttpError(404, "Conversation not found.");
}
const details = `SELECT t.*,u.name AS person_name,row_to_json(c) AS company FROM personal_threads t JOIN users u ON u.id=t.user_id JOIN companies c ON c.id=t.company_id`;
export function personalMessagesRoutes() {
  const router = Router();
  router.use("/personal-inbox", requireVerified);
  router.get("/personal-inbox", async (req, res) => {
    const a = req.auth!;
    const companySide = a.accountType !== "individual";
    const { rows } = await pool.query(
      `${details} WHERE ${companySide ? "t.company_id=$1" : "t.user_id=$1"} ORDER BY t.updated_at DESC LIMIT 200`,
      [companySide ? a.companyId : a.userId],
    );
    if (!rows.length) return res.json({ threads: [], unread: 0, requests: 0 });
    const counts = (
      await pool.query(
        `SELECT t.id,(SELECT body FROM personal_messages WHERE thread_id=t.id ORDER BY sequence DESC LIMIT 1) AS last_message,(SELECT count(*)::int FROM personal_messages m WHERE m.thread_id=t.id AND m.sender_kind<>$2 AND m.sequence>CASE WHEN $2='company' THEN t.company_read_sequence ELSE t.user_read_sequence END) AS unread FROM personal_threads t WHERE t.id=ANY($1::uuid[])`,
        [rows.map((r) => r.id), companySide ? "company" : "individual"],
      )
    ).rows;
    const threads = rows.map((r) => ({
      ...r,
      ...counts.find((c) => c.id === r.id),
    }));
    res.json({
      threads,
      unread: threads.reduce((sum, t) => sum + t.unread, 0),
      requests: companySide
        ? threads.filter((t) => t.status === "pending").length
        : 0,
    });
  });
  router.post("/personal-inbox", async (req, res) => {
    if (req.auth!.accountType !== "individual")
      throw new HttpError(
        403,
        "Use your company inbox to contact other companies.",
      );
    const b = z
      .object({
        companyId: uuid,
        body: z.string().trim().min(1).max(2000),
        clientId: uuid,
      })
      .parse(req.body);
    const thread = await tx(async (db) => {
      await requireManagedCompany(db, b.companyId);
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.auth!.userId,
      ]);
      if (
        !(await db.query("SELECT 1 FROM companies WHERE id=$1", [b.companyId]))
          .rowCount
      )
        throw new HttpError(404, "Company not found.");
      const existing = (
        await db.query(
          "SELECT * FROM personal_threads WHERE user_id=$1 AND company_id=$2",
          [req.auth!.userId, b.companyId],
        )
      ).rows[0];
      if (existing) return existing;
      if (
        Number(
          (
            await db.query(
              "SELECT count(*) FROM personal_threads WHERE user_id=$1 AND created_at>now()-interval '1 day'",
              [req.auth!.userId],
            )
          ).rows[0].count,
        ) >= 10
      )
        throw new HttpError(
          429,
          "You can contact up to 10 new companies per day.",
        );
      const t = (
        await db.query(
          "INSERT INTO personal_threads(user_id,company_id) VALUES($1,$2) RETURNING *",
          [req.auth!.userId, b.companyId],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO personal_messages(thread_id,author_id,sender_kind,body,client_id) VALUES($1,$2,'individual',$3,$4)",
        [t.id, req.auth!.userId, b.body, b.clientId],
      );
      return t;
    });
    res.status(201).json(thread);
  });
  router.get("/personal-inbox/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      a = req.auth!;
    const t = (await pool.query(`${details} WHERE t.id=$1`, [id])).rows[0];
    if (!t) throw new HttpError(404, "Conversation not found.");
    const role = side(t, a);
    const before = req.query.before
      ? z
          .string()
          .regex(/^[1-9][0-9]{0,18}$/)
          .parse(req.query.before)
      : null;
    const rows = (
      await pool.query(
        "SELECT m.*,u.name AS author_name FROM personal_messages m JOIN users u ON u.id=m.author_id WHERE thread_id=$1 AND ($2::bigint IS NULL OR sequence<$2) ORDER BY sequence DESC LIMIT 101",
        [id, before],
      )
    ).rows;
    const messages = rows.slice(0, 100).reverse();
    if (!before && messages.length)
      await pool.query(
        `UPDATE personal_threads SET ${role === "company" ? "company_read_sequence" : "user_read_sequence"}=GREATEST(${role === "company" ? "company_read_sequence" : "user_read_sequence"},$1) WHERE id=$2`,
        [messages.at(-1).sequence, id],
      );
    res.json({
      thread: t,
      messages,
      side: role,
      peerReadSequence:
        role === "company" ? t.user_read_sequence : t.company_read_sequence,
      nextCursor: rows.length > 100 ? messages[0].sequence : null,
    });
  });
  router.post("/personal-inbox/:id/respond", async (req, res) => {
    const id = uuid.parse(req.params.id),
      { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    await tx(async (db) => {
      const t = (
        await db.query(
          "SELECT * FROM personal_threads WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!t || side(t, req.auth!) !== "company")
        throw new HttpError(
          403,
          "Only the company can respond to this request.",
        );
      if (t.status !== "pending")
        throw new HttpError(409, "This request was already handled.");
      await db.query(
        "UPDATE personal_threads SET status=$1,updated_at=now() WHERE id=$2",
        [accept ? "accepted" : "declined", id],
      );
    });
    res.json({ ok: true });
  });
  router.post("/personal-inbox/:id/messages", async (req, res) => {
    const id = uuid.parse(req.params.id),
      b = z
        .object({ body: z.string().trim().min(1).max(4000), clientId: uuid })
        .parse(req.body);
    const m = await tx(async (db) => {
      const t = (
        await db.query(
          "SELECT * FROM personal_threads WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!t) throw new HttpError(404, "Conversation not found.");
      const role = side(t, req.auth!);
      if (t.status !== "accepted")
        throw new HttpError(
          403,
          "The company needs to accept this request before you can continue.",
        );
      const old = (
        await db.query(
          "SELECT * FROM personal_messages WHERE thread_id=$1 AND author_id=$2 AND client_id=$3",
          [id, req.auth!.userId, b.clientId],
        )
      ).rows[0];
      if (old) {
        if (old.body !== b.body)
          throw new HttpError(409, "This message identifier was already used.");
        return old;
      }
      const row = (
        await db.query(
          "INSERT INTO personal_messages(thread_id,author_id,sender_kind,body,client_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [id, req.auth!.userId, role, b.body, b.clientId],
        )
      ).rows[0];
      await db.query(
        "UPDATE personal_threads SET updated_at=now() WHERE id=$1",
        [id],
      );
      return row;
    });
    res.status(201).json(m);
  });
  return router;
}
