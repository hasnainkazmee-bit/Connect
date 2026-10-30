import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { PoolClient } from "pg";
import type { Request, Response, NextFunction } from "express";
import { pool, HttpError } from "./db.js";
const derive = (password: string, salt: string, modern: boolean) =>
  new Promise<Buffer>((resolve, reject) => {
    rawScrypt(
      password,
      salt,
      64,
      modern ? { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } : {},
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, true);
  return `scrypt-v2:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const modern = stored.startsWith("scrypt-v2:");
  const [salt, hash] = (modern ? stored.slice(10) : stored).split(":");
  if (
    !salt ||
    !hash ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hash)
  )
    return false;
  const result = await derive(password, salt, modern);
  const expected = Buffer.from(hash, "hex");
  return result.length === expected.length && timingSafeEqual(result, expected);
}
export type Auth = {
  userId: string;
  companyId: string | null;
  role: string | null;
  name: string;
  email: string;
  tokenHash: string;
  emailVerified: boolean;
  accountType: "company" | "individual";
};
declare global {
  namespace Express {
    interface Request {
      auth?: Auth;
    }
  }
}
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure:
    process.env.NODE_ENV === "production" ||
    process.env.SESSION_COOKIE_SECURE === "true" ||
    (process.env.APP_ORIGIN || "").startsWith("https:"),
  path: "/",
});
const cookies = (req: Request, name: string) =>
  (req.headers.cookie || "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(name + "="))
    .map((value) => value.slice(name.length + 1));
export function clearSessionCookies(res: Response) {
  res.clearCookie("sunhub_session", { path: "/" });
  res.clearCookie("connect_session", { path: "/" });
}
export async function session(req: Request, res: Response, next: NextFunction) {
  try {
    const scoped = cookies(req, "connect_session");
    // A parent-domain Sunhub CRM cookie must not shadow Connect's host-only session.
    // Old Android clients and existing browsers can still use a valid legacy token.
    const tokens = (scoped.length ? scoped : cookies(req, "sunhub_session"))
      .filter((token) => /^[a-f0-9]{64}$/.test(token))
      .slice(0, 8);
    if (tokens.length) {
      const hashes = tokens.map(hashToken);
      const { rows } = await pool.query(
        `SELECT s.token_hash,s.expires_at,s.user_id,s.company_id,s.last_seen_at,u.name,u.email,u.account_type,u.email_verified_at,m.role FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN memberships m ON m.company_id=s.company_id AND m.user_id=s.user_id WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() ORDER BY array_position($1::text[],s.token_hash) LIMIT 1`,
        [hashes],
      );
      if (rows[0]) {
        const r = rows[0];
        const tokenHash = r.token_hash;
        if (!scoped.length)
          res.cookie("connect_session", tokens[hashes.indexOf(tokenHash)], {
            ...cookieOptions(),
            expires: new Date(r.expires_at),
          });
        if (Date.now() - new Date(r.last_seen_at).getTime() > 300000)
          await pool.query(
            "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '5 minutes'",
            [tokenHash],
          );
        req.auth = {
          userId: r.user_id,
          companyId: r.role ? r.company_id : null,
          role: r.role,
          name: r.name,
          email: r.email,
          tokenHash,
          emailVerified: !!r.email_verified_at,
          accountType: r.account_type,
        };
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, "Please sign in to continue."));
  next();
}
export function requireVerified(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (
      process.env.REQUIRE_EMAIL_VERIFICATION !== "false" &&
      !req.auth!.emailVerified
    )
      return next(new HttpError(403, "Verify your email before continuing."));
    next();
  });
}
export function requireCompany(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!req.auth) return next(new HttpError(401, "Please sign in to continue."));
  if (
    !["GET", "HEAD"].includes(req.method) &&
    process.env.REQUIRE_EMAIL_VERIFICATION !== "false" &&
    !req.auth.emailVerified
  )
    return next(new HttpError(403, "Verify your email before continuing."));
  if (!req.auth.companyId)
    return next(new HttpError(403, "Select a company you represent."));
  next();
}
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, "Please sign in to continue."));
  if (
    process.env.REQUIRE_EMAIL_VERIFICATION !== "false" &&
    !req.auth.emailVerified
  )
    return next(new HttpError(403, "Verify your email before continuing."));
  if (!req.auth.companyId || !["owner", "admin"].includes(req.auth.role || ""))
    return next(
      new HttpError(403, "Only company owners and administrators can do this."),
    );
  next();
}
export async function createSession(
  res: Response,
  userId: string,
  companyId: string | null,
  userAgent = "",
  db: Pick<PoolClient, "query"> = pool,
) {
  const token = randomBytes(32).toString("hex");
  await db.query(
    `INSERT INTO sessions(token_hash,user_id,company_id,expires_at,user_agent) VALUES($1,$2,$3,now()+interval '7 days',$4)`,
    [hashToken(token), userId, companyId, userAgent.slice(0, 300)],
  );
  res.cookie("sunhub_session", token, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.cookie("connect_session", token, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
