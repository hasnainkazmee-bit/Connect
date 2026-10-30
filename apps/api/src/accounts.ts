import { Router, type Request } from "express";
import {
  randomInt,
  randomUUID,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, tx, HttpError, lockPair } from "./db.js";
import {
  requireAuth,
  clearSessionCookies,
  hashPassword,
  verifyPassword,
  createSession,
  hashToken,
} from "./auth.js";
import { codeHash, queueCode, flushMail } from "./mail.js";
import { claimUsername, ensureUsername, usernameSchema } from "./profiles.js";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(12, "Use at least 12 characters.").max(128);
const uuid = z.string().uuid();
const verifiedRequired = () =>
  process.env.REQUIRE_EMAIL_VERIFICATION !== "false";
export async function sessionPayload(userId: string, companyId: string | null) {
  const user = (
    await pool.query(
      "SELECT id,name,email,account_type,email_verified_at,onboarding_completed_at FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  const companies = (
    await pool.query(
      "SELECT c.*,m.role,m.title FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=$1 ORDER BY c.name",
      [userId],
    )
  ).rows;
  return {
    user,
    companies,
    activeCompanyId: companyId,
    verificationRequired: verifiedRequired(),
  };
}
async function limit(key: string, maximum = 6, seconds = 900) {
  const { rows } = await pool.query(
    `INSERT INTO auth_limits(key_hash,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN auth_limits.expires_at<=now() THEN 1 ELSE auth_limits.count+1 END,expires_at=CASE WHEN auth_limits.expires_at<=now() THEN now()+$2*interval '1 second' ELSE auth_limits.expires_at END RETURNING count`,
    [hashToken(key), seconds],
  );
  if (rows[0].count > maximum)
    throw new HttpError(
      429,
      "Too many attempts. Please wait before trying again.",
    );
}
async function challenge(
  db: PoolClient,
  userId: string,
  address: string,
  purpose: "verify" | "reset",
) {
  await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  await db.query(
    "UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
    [userId, purpose],
  );
  const id = randomUUID();
  const code = randomInt(0, 1000000).toString().padStart(6, "0");
  await db.query(
    "INSERT INTO auth_challenges(id,user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
    [id, userId, purpose, codeHash(id, code)],
  );
  await queueCode(db, address, code, purpose);
  return id;
}
async function consume(
  id: string,
  code: string,
  purpose: string,
  action: (db: PoolClient, userId: string) => Promise<void>,
  userId?: string,
) {
  const ok = await tx(async (db) => {
    const target = (
      await db.query(
        "SELECT user_id FROM auth_challenges WHERE id=$1 AND purpose=$2",
        [id, purpose],
      )
    ).rows[0];
    if (!target || (userId && target.user_id !== userId)) return false;
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      target.user_id,
    ]);
    const c = (
      await db.query(
        "SELECT * FROM auth_challenges WHERE id=$1 AND purpose=$2 FOR UPDATE",
        [id, purpose],
      )
    ).rows[0];
    if (
      !c ||
      (userId && c.user_id !== userId) ||
      c.consumed_at ||
      new Date(c.expires_at).getTime() <= Date.now() ||
      c.attempts >= 5
    )
      return false;
    await db.query(
      "UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1",
      [id],
    );
    const valid = timingSafeEqual(
      Buffer.from(c.code_hash, "hex"),
      Buffer.from(codeHash(id, code), "hex"),
    );
    if (!valid) return false; // Commit failed attempts too.
    await db.query("UPDATE auth_challenges SET consumed_at=now() WHERE id=$1", [
      id,
    ]);
    await action(db, c.user_id);
    return true;
  });
  if (!ok)
    throw new HttpError(
      400,
      "That code is incorrect or expired. Request a new code.",
    );
}
const requestCode = z.object({
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});
const event = (db: PoolClient, user: string, name: string) =>
  db.query("INSERT INTO auth_events(user_id,event) VALUES($1,$2)", [
    user,
    name,
  ]);
const companyTypes = z.enum([
  "Installer",
  "EPC",
  "Developer",
  "Distributor",
  "Manufacturer",
  "Service provider",
]);

export function accountRoutes() {
  const router = Router();
  router.post("/auth/register", async (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(100),
        email,
        password,
        accountType: z.enum(["company", "individual"]).default("company"),
        companyName: z.string().trim().min(2).max(120).optional(),
      })
      .parse(req.body);
    await limit(`register:${b.email}`, 5);
    const hashed = await hashPassword(b.password);
    const result = await tx(async (db) => {
      const user = (
        await db.query(
          "INSERT INTO users(name,email,password_hash,account_type) VALUES($1,$2,$3,$4) RETURNING id",
          [b.name, b.email, hashed, b.accountType],
        )
      ).rows[0];
      let companyId = null;
      if (b.companyName && b.accountType === "company") {
        const slug =
          b.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
          "-" +
          randomBytes(4).toString("hex");
        companyId = (
          await db.query(
            "INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id",
            [b.companyName, slug],
          )
        ).rows[0].id;
        await ensureUsername(db, companyId, b.companyName);
        await db.query(
          "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
          [user.id, companyId],
        );
      }
      const challengeId = verifiedRequired()
        ? await challenge(db, user.id, b.email, "verify")
        : null;
      await event(db, user.id, "registered");
      return { userId: user.id, companyId, challengeId };
    });
    await createSession(
      res,
      result.userId,
      result.companyId,
      req.get("user-agent"),
    );
    void flushMail().catch(() => {});
    res
      .status(201)
      .json({
        ...(await sessionPayload(result.userId, result.companyId)),
        challengeId: result.challengeId,
      });
  });
  router.post("/auth/login", async (req, res) => {
    const b = z
      .object({ email, password: z.string().min(1).max(128) })
      .parse(req.body);
    await limit(`login:${b.email}`, 15);
    const user = (
      await pool.query("SELECT * FROM users WHERE email=$1", [b.email])
    ).rows[0];
    const fake = "scrypt-v2:" + "00".repeat(16) + ":" + "00".repeat(64);
    const valid = await verifyPassword(b.password, user?.password_hash || fake);
    if (!user || !valid)
      throw new HttpError(401, "Email or password is incorrect.");
    const companyId = await tx(async (db) => {
      const current = (
        await db.query(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (current.password_hash !== user.password_hash)
        throw new HttpError(
          401,
          "Your password changed. Please sign in again.",
        );
      if (!user.password_hash.startsWith("scrypt-v2:"))
        await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          await hashPassword(b.password),
          user.id,
        ]);
      const companyId =
        (
          await db.query(
            "SELECT company_id FROM memberships WHERE user_id=$1 ORDER BY company_id LIMIT 1",
            [user.id],
          )
        ).rows[0]?.company_id || null;
      if (req.auth)
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          req.auth.tokenHash,
        ]);
      await createSession(res, user.id, companyId, req.get("user-agent"), db);
      return companyId;
    });
    await pool.query("DELETE FROM auth_limits WHERE key_hash=$1", [
      hashToken(`login:${b.email}`),
    ]);
    await pool.query(
      "INSERT INTO auth_events(user_id,event) VALUES($1,'signed_in')",
      [user.id],
    );
    res.json(await sessionPayload(user.id, companyId));
  });
  router.post("/auth/verification/request", requireAuth, async (req, res) => {
    await limit(`verify:${req.auth!.userId}`, 5, 600);
    if (req.auth!.emailVerified) return res.json({ verified: true });
    const challengeId = await tx((db) =>
      challenge(db, req.auth!.userId, req.auth!.email, "verify"),
    );
    void flushMail().catch(() => {});
    res.json({ challengeId, expiresIn: 600 });
  });
  router.post("/auth/verification/confirm", requireAuth, async (req, res) => {
    const b = requestCode.parse(req.body);
    await consume(
      b.challengeId,
      b.code,
      "verify",
      async (db, userId) => {
        await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
          userId,
        ]);
        await event(db, userId, "email_verified");
      },
      req.auth!.userId,
    );
    res.json(await sessionPayload(req.auth!.userId, req.auth!.companyId));
  });
  router.post("/auth/password/request", async (req, res) => {
    const b = z.object({ email }).parse(req.body);
    await limit(`reset:${b.email}`, 5, 600);
    const user = (
      await pool.query("SELECT id FROM users WHERE email=$1", [b.email])
    ).rows[0];
    const challengeId = user
      ? await tx((db) => challenge(db, user.id, b.email, "reset"))
      : randomUUID();
    void flushMail().catch(() => {});
    res.json({
      challengeId,
      message: "If an account exists, a reset code is on its way.",
      expiresIn: 600,
    });
  });
  router.post("/auth/password/reset", async (req, res) => {
    const b = requestCode.extend({ password }).parse(req.body);
    await limit(`reset-code:${b.challengeId}`, 8, 600);
    const hashed = await hashPassword(b.password);
    await consume(b.challengeId, b.code, "reset", async (db, userId) => {
      await db.query(
        "UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2",
        [hashed, userId],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await db.query(
        "UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='reset' AND consumed_at IS NULL",
        [userId],
      );
      await event(db, userId, "password_reset");
    });
    clearSessionCookies(res);
    res.json({ ok: true });
  });
  router.post("/auth/password/change", requireAuth, async (req, res) => {
    const b = z
      .object({ currentPassword: z.string().min(1).max(128), password })
      .parse(req.body);
    await limit(`change:${req.auth!.userId}`, 10);
    const user = (
      await pool.query("SELECT password_hash FROM users WHERE id=$1", [
        req.auth!.userId,
      ])
    ).rows[0];
    if (!(await verifyPassword(b.currentPassword, user.password_hash)))
      throw new HttpError(400, "Your current password is incorrect.");
    const hashed = await hashPassword(b.password);
    await tx(async (db) => {
      const current = (
        await db.query(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [req.auth!.userId],
        )
      ).rows[0];
      if (
        current.password_hash !== user.password_hash ||
        !(
          await db.query("SELECT 1 FROM sessions WHERE token_hash=$1", [
            req.auth!.tokenHash,
          ])
        ).rowCount
      )
        throw new HttpError(401, "Your account changed. Please sign in again.");
      await db.query(
        "UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2",
        [hashed, req.auth!.userId],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [
        req.auth!.userId,
      ]);
      await db.query(
        "UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
        [req.auth!.userId],
      );
      await event(db, req.auth!.userId, "password_changed");
      await createSession(
        res,
        req.auth!.userId,
        req.auth!.companyId,
        req.get("user-agent"),
        db,
      );
    });
    res.json({ ok: true });
  });
  router.get("/auth/sessions", requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id,created_at,last_seen_at,expires_at,user_agent,(token_hash=$2) AS current FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY last_seen_at DESC",
      [req.auth!.userId, req.auth!.tokenHash],
    );
    res.json({ sessions: rows });
  });
  router.post("/auth/sessions/revoke", requireAuth, async (req, res) => {
    const b = z
      .object({ id: uuid.optional(), others: z.boolean().optional() })
      .refine((b) => !!b.id !== !!b.others)
      .parse(req.body);
    const result = await pool.query(
      "DELETE FROM sessions WHERE user_id=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR ($3 AND token_hash<>$4)) RETURNING token_hash",
      [req.auth!.userId, b.id || null, !!b.others, req.auth!.tokenHash],
    );
    const signedOut = result.rows.some(
      (r) => r.token_hash === req.auth!.tokenHash,
    );
    if (signedOut) clearSessionCookies(res);
    res.json({ ok: true, signedOut });
  });
  router.post("/onboarding/company", requireAuth, async (req, res) => {
    if (req.auth!.accountType === "individual")
      throw new HttpError(
        403,
        "Individual accounts cannot manage company profiles.",
      );
    if (verifiedRequired() && !req.auth!.emailVerified)
      throw new HttpError(
        403,
        "Verify your email before setting up your company.",
      );
    const b = z
      .object({
        name: z.string().trim().min(2).max(120),
        username: usernameSchema.optional(),
        type: companyTypes,
        location: z.string().trim().min(2).max(160),
        services: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        serviceAreas: z
          .array(z.string().trim().min(1).max(60))
          .max(30)
          .default([]),
        tagline: z.string().trim().max(200).default(""),
      })
      .parse(req.body);
    const companyId = await tx(async (db) => {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.auth!.userId,
      ]);
      const membership = (
        await db.query(
          "SELECT m.company_id,m.role FROM memberships m WHERE m.user_id=$1 ORDER BY (m.company_id=$2) DESC NULLS LAST,m.company_id LIMIT 1",
          [req.auth!.userId, req.auth!.companyId],
        )
      ).rows[0];
      const existing = membership?.company_id;
      let id = existing;
      if (existing && !["owner", "admin"].includes(membership.role || ""))
        throw new HttpError(
          403,
          "Only company administrators can edit this profile.",
        );
      if (!id) {
        const slug =
          b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
          "-" +
          randomBytes(4).toString("hex");
        id = (
          await db.query(
            "INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id",
            [b.name, slug],
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
          [req.auth!.userId, id],
        );
      }
      await db.query(
        "UPDATE companies SET name=$1,type=$2,location=$3,services=$4,service_areas=$5,tagline=$6 WHERE id=$7",
        [b.name, b.type, b.location, b.services, b.serviceAreas, b.tagline, id],
      );
      if (b.username) await claimUsername(db, id, b.username);
      else await ensureUsername(db, id, b.name);
      await db.query("UPDATE sessions SET company_id=$1 WHERE token_hash=$2", [
        id,
        req.auth!.tokenHash,
      ]);
      return id;
    });
    res.json(await sessionPayload(req.auth!.userId, companyId));
  });
  router.post("/onboarding/complete", requireAuth, async (req, res) => {
    if (verifiedRequired() && !req.auth!.emailVerified)
      throw new HttpError(403, "Verify your email before continuing.");
    const b = z
      .object({ followIds: z.array(uuid).max(20).default([]) })
      .parse(req.body);
    await tx(async (db) => {
      if (
        req.auth!.companyId &&
        ["owner", "admin"].includes(req.auth!.role || "")
      ) {
        for (const id of [...new Set(b.followIds)].sort()) {
          if (id === req.auth!.companyId) continue;
          await lockPair(db, req.auth!.companyId, id);
          await db.query(
            "INSERT INTO company_follows(follower_id,followed_id) SELECT $1,id FROM companies c WHERE id=$2 AND NOT EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)) ON CONFLICT DO NOTHING",
            [req.auth!.companyId, id],
          );
        }
      } else if (!req.auth!.companyId) {
        for (const id of [...new Set(b.followIds)])
          await db.query(
            "INSERT INTO individual_follows(user_id,company_id) SELECT $1,id FROM companies WHERE id=$2 ON CONFLICT DO NOTHING",
            [req.auth!.userId, id],
          );
      }
      await db.query(
        "UPDATE users SET onboarding_completed_at=now() WHERE id=$1",
        [req.auth!.userId],
      );
    });
    res.json(await sessionPayload(req.auth!.userId, req.auth!.companyId));
  });
  router.post("/session/individual", requireAuth, async (req, res) => {
    await pool.query(
      "UPDATE sessions SET company_id=NULL WHERE token_hash=$1",
      [req.auth!.tokenHash],
    );
    res.json(await sessionPayload(req.auth!.userId, null));
  });
  return router;
}
