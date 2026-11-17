import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const base = process.env.API_TEST_URL || "http://localhost:4101";
function client() {
  let cookie = "";
  return async (path, body) => {
    const response = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        Cookie: cookie,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, data: await response.json() };
  };
}

test("company read receipts follow explicitly displayed messages", async (t) => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const db = new pg.Pool({ connectionString: url.href });
  const sender = client(),
    reader = client(),
    teammate = client(),
    outsider = client(),
    anonymous = client();
  async function register(cli, name, company = true) {
    const result = await cli("/auth/register", {
      name,
      email: `receipt-${randomUUID()}@example.test`,
      password: "MessageReadTest123!",
      ...(company ? { companyName: `${name} ${randomUUID()}` } : {}),
    });
    assert.equal(result.status, 201);
    return result.data;
  }
  const A = await register(sender, "Sender"),
    B = await register(reader, "Reader"),
    M = await register(teammate, "Teammate", false),
    O = await register(outsider, "Outsider");
  let connectionId;
  try {
    await db.query(
      "INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'member')",
      [B.activeCompanyId, M.user.id],
    );
    await db.query("UPDATE sessions SET company_id=$1 WHERE user_id=$2", [
      B.activeCompanyId,
      M.user.id,
    ]);
    const request = await sender("/requests", {
      companyId: B.activeCompanyId,
      kind: "message",
      note: "An introduction.",
    });
    assert.equal(request.status, 201);
    const accepted = await reader(`/requests/${request.data.id}/respond`, {
      action: "accept",
    });
    assert.equal(accepted.status, 200);
    connectionId = accepted.data.connectionId;
    const sent = [];
    for (const body of [
      "First visible message",
      "Second visible message",
      "Not visible yet",
    ]) {
      const form = new FormData();
      form.set("body", body);
      const response = await sender(
        `/conversations/${connectionId}/messages`,
        form,
      );
      assert.equal(response.status, 201);
      sent.push(response.data);
    }
    const messagesPath = `/conversations/${connectionId}/messages`,
      readPath = `/conversations/${connectionId}/read`;
    const unread = async () =>
      (await reader("/network")).data.connections.find(
        (row) => row.id === connectionId,
      ).unread;
    const notices = async (user) =>
      (
        await db.query(
          "SELECT id,event_key,read_at FROM user_notifications WHERE user_id=$1 AND source_kind='connection' AND source_id=$2 ORDER BY sequence",
          [user, connectionId],
        )
      ).rows;

    await t.test(
      "no-read polling neither advances receipts nor clears notifications",
      async () => {
        assert.equal(await unread(), 4);
        for (let i = 0; i < 2; i++) {
          const page = await reader(messagesPath + "?read=false");
          assert.equal(page.status, 200);
          assert.equal(page.data.messages.length, 4);
        }
        assert.equal(await unread(), 4);
        assert.equal(
          (await sender(messagesPath + "?read=false")).data.peerReadSequence,
          "0",
        );
        assert.ok(
          (await notices(B.user.id)).every((row) => row.read_at === null),
        );
        assert.equal(
          (await reader(messagesPath + "?read=invalid")).status,
          400,
        );
      },
    );

    await t.test(
      "partial reads clear only that reader's eligible notifications through the cutoff",
      async () => {
        const first = await reader(readPath, { sequence: sent[0].sequence });
        assert.equal(first.status, 200);
        assert.equal(first.data.ok, true);
        assert.equal(first.data.changed, true);
        assert.equal(first.data.readSequence, sent[0].sequence);
        const ownerNotices = await notices(B.user.id),
          teamNotices = await notices(M.user.id);
        assert.deepEqual(
          first.data.notificationIds,
          ownerNotices
            .filter((row) => row.event_key === `message:${sent[0].id}`)
            .map((row) => row.id),
        );
        assert.equal(ownerNotices.filter((row) => row.read_at).length, 1);
        assert.ok(teamNotices.every((row) => row.read_at === null));
        assert.equal(await unread(), 2);
        assert.equal(
          (await sender(messagesPath + "?read=false")).data.peerReadSequence,
          sent[0].sequence,
        );

        // An expired notification cannot be marked by this endpoint even when its message was displayed.
        await db.query(
          "UPDATE user_notifications SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND event_key=$2",
          [B.user.id, `message:${sent[1].id}`],
        );
        const second = await reader(readPath, { sequence: sent[1].sequence });
        assert.equal(second.status, 200);
        assert.equal(second.data.changed, true);
        assert.deepEqual(second.data.notificationIds, []);
        assert.equal(await unread(), 1);
        const remaining = await notices(B.user.id);
        assert.equal(
          remaining.find((row) => row.event_key === `message:${sent[1].id}`)
            .read_at,
          null,
        );
        assert.equal(
          remaining.find((row) => row.event_key === `message:${sent[2].id}`)
            .read_at,
          null,
        );
      },
    );

    await t.test(
      "older and repeated acknowledgements never regress the shared receipt",
      async () => {
        const older = await reader(readPath, { sequence: sent[0].sequence });
        assert.equal(older.status, 200);
        assert.equal(older.data.changed, false);
        assert.equal(older.data.readSequence, sent[1].sequence);
        assert.deepEqual(older.data.notificationIds, []);
        const member = await teammate(readPath, { sequence: sent[0].sequence });
        assert.equal(member.status, 200);
        assert.equal(member.data.changed, false);
        assert.equal(member.data.readSequence, sent[1].sequence);
        assert.equal(member.data.notificationIds.length, 1);
        assert.equal(
          (await notices(M.user.id)).filter((row) => row.read_at).length,
          1,
        );
        assert.equal(await unread(), 1);
        const latest = await reader(readPath, { sequence: sent[2].sequence });
        assert.equal(latest.data.changed, true);
        assert.equal(await unread(), 0);
        const repeated = await reader(readPath, { sequence: sent[2].sequence });
        assert.equal(repeated.data.changed, false);
        assert.deepEqual(repeated.data.notificationIds, []);
      },
    );

    await t.test(
      "read cutoffs must belong to the authorized conversation",
      async () => {
        assert.equal(
          (await anonymous(readPath, { sequence: sent[0].sequence })).status,
          401,
        );
        assert.equal(
          (await outsider(readPath, { sequence: sent[0].sequence })).status,
          404,
        );
        assert.equal(
          (await outsider(messagesPath + "?read=false")).status,
          404,
        );
        const otherPair = [A.activeCompanyId, O.activeCompanyId].sort();
        const otherConnection = (
          await db.query(
            "INSERT INTO connections(company_a,company_b) VALUES($1,$2) RETURNING id",
            otherPair,
          )
        ).rows[0].id;
        const otherMessage = (
          await db.query(
            "INSERT INTO messages(connection_id,sender_company_id,author_id,body) VALUES($1,$2,$3,'Other conversation') RETURNING sequence",
            [otherConnection, A.activeCompanyId, A.user.id],
          )
        ).rows[0];
        assert.equal(
          (await reader(readPath, { sequence: otherMessage.sequence })).status,
          404,
        );
        assert.equal(
          (await reader(readPath, { sequence: "9223372036854775807" })).status,
          404,
        );
        for (const sequence of ["0", "-1", "1.2", "9223372036854775808", 1])
          assert.equal((await reader(readPath, { sequence })).status, 400);
        await db.query(
          "DELETE FROM memberships WHERE company_id=$1 AND user_id=$2",
          [B.activeCompanyId, M.user.id],
        );
        assert.equal(
          (await teammate(readPath, { sequence: sent[0].sequence })).status,
          403,
        );
      },
    );

    await t.test(
      "legacy latest-page reads still automatically acknowledge messages",
      async () => {
        const form = new FormData();
        form.set("body", "Legacy client message");
        const next = await sender(messagesPath, form);
        assert.equal(next.status, 201);
        assert.equal(await unread(), 1);
        assert.equal((await reader(messagesPath)).status, 200);
        assert.equal(await unread(), 0);
        assert.equal(
          (await sender(messagesPath + "?read=false")).data.peerReadSequence,
          next.data.sequence,
        );
      },
    );
  } finally {
    await db.end();
  }
});
