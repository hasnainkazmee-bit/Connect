import { Router, type Request, type Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import * as oidc from "openid-client";
import { z } from "zod";
import { pool, tx, HttpError } from "./db.js";
import { createSession, hashToken } from "./auth.js";
import { sessionPayload } from "./accounts.js";

const random = () => randomBytes(32).toString("base64url");
const challenge = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const nativeRedirects = new Set([
  "com.sunhub.community.debug://auth/sunhub",
  "com.sunhub.community://auth/sunhub",
]);
const origin = () =>
  new URL(process.env.APP_ORIGIN || "http://localhost:5173").origin;
const callback = () => origin() + "/api/auth/sunhub/callback";
function issuer() {
  const value = process.env.SUNHUB_SSO_ISSUER;
  if (!value) return null;
  const url = new URL(value);
  if (
    url.href !== url.origin + "/" ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("SUNHUB_SSO_ISSUER must be a secure origin");
  return url.origin;
}
let configured: Promise<oidc.Configuration> | undefined;
async function configuration() {
  const expectedIssuer = issuer();
  if (!expectedIssuer)
    throw new HttpError(503, "Sunhub sign-in is not available yet.");
  configured ??= oidc
    .discovery(
      new URL(expectedIssuer),
      process.env.SUNHUB_SSO_CLIENT_ID || "sunhub-connect",
      {
        id_token_signed_response_alg: "EdDSA",
      },
      oidc.None(),
      {
        timeout: 8,
        execute: [
          oidc.enableNonRepudiationChecks,
          ...(expectedIssuer.startsWith("http:")
            ? [oidc.allowInsecureRequests]
            : []),
        ],
      },
    )
    .then((config) => {
      // This first-party issuer keeps every protocol endpoint on its own origin.
      const metadata = config.serverMetadata();
      for (const endpoint of [
        metadata.authorization_endpoint,
        metadata.token_endpoint,
        metadata.jwks_uri,
      ]) {
        if (!endpoint || new URL(endpoint).origin !== expectedIssuer)
          throw new Error("Invalid Sunhub endpoint");
      }
      if (!metadata.supportsPKCE("S256"))
        throw new Error("Sunhub requires S256 PKCE");
      return config;
    })
    .catch((error) => {
      configured = undefined;
      throw error;
    });
  return configured;
}
export function safeReturnTo(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return "/";
  const url = new URL(value, origin());
  if (
    url.origin !== origin() ||
    url.pathname.startsWith("//") ||
    /^\/(?:api|assets)(?:\/|$)/.test(url.pathname)
  )
    return "/";
  url.searchParams.delete("sso_error");
  url.searchParams.delete("sunhub_linked");
  return url.pathname + url.search + url.hash;
}
const cookieName = (state: string) =>
  "connect_oidc_" + hashToken(state).slice(0, 16);
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: origin().startsWith("https:"),
  path: "/",
  maxAge: 15 * 60 * 1000,
});
function flowCookie(req: Request, state: string) {
  const key = cookieName(state) + "=";
  return (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(key))
    ?.slice(key.length);
}
type Flow = {
  issuer: string;
  verifier: string;
  nonce: string;
  return_to: string;
  account_type: "company" | "individual";
  link_user_id: string | null;
  link_session_hash: string | null;
  mobile_redirect: string | null;
  mobile_state: string | null;
  mobile_challenge: string | null;
};
function finish(res: Response, flow: Flow | undefined, error: string) {
  const target = new URL(
    flow?.mobile_redirect || flow?.return_to || "/",
    origin(),
  );
  target.searchParams.set(flow?.mobile_redirect ? "error" : "sso_error", error);
  if (flow?.mobile_redirect)
    target.searchParams.set("state", flow.mobile_state!);
  res.redirect(
    303,
    flow?.mobile_redirect
      ? target.href
      : target.pathname + target.search + target.hash,
  );
}
class SignInError extends Error {}
async function identityUser(flow: Flow, claims: Record<string, unknown>) {
  const identity = z
    .object({
      sub: z.string().min(1).max(255),
      email: z.email().max(254),
      email_verified: z.literal(true),
      name: z.string().trim().min(1).max(100).optional(),
    })
    .safeParse(claims);
  if (!identity.success) throw new SignInError("email_unverified");
  const { sub, name } = identity.data;
  const email = identity.data.email.trim().toLowerCase();
  return tx(async (db) => {
    // Serialize identity and email resolution so competing callbacks cannot create duplicates.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "sunhub-identity:" + flow.issuer + ":" + sub,
    ]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "sunhub-email:" + email,
    ]);
    const linked = (
      await db.query(
        "SELECT user_id FROM external_identities WHERE issuer=$1 AND subject=$2",
        [flow.issuer, sub],
      )
    ).rows[0];
    if (flow.link_user_id) {
      const user = (
        await db.query(
          "SELECT u.id,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.token_hash=$2 AND s.expires_at>now() FOR UPDATE OF u",
          [flow.link_user_id, flow.link_session_hash],
        )
      ).rows[0];
      if (!user) throw new SignInError("expired");
      if (user.email !== email || (linked && linked.user_id !== user.id))
        throw new SignInError("account_conflict");
      const other = (
        await db.query(
          "SELECT subject FROM external_identities WHERE issuer=$1 AND user_id=$2",
          [flow.issuer, user.id],
        )
      ).rows[0];
      if (other && other.subject !== sub)
        throw new SignInError("account_conflict");
      if (!linked) {
        await db.query(
          "INSERT INTO external_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
          [flow.issuer, sub, user.id],
        );
        await db.query(
          "INSERT INTO auth_events(user_id,event) VALUES($1,'sunhub_linked')",
          [user.id],
        );
      }
      await db.query(
        "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
        [user.id],
      );
      return user.id as string;
    }
    if (linked) return linked.user_id as string;
    // Email alone never links an existing account, even when the issuer verifies it.
    if (
      (await db.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount
    )
      throw new SignInError("account_conflict");
    const user = (
      await db.query(
        "INSERT INTO users(name,email,password_hash,account_type,email_verified_at) VALUES($1,$2,'external:sunhub',$3,now()) ON CONFLICT(email) DO NOTHING RETURNING id",
        [name || email.split("@")[0], email, flow.account_type],
      )
    ).rows[0];
    if (!user) throw new SignInError("account_conflict");
    await db.query(
      "INSERT INTO external_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
      [flow.issuer, sub, user.id],
    );
    await db.query(
      "INSERT INTO auth_events(user_id,event) VALUES($1,'registered_with_sunhub')",
      [user.id],
    );
    return user.id as string;
  });
}
export function sunhubSsoRoutes() {
  const router = Router();
  router.get("/auth/sunhub/config", (_req, res) =>
    res.json({ enabled: !!issuer() }),
  );
  router.get("/auth/sunhub/start", async (req, res) => {
    const parsed = z
      .object({
        intent: z.enum(["login", "signup", "link"]).default("login"),
        accountType: z.enum(["company", "individual"]).default("company"),
        returnTo: z.string().optional(),
        platform: z.literal("android").optional(),
        redirect_uri: z.string().optional(),
        code_challenge: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .optional(),
        state: z
          .string()
          .regex(/^[A-Za-z0-9_-]{32,128}$/)
          .optional(),
      })
      .parse(req.query);
    if (
      parsed.platform &&
      (!nativeRedirects.has(parsed.redirect_uri || "") ||
        !parsed.code_challenge ||
        !parsed.state ||
        parsed.intent === "link")
    )
      throw new HttpError(400, "Invalid Sunhub app sign-in request.");
    if (parsed.intent === "link" && !req.auth)
      throw new HttpError(401, "Sign in to Connect before linking Sunhub.");
    const flow: Flow = {
      issuer: issuer() || "",
      verifier: oidc.randomPKCECodeVerifier(),
      nonce: oidc.randomNonce(),
      return_to: safeReturnTo(parsed.returnTo),
      account_type: parsed.accountType,
      link_user_id: parsed.intent === "link" ? req.auth!.userId : null,
      link_session_hash: parsed.intent === "link" ? req.auth!.tokenHash : null,
      mobile_redirect: parsed.platform ? parsed.redirect_uri! : null,
      mobile_state: parsed.platform ? parsed.state! : null,
      mobile_challenge: parsed.platform ? parsed.code_challenge! : null,
    };
    let config;
    try {
      config = await configuration();
    } catch {
      return finish(res, flow, "unavailable");
    }
    const state = oidc.randomState(),
      browser = random();
    await pool.query("DELETE FROM oidc_flows WHERE expires_at<=now()");
    await pool.query(
      "DELETE FROM mobile_auth_handoffs WHERE expires_at<=now()",
    );
    await pool.query(
      `INSERT INTO oidc_flows(state_hash,browser_hash,verifier,nonce,issuer,return_to,account_type,link_user_id,link_session_hash,mobile_redirect,mobile_state,mobile_challenge) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        hashToken(state),
        hashToken(browser),
        flow.verifier,
        flow.nonce,
        flow.issuer,
        flow.return_to,
        flow.account_type,
        flow.link_user_id,
        flow.link_session_hash,
        flow.mobile_redirect,
        flow.mobile_state,
        flow.mobile_challenge,
      ],
    );
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callback(),
      scope: "openid email profile",
      state,
      nonce: flow.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: "S256",
      ...(parsed.intent === "signup" ? { screen_hint: "signup" } : {}),
    });
    res.cookie(cookieName(state), browser, cookieOptions());
    res.redirect(303, url.href);
  });
  router.get("/auth/sunhub/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const browser = flowCookie(req, state);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state) || !browser)
      return finish(res, undefined, "expired");
    // Consume exactly once, and only in the browser that initiated this flow.
    const flow = (
      await pool.query(
        "DELETE FROM oidc_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *",
        [hashToken(state), hashToken(browser)],
      )
    ).rows[0] as Flow | undefined;
    res.clearCookie(cookieName(state), {
      ...cookieOptions(),
      maxAge: undefined,
    });
    if (!flow) return finish(res, undefined, "expired");
    try {
      if (flow.issuer !== issuer() || req.query.iss !== flow.issuer)
        throw new SignInError("failed");
      if (req.query.error)
        throw new SignInError(
          req.query.error === "access_denied" ? "cancelled" : "failed",
        );
      if (
        flow.link_user_id &&
        (req.auth?.userId !== flow.link_user_id ||
          req.auth.tokenHash !== flow.link_session_hash)
      )
        throw new SignInError("expired");
      const tokens = await oidc.authorizationCodeGrant(
        await configuration(),
        new URL(req.originalUrl, origin()),
        {
          pkceCodeVerifier: flow.verifier,
          expectedNonce: flow.nonce,
          expectedState: state,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (!claims) throw new SignInError("failed");
      const userId = await identityUser(flow, claims);
      if (flow.mobile_redirect) {
        const code = random();
        await pool.query(
          "INSERT INTO mobile_auth_handoffs(code_hash,challenge,user_id) VALUES($1,$2,$3)",
          [hashToken(code), flow.mobile_challenge, userId],
        );
        const target = new URL(flow.mobile_redirect);
        target.searchParams.set("code", code);
        target.searchParams.set("state", flow.mobile_state!);
        return res.redirect(303, target.href);
      }
      if (!flow.link_user_id) {
        const company =
          (
            await pool.query(
              "SELECT company_id FROM memberships WHERE user_id=$1 ORDER BY company_id LIMIT 1",
              [userId],
            )
          ).rows[0]?.company_id || null;
        await createSession(res, userId, company, req.get("user-agent"));
      }
      await pool.query(
        "INSERT INTO auth_events(user_id,event) VALUES($1,'sunhub_signed_in')",
        [userId],
      );
      const target = new URL(flow.return_to, origin());
      if (flow.link_user_id) target.searchParams.set("sunhub_linked", "1");
      res.redirect(303, target.pathname + target.search + target.hash);
    } catch (error) {
      // Never log authorization codes, tokens, claims, or upstream error bodies.
      const reason = error instanceof SignInError ? error.message : "failed";
      return finish(res, flow, reason);
    }
  });
  router.post("/auth/sunhub/mobile/exchange", async (req, res) => {
    const b = z
      .object({
        code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      })
      .parse(req.body);
    const result = await tx(async (db) => {
      const row = (
        await db.query(
          "DELETE FROM mobile_auth_handoffs WHERE code_hash=$1 AND challenge=$2 AND expires_at>now() RETURNING user_id",
          [hashToken(b.code), challenge(b.verifier)],
        )
      ).rows[0];
      if (!row)
        throw new HttpError(
          400,
          "This sign-in expired. Start again from the app.",
        );
      const companyId =
        (
          await db.query(
            "SELECT company_id FROM memberships WHERE user_id=$1 ORDER BY company_id LIMIT 1",
            [row.user_id],
          )
        ).rows[0]?.company_id || null;
      await createSession(
        res,
        row.user_id,
        companyId,
        req.get("user-agent"),
        db,
      );
      await db.query(
        "INSERT INTO auth_events(user_id,event) VALUES($1,'sunhub_signed_in_android')",
        [row.user_id],
      );
      return { userId: row.user_id as string, companyId };
    });
    res.json(await sessionPayload(result.userId, result.companyId));
  });
  return router;
}
