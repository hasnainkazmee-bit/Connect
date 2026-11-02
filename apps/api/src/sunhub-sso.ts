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
  popup_id: string | null;
  expires_at?: Date;
};
function returnToPopup(res: Response, flow: Flow, error?: string) {
  const target = new URL(safeReturnTo(flow.return_to), origin());
  if (!error && flow.link_user_id)
    target.searchParams.set("sunhub_linked", "1");
  const result = {
    type: "connect:sunhub:complete",
    popupId: flow.popup_id,
    status: error ? "error" : "success",
    ...(error ? { error } : {}),
    returnTo: target.pathname + target.search + target.hash,
  };
  // Only a completion signal crosses windows. Sessions stay in HttpOnly cookies.
  const payload = JSON.stringify(result).replace(/</g, "\\u003c");
  const fallbackTarget = new URL(target);
  if (error)
    fallbackTarget.searchParams.set(
      "sso_error",
      [
        "unavailable",
        "cancelled",
        "expired",
        "failed",
        "account_conflict",
        "email_unverified",
      ].includes(error)
        ? error
        : "failed",
    );
  const href = (
    fallbackTarget.pathname +
    fallbackTarget.search +
    fallbackTarget.hash
  )
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  res.set("Referrer-Policy", "no-referrer");
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to Connect · Sunhub</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#203342;font:14px system-ui,-apple-system,sans-serif;min-height:100vh;min-height:100dvh;opacity:1;transition:opacity 160ms ease}body.is-leaving{opacity:0}
.provider-bar{display:flex;align-items:center;gap:9px;height:44px;padding:0 16px;border-bottom:1px solid #dbe5ed;font-size:13px}.provider-bar img{width:20px;height:20px;object-fit:contain}
main{max-width:464px;margin:auto;padding:48px 32px 32px}h1{font-size:28px;line-height:1.3;font-weight:500;letter-spacing:-.5px;margin:22px 0 12px}p{margin:0;color:#586d7f;line-height:1.65}
.status-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#fff4eb;color:#974100}.status-mark svg{display:none;width:24px;height:24px}.spinner{width:22px;height:22px;border:2px solid #f3d4b9;border-top-color:#b9540a;border-radius:50%;animation:turn 900ms linear infinite}@keyframes turn{to{transform:rotate(360deg)}}
body[data-state="success"] .spinner,body[data-state="return"] .spinner,body[data-state="fallback"] .spinner{display:none}body[data-state="success"] .check-icon,body[data-state="return"] .return-icon,body[data-state="fallback"] .return-icon{display:block}
.fallback-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}.fallback-actions[hidden]{display:none}button,a{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:12px 20px;border:1px solid #dba77d;border-radius:999px;background:#fff;color:#974100;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}button:hover,a:hover{background:#fff4eb}button:focus-visible,a:focus-visible{outline:2px solid #70889a;outline-offset:3px}
@media(max-width:420px){main{padding:40px 24px 28px}}@media(prefers-reduced-motion:reduce){body{transition:none}.spinner{animation:none}}
</style></head><body data-state="waiting"><header class="provider-bar"><img src="/assets/sunhub-symbol.png" alt=""><span>Sign in with Sunhub</span></header>
<main><div class="status-mark" aria-hidden="true"><span class="spinner"></span><svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"/></svg><svg class="return-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6-6 6 6 6M4 12h16"/></svg></div>
<div role="status" aria-live="polite" aria-atomic="true"><h1 id="sunhub-status-title">${error ? "Returning to Connect…" : "Signing you in…"}</h1><p id="sunhub-status-message">Getting your Connect window ready.</p></div>
<div class="fallback-actions" id="sunhub-fallback" hidden><a id="return-to-connect" href="${href}">Return to Connect</a><button id="retry-sunhub-handoff" type="button">Try again</button></div><noscript><p><a href="${href}">Return to Connect</a></p></noscript></main>
<script type="application/json" id="sunhub-result">${payload}</script><script src="/api/auth/sunhub/popup.js"></script></body></html>`);
}
function returnToApp(res: Response, target: URL) {
  const href = target.href
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  res.set("Referrer-Policy", "no-referrer");
  res
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to Connect</title><style>body{margin:0;background:#f2f7fc;color:#203444;font:16px system-ui,sans-serif;min-height:100dvh;display:grid;place-items:center}main{padding:32px;text-align:center;max-width:360px}img{width:170px;height:auto}h1{font-size:28px;letter-spacing:-.5px;margin-top:36px}p{color:#62748a;line-height:1.6}a{display:inline-block;background:#ff710d;color:#142a38;padding:15px 28px;border-radius:999px;font-weight:600;text-decoration:none;margin-top:18px}a:focus-visible{outline:3px solid #203444;outline-offset:4px}</style></head><body><main><img src="/assets/connect-logo.png" alt="Connect"><h1>Back to your community.</h1><p>Continue in the Connect app to finish signing in.</p><a id="return-to-connect" href="${href}">Return to Connect</a><p><small>If the app doesn’t open automatically, tap the button.</small></p></main><script src="/api/auth/sunhub/return.js"></script></body></html>`,
    );
}
function finish(res: Response, flow: Flow | undefined, error: string) {
  if (flow?.popup_id) return returnToPopup(res, flow, error);
  const target = new URL(
    flow?.mobile_redirect || flow?.return_to || "/",
    origin(),
  );
  target.searchParams.set(flow?.mobile_redirect ? "error" : "sso_error", error);
  if (flow?.mobile_redirect)
    target.searchParams.set("state", flow.mobile_state!);
  if (flow?.mobile_redirect) return returnToApp(res, target);
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
  router.get("/auth/sunhub/popup.js", (_req, res) => {
    res.type("application/javascript").send(`
(() => {
  const result = JSON.parse(document.getElementById("sunhub-result").textContent);
  const origin = window.location.origin;
  const opener = window.opener;
  const title = document.getElementById("sunhub-status-title");
  const message = document.getElementById("sunhub-status-message");
  const actions = document.getElementById("sunhub-fallback");
  const retry = document.getElementById("retry-sunhub-handoff");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let channel, timeout, settleTimer, closeTimer, blockedCloseTimer;
  let settled = false, disposed = false;
  const show = (state, heading, detail) => {
    document.body.dataset.state = state;
    title.textContent = heading;
    message.textContent = detail;
  };
  const fallback = () => {
    if (disposed || settled) return;
    show("fallback", result.status === "success" ? "We’re still connecting." : "Let’s return to Connect.", "Open Connect to continue, or try the handoff again.");
    actions.hidden = false;
  };
  const cleanup = () => {
    disposed = true;
    clearTimeout(timeout); clearTimeout(settleTimer); clearTimeout(closeTimer); clearTimeout(blockedCloseTimer);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("pagehide", cleanup);
    retry.removeEventListener("click", notify);
    channel?.close();
  };
  const ready = (value) => {
    if (disposed || settled || !value || typeof value !== "object" || value.type !== "connect:sunhub:ready" || value.popupId !== result.popupId || !["success", "error"].includes(value.status)) return;
    settled = true;
    clearTimeout(timeout);
    actions.hidden = true;
    const success = result.status === "success" && value.status === "success";
    show(success ? "success" : "return", success ? "You’re in." : "Back to Connect.", success ? "Returning to Connect…" : "You can continue or try again in your Connect window.");
    settleTimer = setTimeout(() => {
      document.body.classList.add("is-leaving");
      closeTimer = setTimeout(() => {
        try { window.close(); } catch {}
        if (disposed) return;
        // Some browsers disallow closing a tab opened outside a script.
        blockedCloseTimer = setTimeout(() => {
          document.body.classList.remove("is-leaving");
          actions.hidden = false;
          retry.hidden = true;
          message.textContent = "Return to Connect to continue.";
          cleanup();
        }, 250);
      }, reducedMotion ? 0 : 160);
    }, 600);
  };
  function onMessage(event) {
    if (opener && event.source === opener && event.origin === origin) ready(event.data);
  }
  function notify() {
    if (disposed || settled) return;
    clearTimeout(timeout);
    actions.hidden = true;
    show("waiting", result.status === "success" ? "Signing you in…" : "Returning to Connect…", "Getting your Connect window ready.");
    timeout = setTimeout(fallback, 8000);
    try { if (opener) opener.postMessage(result, origin); } catch {}
    try { channel?.postMessage(result); } catch {}
  }
  window.addEventListener("message", onMessage);
  window.addEventListener("pagehide", cleanup);
  retry.addEventListener("click", notify);
  try {
    channel = new BroadcastChannel("connect-sunhub-" + result.popupId);
    channel.onmessage = (event) => { if (event.origin === origin) ready(event.data); };
  } catch {}
  notify();
})();
`);
  });
  router.get("/auth/sunhub/return.js", (_req, res) => {
    res
      .type("application/javascript")
      .send(
        'const link=document.getElementById("return-to-connect");if(link){try{window.location.replace(link.href)}catch{}}',
      );
  });
  router.get("/auth/sunhub/config", (_req, res) =>
    res.json({ enabled: !!issuer() }),
  );
  router.get("/auth/sunhub/start", async (req, res) => {
    const parsed = z
      .object({
        intent: z.enum(["login", "signup", "link"]).default("login"),
        accountType: z.enum(["company", "individual"]).default("company"),
        returnTo: z.string().optional(),
        display: z.literal("popup").optional(),
        popup_id: z
          .string()
          .regex(/^[A-Za-z0-9_-]{32,128}$/)
          .optional(),
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
      (parsed.display === "popup") !== !!parsed.popup_id ||
      (parsed.platform && parsed.popup_id)
    )
      throw new HttpError(400, "Invalid Sunhub sign-in window.");
    if (
      parsed.platform &&
      (!nativeRedirects.has(parsed.redirect_uri || "") ||
        !parsed.code_challenge ||
        !parsed.state ||
        parsed.intent === "link")
    )
      throw new HttpError(400, "Invalid Sunhub app sign-in request.");
    const flow: Flow = {
      issuer: issuer() || "",
      verifier: oidc.randomPKCECodeVerifier(),
      nonce: oidc.randomNonce(),
      return_to: safeReturnTo(parsed.returnTo),
      account_type: parsed.accountType,
      link_user_id: parsed.intent === "link" ? req.auth?.userId || null : null,
      link_session_hash:
        parsed.intent === "link" ? req.auth?.tokenHash || null : null,
      mobile_redirect: parsed.platform ? parsed.redirect_uri! : null,
      mobile_state: parsed.platform ? parsed.state! : null,
      mobile_challenge: parsed.platform ? parsed.code_challenge! : null,
      popup_id: parsed.popup_id || null,
    };
    if (parsed.intent === "link" && !req.auth) {
      if (flow.popup_id) return finish(res, flow, "expired");
      throw new HttpError(401, "Sign in to Connect before linking Sunhub.");
    }
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
      `INSERT INTO oidc_flows(state_hash,browser_hash,verifier,nonce,issuer,return_to,account_type,link_user_id,link_session_hash,mobile_redirect,mobile_state,mobile_challenge,popup_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
        flow.popup_id,
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
      ...(flow.popup_id ? { display: "popup" } : {}),
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
        "DELETE FROM oidc_flows WHERE state_hash=$1 AND browser_hash=$2 RETURNING *",
        [hashToken(state), hashToken(browser)],
      )
    ).rows[0] as Flow | undefined;
    res.clearCookie(cookieName(state), {
      ...cookieOptions(),
      maxAge: undefined,
    });
    if (!flow) return finish(res, undefined, "expired");
    if (!flow.expires_at || new Date(flow.expires_at).getTime() <= Date.now())
      return finish(res, flow, "expired");
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
        return returnToApp(res, target);
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
      if (flow.popup_id) return returnToPopup(res, flow);
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
