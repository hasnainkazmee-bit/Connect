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
    "managed companies with teams are searchable and paginated, excluding the acting company",
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
        for (let i = 0; i < 27; i++) {
          const added = await db.query(
            "INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id",
            [marker + " " + String(i).padStart(2, "0"), marker + "-" + i],
          );
          await db.query(
            "INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'owner')",
            [added.rows[0].id, B.user.id],
          );
        }
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
      assert.equal(
        responses.find((r) => r.status === 200).data.status,
        "accepted",
      );
      assert.ok(responses.find((r) => r.status === 200).data.responded_at);
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
      assert.equal((await member(`/join/${token}/accept`, {})).status, 200);
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

test("Colabb company messaging keeps recipients, notices and attachments scoped", async (t) => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  const db = new pg.Pool({ connectionString: databaseUrl.href });
  const a = client(),
    b = client(),
    demo = client(),
    outsider = client(),
    member = client();
  const marker = "colabb-message-" + randomUUID().slice(0, 8);
  async function register(cli, name, withCompany = true) {
    const result = await cli("/auth/register", {
      name,
      email: `${name.toLowerCase()}-${randomUUID()}@example.test`,
      password: "MessageRequest123!",
      ...(withCompany ? { companyName: `${marker} ${name}` } : {}),
    });
    assert.equal(result.status, 201);
    return result.data;
  }
  const A = await register(a, "Alice"),
    B = await register(b, "Bob"),
    D = await register(demo, "Demo"),
    O = await register(outsider, "Outside"),
    M = await register(member, "Member", false);
  const send = (
    cli,
    target,
    note = "Could we discuss partnering on the next installation?",
  ) => cli("/requests", { companyId: target, kind: "message", note });
  let requestId, connectionId, attachmentId;
  try {
    await db.query("UPDATE companies SET is_demo=true WHERE id=$1", [
      D.activeCompanyId,
    ]);
    const unclaimed = (
      await db.query(
        "INSERT INTO companies(name,slug,listing_status) VALUES($1,$2,'unclaimed') RETURNING id",
        [`${marker} Unclaimed`, `${marker}-unclaimed`],
      )
    ).rows[0].id;
    const empty = (
      await db.query(
        "INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id",
        [`${marker} No team`, `${marker}-empty`],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'member')",
      [B.activeCompanyId, M.user.id],
    );
    await db.query("UPDATE sessions SET company_id=$1 WHERE user_id=$2", [
      B.activeCompanyId,
      M.user.id,
    ]);

    await t.test(
      "recipient search excludes unclaimed, ownerless, blocked and other-demo companies",
      async () => {
        const found = (await a(`/messaging/companies?q=${marker}`)).data
          .companies;
        assert.deepEqual(
          new Set(found.map((c) => c.id)),
          new Set([B.activeCompanyId, O.activeCompanyId]),
        );
        assert.equal((await send(a, unclaimed)).status, 409);
        assert.equal((await send(a, empty)).status, 409);
        assert.equal((await send(a, D.activeCompanyId)).status, 404);
        assert.equal((await send(demo, A.activeCompanyId)).status, 404);
        assert.equal(
          (
            await outsider(`/relationships/${A.activeCompanyId}`, {
              action: "block",
            })
          ).status,
          200,
        );
        const afterBlock = (await a(`/messaging/companies?q=${marker}`)).data
          .companies;
        assert.deepEqual(
          afterBlock.map((c) => c.id),
          [B.activeCompanyId],
        );
        assert.equal((await send(a, O.activeCompanyId)).status, 403);
      },
    );

    await t.test(
      "company request notices are actionable in Colabb and read only by the current reader",
      async () => {
        const created = await send(a, B.activeCompanyId);
        assert.equal(created.status, 201);
        requestId = created.data.id;
        const notices = (await b("/notifications?scope=colabb")).data
          .notifications;
        const notice = notices.find((n) => n.type === "message_request");
        assert.ok(notice);
        assert.equal(
          notice.url,
          `/inbox/companies?company=${A.activeCompanyId}`,
        );
        assert.equal(
          (await member("/notifications?scope=colabb")).data.notifications.some(
            (n) => n.id === notice.id,
          ),
          false,
        );
        assert.equal(
          (
            await outsider("/notifications/read-context", {
              kind: "company_request",
              id: requestId,
            })
          ).status,
          404,
        );
        const read = await b("/notifications/read-context", {
          kind: "company_request",
          id: requestId,
        });
        assert.equal(read.status, 200);
        assert.ok(read.data.ids.includes(notice.id));
        assert.equal(
          (await member(`/requests/${requestId}/respond`, { action: "accept" }))
            .status,
          403,
        );
        const accepted = await b(`/requests/${requestId}/respond`, {
          action: "accept",
        });
        assert.equal(accepted.status, 200);
        assert.equal(accepted.data.status, "accepted");
        connectionId = accepted.data.connectionId;
        const received = (
          await a("/notifications?scope=colabb")
        ).data.notifications.find((n) => n.type === "accepted");
        assert.equal(
          received.url,
          `/inbox/companies?company=${B.activeCompanyId}`,
        );
      },
    );

    await t.test(
      "accepted company members can reply and PDF previews retain attachment authorization",
      async () => {
        const body = new FormData();
        body.set("body", "Here are the installation plans.");
        body.set("clientId", randomUUID());
        body.append(
          "files",
          new Blob(["%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"], {
            type: "application/pdf",
          }),
          "plans.pdf",
        );
        assert.equal(
          (await member(`/conversations/${connectionId}/messages`, body))
            .status,
          201,
        );
        const duplicate = await member(
          `/conversations/${connectionId}/messages`,
          body,
        );
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.data.duplicate, true);
        const notices = (await a("/notifications?scope=colabb")).data
          .notifications;
        assert.equal(
          notices.find((n) => n.type === "message").url,
          `/inbox/companies?company=${B.activeCompanyId}`,
        );
        const conversation = (
          await a(`/conversations/${connectionId}/messages`)
        ).data;
        assert.equal(conversation.messages.length, 2);
        assert.equal(conversation.messages[0].source_request_id, requestId);
        attachmentId = conversation.messages[1].attachments[0].id;
        const inline = await a(`/attachments/${attachmentId}?inline=1`);
        assert.equal(inline.status, 200);
        assert.match(inline.headers.get("content-type"), /^application\/pdf/);
        assert.equal(inline.headers.get("content-disposition"), "inline");
        assert.equal(inline.headers.get("x-frame-options"), "SAMEORIGIN");
        assert.equal(inline.headers.get("x-content-type-options"), "nosniff");
        assert.match(
          (await a(`/attachments/${attachmentId}`)).headers.get(
            "content-disposition",
          ),
          /^attachment/,
        );
        assert.equal(
          (await outsider(`/attachments/${attachmentId}?inline=1`)).status,
          404,
        );
        assert.equal(
          (await a("/network")).data.connections.find(
            (c) => c.id === connectionId,
          ).unread,
          0,
        );
        const clear = await a("/notifications/read-context", {
          kind: "company_conversation",
          id: connectionId,
        });
        assert.equal(clear.status, 200);
        assert.equal(
          (await a("/notifications?scope=colabb")).data.notifications.find(
            (n) => n.type === "message",
          ).read_at !== null,
          true,
        );
        await db.query(
          "DELETE FROM memberships WHERE user_id=$1 AND company_id=$2",
          [M.user.id, B.activeCompanyId],
        );
        assert.equal(
          (await member(`/conversations/${connectionId}/messages`)).status,
          403,
        );
        assert.equal(
          (await member(`/attachments/${attachmentId}?inline=1`)).status,
          403,
        );
      },
    );

    await t.test(
      "historic connected mixed-demo threads keep working without admitting new cross-cohort requests",
      async () => {
        const [lo, hi] = [A.activeCompanyId, D.activeCompanyId].sort();
        const existing = (
          await db.query(
            "INSERT INTO connections(company_a,company_b) VALUES($1,$2) RETURNING id",
            [lo, hi],
          )
        ).rows[0].id;
        const body = new FormData();
        body.set("body", "Continuing our existing demonstration conversation.");
        assert.equal(
          (await a(`/conversations/${existing}/messages`, body)).status,
          201,
        );
        assert.equal(
          (await demo(`/conversations/${existing}/messages`)).data.messages
            .length,
          1,
        );
        assert.equal(
          (await outsider(`/conversations/${existing}/messages`)).status,
          404,
        );
        const pending = (
          await db.query(
            "INSERT INTO connection_requests(from_id,to_id,author_id,note,kind) VALUES($1,$2,$3,'Old demonstration request','message') RETURNING id",
            [B.activeCompanyId, D.activeCompanyId, B.user.id],
          )
        ).rows[0].id;
        assert.equal(
          (await demo(`/requests/${pending}/respond`, { action: "accept" }))
            .status,
          404,
        );
        assert.equal(
          (await demo(`/requests/${pending}/respond`, { action: "decline" }))
            .status,
          200,
        );
      },
    );
  } finally {
    await db.end();
  }
});
