import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.API_TEST_URL || "http://localhost:4101";
function client() {
  let cookie = "";
  return async (path, body, options = {}) => {
    const response = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      ...options,
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = response.headers.get("content-type");
    return {
      status: response.status,
      data: type?.includes("application/json")
        ? await response.json()
        : await response.text(),
      headers: response.headers,
    };
  };
}
import pg from "pg";

test("directory messaging and consent-based connections", async (t) => {
  const a = client(),
    b = client(),
    c = client(),
    member = client(),
    anon = client();
  const suffix = randomUUID().slice(0, 8);
  const register = async (cli, name, withCompany = true) => {
    const result = await cli("/auth/register", {
      name,
      email: name.toLowerCase() + suffix + "@example.test",
      password: "MessageRequest123!",
      ...(withCompany ? { companyName: name + " Solar " + suffix } : {}),
    });
    assert.equal(result.status, 201);
    return result.data;
  };
  const A = await register(a, "Alice"),
    B = await register(b, "Bob"),
    C = await register(c, "Casey"),
    M = await register(member, "Member", false);
  let requestId, connectionId;
  const intro =
    "We’re looking for an installation partner for a commercial rooftop.";
  const send = (cli, target, note = intro) =>
    cli("/requests", { companyId: target, kind: "message", note });

  await t.test(
    "all directory companies are searchable and paginated, excluding the acting company",
    async () => {
      assert.equal((await anon("/messaging/companies")).status, 401);
      const result = await a("/messaging/companies?q=" + suffix);
      assert.equal(result.status, 200);
      assert.equal(result.data.total, 2);
      assert.deepEqual(
        new Set(result.data.companies.map((co) => co.id)),
        new Set([B.activeCompanyId, C.activeCompanyId]),
      );
      assert.equal((await a("/messaging/companies?page=0")).status, 400);
      const databaseUrl = new URL(process.env.DATABASE_URL);
      assert.ok(
        databaseUrl.pathname.endsWith("_test"),
        "Fixtures require an isolated test database",
      );
      const db = new pg.Pool({ connectionString: databaseUrl.href });
      const marker = "paging-" + suffix;
      try {
        for (let i = 0; i < 27; i++)
          await db.query("INSERT INTO companies(name,slug) VALUES($1,$2)", [
            marker + " " + String(i).padStart(2, "0"),
            marker + "-" + i,
          ]);
        const first = (await a("/messaging/companies?q=" + marker)).data;
        const second = (await a("/messaging/companies?q=" + marker + "&page=2"))
          .data;
        assert.equal(first.total, 27);
        assert.equal(first.companies.length, 24);
        assert.equal(second.companies.length, 3);
        assert.equal(
          new Set([...first.companies, ...second.companies].map((co) => co.id))
            .size,
          27,
        );
      } finally {
        await db.query("DELETE FROM companies WHERE slug LIKE $1", [
          marker + "%",
        ]);
        await db.end();
      }
    },
  );
  await t.test(
    "first messages are private pending requests, with no connection before consent",
    async () => {
      assert.equal((await send(anon, B.activeCompanyId)).status, 401);
      assert.equal((await send(a, A.activeCompanyId)).status, 400);
      assert.equal((await send(a, B.activeCompanyId, " ")).status, 400);
      assert.equal(
        (await send(a, B.activeCompanyId, "x".repeat(2001))).status,
        400,
      );
      const result = await send(a, B.activeCompanyId);
      assert.equal(result.status, 201);
      requestId = result.data.id;
      assert.equal(result.data.kind, "message");
      const sender = (await a("/network")).data,
        recipient = (await b("/network")).data;
      assert.equal(sender.connections.length, 0);
      assert.equal(recipient.connections.length, 0);
      assert.equal(sender.sent[0].id, requestId);
      assert.equal(recipient.incoming[0].note, intro);
      assert.equal(recipient.notifications[0].type, "message_request");
      assert.equal((await c("/network")).data.incoming.length, 0);
      assert.ok(
        !JSON.stringify(
          (await anon("/companies/" + A.activeCompanyId)).data,
        ).includes(intro),
      );
    },
  );
  await t.test(
    "message and connection requests share duplicate and reciprocal protection",
    async () => {
      const results = await Promise.all([
        send(a, B.activeCompanyId),
        send(b, A.activeCompanyId),
        b("/requests", { companyId: A.activeCompanyId, note: "Connect" }),
      ]);
      assert.ok(results.every((r) => r.status === 409));
      assert.equal((await b("/network")).data.incoming.length, 1);
    },
  );
  await t.test(
    "only the recipient may accept; racing accepts preserve exactly one original message",
    async () => {
      assert.equal(
        (await a(`/requests/${requestId}/respond`, { action: "accept" }))
          .status,
        404,
      );
      assert.equal(
        (await c(`/requests/${requestId}/respond`, { action: "accept" }))
          .status,
        404,
      );
      const responses = await Promise.all([
        b(`/requests/${requestId}/respond`, { action: "accept" }),
        b(`/requests/${requestId}/respond`, { action: "accept" }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      connectionId = responses.find((r) => r.status === 200).data.connectionId;
      const network = (await b("/network")).data;
      assert.equal(network.incoming.length, 0);
      assert.equal(network.connections[0].status, "connected");
      assert.equal(network.connections[0].unread, 1);
      const messages = (await b(`/conversations/${connectionId}/messages`)).data
        .messages;
      assert.equal(messages.length, 1);
      assert.equal(messages[0].body, intro);
      assert.equal(messages[0].author_name, "Alice");
      assert.equal(messages[0].sender_company_id, A.activeCompanyId);
      assert.equal(messages[0].source_request_id, requestId);
      assert.equal((await b("/network")).data.connections[0].unread, 0);
      assert.equal(
        (await c(`/conversations/${connectionId}/messages`)).status,
        404,
      );
      const reply = new FormData();
      reply.set("body", "Happy to discuss the scope.");
      assert.equal(
        (await b(`/conversations/${connectionId}/messages`, reply)).status,
        201,
      );
      assert.equal(
        (await a(`/conversations/${connectionId}/messages`)).data.messages
          .length,
        2,
      );
    },
  );
  await t.test(
    "declined and withdrawn requests never create conversations",
    async () => {
      const declined = await send(a, C.activeCompanyId);
      assert.equal(
        (
          await c(`/requests/${declined.data.id}/respond`, {
            action: "decline",
          })
        ).status,
        200,
      );
      assert.equal(
        (await c(`/requests/${declined.data.id}/respond`, { action: "accept" }))
          .status,
        409,
      );
      assert.equal((await c("/network")).data.connections.length, 0);
      const withdrawn = await send(a, C.activeCompanyId);
      assert.equal(
        (
          await a(`/requests/${withdrawn.data.id}/respond`, {
            action: "withdraw",
          })
        ).status,
        200,
      );
      assert.equal((await c("/network")).data.incoming.length, 0);
      assert.equal((await c("/network")).data.connections.length, 0);
    },
  );
  await t.test(
    "reconnecting by message preserves history and prevents replies while pending",
    async () => {
      assert.equal(
        (
          await a(`/relationships/${B.activeCompanyId}`, {
            action: "disconnect",
          })
        ).status,
        200,
      );
      const next = await send(
        a,
        B.activeCompanyId,
        "Can we reconnect for the next project?",
      );
      assert.equal(next.status, 201);
      const reply = new FormData();
      reply.set("body", "Cannot bypass acceptance");
      assert.equal(
        (await a(`/conversations/${connectionId}/messages`, reply)).status,
        403,
      );
      assert.equal(
        (await b(`/conversations/${connectionId}/messages`)).data.messages
          .length,
        2,
      );
      const accepted = await b(`/requests/${next.data.id}/respond`, {
        action: "accept",
      });
      assert.equal(accepted.data.connectionId, connectionId);
      const messages = (await a(`/conversations/${connectionId}/messages`)).data
        .messages;
      assert.equal(messages.length, 3);
      assert.equal(messages[2].body, "Can we reconnect for the next project?");
    },
  );
  await t.test(
    "blocking cancels a pending message and prevents acceptance in either direction",
    async () => {
      const pending = await send(a, C.activeCompanyId);
      assert.equal(
        (await c(`/relationships/${A.activeCompanyId}`, { action: "block" }))
          .status,
        200,
      );
      assert.equal(
        (await c(`/requests/${pending.data.id}/respond`, { action: "accept" }))
          .status,
        409,
      );
      assert.equal((await a("/network")).data.sent.length, 0);
      assert.equal((await send(a, C.activeCompanyId)).status, 403);
      assert.equal((await send(c, A.activeCompanyId)).status, 403);
    },
  );
  await t.test(
    "team members cannot send requests or accept company connections",
    async () => {
      const invite = await b("/team/invites", {
        email: M.user.email,
        role: "member",
      });
      const token = invite.data.url.split("/").at(-1);
      assert.equal(
        (await member(`/join/${token}/accept`, {})).status,
        200,
      );
      assert.equal((await send(member, C.activeCompanyId)).status, 403);
      const pending = await send(c, B.activeCompanyId);
      assert.equal(pending.status, 201);
      assert.equal(
        (
          await member(`/requests/${pending.data.id}/respond`, {
            action: "accept",
          })
        ).status,
        403,
      );
    },
  );
});
