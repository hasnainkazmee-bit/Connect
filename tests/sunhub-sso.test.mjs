import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  generateKeyPairSync,
  sign,
  randomUUID,
  randomBytes,
  createHash,
} from "node:crypto";
import pg from "pg";
const base = process.env.API_TEST_URL,
  issuer = "http://127.0.0.1:4103";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const key = generateKeyPairSync("ed25519"),
  badKey = generateKeyPairSync("ed25519");
const jwk = {
  ...key.publicKey.export({ format: "jwk" }),
  kid: "sunhub-test",
  use: "sig",
  alg: "EdDSA",
};
const codes = new Map();
const hash = (x) => createHash("sha256").update(x).digest("hex");
const pkce = (x) => createHash("sha256").update(x).digest("base64url");
const random = () => randomBytes(32).toString("base64url");
const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
let exchanges = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/.well-known/openid-configuration")
    return res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["EdDSA"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      }),
    );
  if (req.url === "/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
  if (req.url === "/token") {
    exchanges++;
    let body = "";
    for await (const part of req) body += part;
    const f = new URLSearchParams(body),
      data = codes.get(f.get("code"));
    codes.delete(f.get("code"));
    if (
      !data ||
      pkce(f.get("code_verifier") || "") !== data.query.get("code_challenge") ||
      f.get("redirect_uri") !== data.query.get("redirect_uri") ||
      f.get("client_id") !== "sunhub-connect"
    ) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: data.sub,
      aud: "sunhub-connect",
      iat: now,
      exp: now + 300,
      nonce: data.query.get("nonce"),
      name: "Solar Member",
      email: data.email,
      email_verified: true,
      ...data.claims,
    };
    const message =
      encode({ alg: "EdDSA", kid: "sunhub-test" }) + "." + encode(claims);
    const jwt =
      message +
      "." +
      sign(
        null,
        Buffer.from(message),
        data.badSignature ? badKey.privateKey : key.privateKey,
      ).toString("base64url");
    return res.end(
      JSON.stringify({
        access_token: random(),
        token_type: "Bearer",
        expires_in: 300,
        id_token: jwt,
      }),
    );
  }
  res.statusCode = 404;
  res.end("{}");
});
async function request(path, { cookie = "", body } = {}) {
  const r = await fetch(base + path, {
    redirect: "manual",
    method: body ? "POST" : "GET",
    headers: { cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {}
  return {
    status: r.status,
    cookies: r.headers.getSetCookie(),
    location: r.headers.get("location"),
    data,
  };
}
const sessionCookie = (r) =>
  r.cookies
    .filter((x) => x.startsWith("connect_session="))
    .map((x) => x.split(";")[0])
    .join("; ");
async function start(params = {}, cookie = "") {
  const r = await request(
    "/api/auth/sunhub/start?" + new URLSearchParams(params),
    { cookie },
  );
  assert.equal(r.status, 303, JSON.stringify(r));
  const query = new URL(r.location).searchParams;
  assert.equal(query.get("code_challenge_method"), "S256");
  assert.equal(query.get("scope"), "openid email profile");
  assert.ok(query.get("state") && query.get("nonce"));
  return {
    query,
    cookie: [cookie, ...r.cookies.map((x) => x.split(";")[0])]
      .filter(Boolean)
      .join("; "),
    start: r,
  };
}
async function callback(flow, identity = {}, options = {}) {
  const code = random();
  codes.set(code, {
    query: flow.query,
    sub: randomUUID(),
    email: randomUUID() + "@gmail.com",
    ...identity,
  });
  const query = new URLSearchParams({
    state: flow.query.get("state"),
    code,
    iss: issuer,
    ...options.query,
  });
  return request("/api/auth/sunhub/callback?" + query, {
    cookie: options.cookie ?? flow.cookie,
  });
}
const me = (cookie) => request("/api/session", { cookie });
async function localAccount() {
  const email = randomUUID() + "@outlook.com";
  const r = await request("/api/auth/register", {
    body: {
      name: "Connect Owner",
      email,
      password: "Private test password 2026",
      accountType: "company",
      companyName: "SSO Solar " + randomUUID(),
    },
  });
  assert.equal(r.status, 201);
  return {
    email,
    user: r.data.user,
    cookie: sessionCookie(r),
    company: r.data.activeCompanyId,
  };
}
test("Sunhub is an optional verified OIDC sign-in, independent of Connect passwords", async (t) => {
  await new Promise((resolve) => server.listen(4103, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
  });
  const subject = randomUUID(),
    email = randomUUID() + "@gmail.com";
  let userId;
  await t.test(
    "public config and signup preserve account type and destination",
    async () => {
      assert.deepEqual((await request("/api/auth/sunhub/config")).data, {
        enabled: true,
      });
      const flow = await start({
        intent: "signup",
        accountType: "individual",
        returnTo: "/directory?service=solar#results",
      });
      assert.equal(flow.query.get("screen_hint"), "signup");
      const result = await callback(flow, { sub: subject, email });
      assert.equal(result.location, "/directory?service=solar#results");
      assert.ok(!result.location.includes("token"));
      const account = (await me(sessionCookie(result))).data;
      userId = account.user.id;
      assert.equal(account.user.account_type, "individual");
      assert.ok(account.user.email_verified_at);
      assert.equal(account.user.hasPassword, false);
      assert.equal(account.user.sunhubLinked, true);
      assert.equal(account.user.onboarding_completed_at, null);
    },
  );
  await t.test(
    "stable subject restores the same account without overwriting Connect email",
    async () => {
      const result = await callback(await start(), {
        sub: subject,
        email: randomUUID() + "@outlook.com",
      });
      const account = (await me(sessionCookie(result))).data;
      assert.equal(account.user.id, userId);
      assert.equal(account.user.email, email);
    },
  );
  await t.test(
    "foreign browser, replayed state, issuer substitution and expired flows fail closed",
    async () => {
      const flow = await start();
      const before = exchanges;
      const missing = await callback(flow, {}, { cookie: "" });
      assert.match(missing.location, /sso_error=expired/);
      assert.equal(exchanges, before);
      const mismatch = await callback(
        flow,
        {},
        { query: { iss: "https://untrusted.example" } },
      );
      assert.match(mismatch.location, /sso_error=failed/);
      assert.equal(exchanges, before);
      assert.match((await callback(flow)).location, /sso_error=expired/);
      const expired = await start();
      await db.query(
        "UPDATE oidc_flows SET expires_at=now()-interval '1 second' WHERE state_hash=$1",
        [hash(expired.query.get("state"))],
      );
      assert.match((await callback(expired)).location, /sso_error=expired/);
    },
  );
  await t.test(
    "signature, nonce, audience, expiry and verified email are enforced",
    async () => {
      for (const identity of [
        { badSignature: true },
        { claims: { nonce: "wrong" } },
        { claims: { aud: "another-app" } },
        { claims: { exp: 1 } },
        { claims: { email_verified: false } },
      ]) {
        const result = await callback(await start(), identity);
        assert.match(
          result.location,
          /sso_error=(failed|email_unverified)/,
          JSON.stringify(identity),
        );
        assert.equal(sessionCookie(result), "");
      }
    },
  );
  let local;
  const localSubject = randomUUID();
  await t.test(
    "existing Connect account is not silently linked by an email match",
    async () => {
      local = await localAccount();
      const result = await callback(await start(), {
        email: local.email,
        sub: localSubject,
      });
      assert.match(result.location, /sso_error=account_conflict/);
      assert.equal((await me(local.cookie)).data.user.sunhubLinked, false);
    },
  );
  await t.test(
    "an authenticated owner can explicitly link the same verified mailbox",
    async () => {
      const flow = await start(
        { intent: "link", returnTo: "/account" },
        local.cookie,
      );
      const result = await callback(flow, {
        email: local.email,
        sub: localSubject,
      });
      assert.equal(result.location, "/account?sunhub_linked=1");
      assert.equal((await me(local.cookie)).data.user.sunhubLinked, true);
      assert.equal((await me(local.cookie)).data.user.hasPassword, true);
      const login = await callback(await start(), {
        email: local.email,
        sub: localSubject,
      });
      const account = (await me(sessionCookie(login))).data;
      assert.equal(account.user.id, local.user.id);
      assert.equal(account.activeCompanyId, local.company);
    },
  );
  await t.test(
    "link rejects a different mailbox, logged out browser, or replaced identity",
    async () => {
      assert.equal(
        (await request("/api/auth/sunhub/start?intent=link")).status,
        401,
      );
      const other = await localAccount();
      const mismatch = await callback(
        await start({ intent: "link" }, other.cookie),
        { email: "someone-else@gmail.com" },
      );
      assert.match(mismatch.location, /sso_error=account_conflict/);
      const revoked = await start({ intent: "link" }, other.cookie);
      await request("/api/auth/logout", { cookie: other.cookie, body: {} });
      assert.match(
        (await callback(revoked, { email: other.email })).location,
        /sso_error=expired/,
      );
      assert.match(
        (
          await callback(await start({ intent: "link" }, local.cookie), {
            email: local.email,
            sub: "different-subject",
          })
        ).location,
        /sso_error=account_conflict/,
      );
    },
  );
  await t.test(
    "unsafe return locations and native redirect destinations are rejected",
    async () => {
      for (const returnTo of [
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        "/safe/..//evil.example",
        "/api/auth/logout",
      ]) {
        const flow = await start({ returnTo });
        assert.equal(
          (await callback(flow, { sub: subject, email })).location,
          "/",
        );
      }
      const invalid = await request(
        "/api/auth/sunhub/start?" +
          new URLSearchParams({
            platform: "android",
            redirect_uri: "https://evil.example",
            code_challenge: pkce(random()),
            state: random(),
          }),
      );
      assert.equal(invalid.status, 400);
    },
  );
  await t.test(
    "native handoff binds state and PKCE; no browser session or identity token escapes",
    async () => {
      const verifier = random(),
        state = random();
      const flow = await start({
        platform: "android",
        redirect_uri: "com.sunhub.community.debug://auth/sunhub",
        code_challenge: pkce(verifier),
        state,
      });
      const result = await callback(flow, { sub: subject, email });
      const url = new URL(result.location);
      assert.equal(url.protocol, "com.sunhub.community.debug:");
      assert.equal(url.searchParams.get("state"), state);
      assert.deepEqual([...url.searchParams.keys()].sort(), ["code", "state"]);
      assert.equal(sessionCookie(result), "");
      const code = url.searchParams.get("code");
      assert.equal(
        (
          await request("/api/auth/sunhub/mobile/exchange", {
            body: { code, verifier: random() },
          })
        ).status,
        400,
      );
      const success = await request("/api/auth/sunhub/mobile/exchange", {
        body: { code, verifier },
      });
      assert.equal(success.status, 200);
      assert.equal(success.data.user.id, userId);
      assert.ok(sessionCookie(success));
      assert.equal(
        (
          await request("/api/auth/sunhub/mobile/exchange", {
            body: { code, verifier },
          })
        ).status,
        400,
      );
    },
  );
  await t.test("expired native handoffs cannot sign in", async () => {
    const verifier = random();
    const flow = await start({
      platform: "android",
      redirect_uri: "com.sunhub.community://auth/sunhub",
      code_challenge: pkce(verifier),
      state: random(),
    });
    const result = await callback(flow, { sub: subject, email }),
      code = new URL(result.location).searchParams.get("code");
    await db.query(
      "UPDATE mobile_auth_handoffs SET expires_at=now()-interval '1 second' WHERE code_hash=$1",
      [hash(code)],
    );
    assert.equal(
      (
        await request("/api/auth/sunhub/mobile/exchange", {
          body: { code, verifier },
        })
      ).status,
      400,
    );
  });
});
