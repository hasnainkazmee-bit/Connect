import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";
const base = process.env.API_TEST_URL + "/api";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
async function request(path, cookie = "", body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    cookies: response.headers.getSetCookie(),
    data: await response.json(),
  };
}
function token(result) {
  return result.cookies
    .find((cookie) => cookie.startsWith("sunhub_session="))
    .split(";")[0]
    .split("=")[1];
}
test("Connect sessions persist independently of other Sunhub cookies", async (t) => {
  t.after(() => db.end());
  const password = "ConnectSession123!";
  const email = `session-${randomUUID()}@example.test`;
  const registered = await request("/auth/register", "", {
    name: "Session Owner",
    email,
    password,
    companyName: "Session Solar " + randomUUID().slice(0, 8),
  });
  assert.equal(registered.status, 201);
  const owner = registered.data,
    valid = token(registered),
    foreign = randomBytes(32).toString("hex");
  await t.test(
    "sign-in issues persistent host-only cookies for web and existing Android clients",
    async () => {
      for (const name of ["sunhub_session", "connect_session"]) {
        const cookie = registered.cookies.find((value) =>
          value.startsWith(name + "="),
        );
        assert.ok(cookie.includes("Max-Age=604800"));
        assert.ok(cookie.includes("HttpOnly"));
        assert.ok(cookie.includes("SameSite=Lax"));
        assert.ok(cookie.includes("Path=/"));
        assert.ok(!cookie.includes("Domain="));
      }
    },
  );
  await t.test(
    "legacy sessions survive duplicate CRM cookies in either order and migrate without extending expiry",
    async () => {
      const expiry = new Date(Date.now() + 3_600_000);
      await db.query("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", [
        expiry,
        tokenHash(valid),
      ]);
      for (const cookie of [
        `sunhub_session=${foreign}; sunhub_session=${valid}`,
        `sunhub_session=${valid}; sunhub_session=${foreign}`,
      ]) {
        const response = await request("/session", cookie);
        assert.equal(response.data.user.id, owner.user.id);
        const migrated = response.cookies.find((value) =>
          value.startsWith("connect_session="),
        );
        assert.ok(migrated.startsWith("connect_session=" + valid + ";"));
        const browserExpiry = new Date(migrated.match(/Expires=([^;]+)/)[1]);
        assert.ok(Math.abs(browserExpiry.getTime() - expiry.getTime()) < 1000);
      }
    },
  );
  await t.test(
    "scoped cookies keep messages and employee invitations authenticated",
    async () => {
      const cookie = `sunhub_session=${foreign}; connect_session=${valid}; sunhub_session=${valid}`;
      assert.equal((await request("/network", cookie)).status, 200);
      const invite = await request("/team/invites", cookie, {
        email: `employee-${randomUUID()}@example.test`,
        role: "member",
      });
      assert.equal(invite.status, 201);
      assert.ok(invite.data.url.includes("/join/"));
    },
  );
  await t.test(
    "an invalid scoped session cannot silently use a different legacy identity",
    async () => {
      const other = await request("/auth/register", "", {
        name: "Other Owner",
        email: `other-${randomUUID()}@example.test`,
        password,
        companyName: "Other Solar " + randomUUID().slice(0, 8),
      });
      const legacy = token(other);
      const cookie = `connect_session=${foreign}; sunhub_session=${legacy}`;
      assert.equal((await request("/session", cookie)).data.user, null);
      assert.equal((await request("/network", cookie)).status, 401);
      assert.equal(
        (
          await request(
            "/session",
            `connect_session=${valid}; sunhub_session=${legacy}`,
          )
        ).data.user.id,
        owner.user.id,
      );
    },
  );
  await t.test(
    "logout clears both cookies and revokes both forms of the same session",
    async () => {
      const response = await request(
        "/auth/logout",
        `connect_session=${valid}`,
        {},
      );
      for (const name of ["sunhub_session", "connect_session"])
        assert.ok(
          response.cookies.some((value) => value.startsWith(name + "=;")),
        );
      assert.equal(
        (await request("/session", `connect_session=${valid}`)).data.user,
        null,
      );
      assert.equal(
        (await request("/session", `sunhub_session=${valid}`)).data.user,
        null,
      );
      const loggedIn = await request("/auth/login", "", { email, password });
      const nextToken = token(loggedIn);
      const sessions = await request(
        "/auth/sessions",
        `connect_session=${nextToken}`,
      );
      const revoked = await request(
        "/auth/sessions/revoke",
        `connect_session=${nextToken}`,
        { id: sessions.data.sessions.find((value) => value.current).id },
      );
      for (const name of ["sunhub_session", "connect_session"])
        assert.ok(
          revoked.cookies.some((value) => value.startsWith(name + "=;")),
        );
      assert.equal(
        (
          await request(
            "/network",
            `sunhub_session=${nextToken}; connect_session=${nextToken}`,
          )
        ).status,
        401,
      );
    },
  );
});
