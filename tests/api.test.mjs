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
test("authenticated company lifecycle and isolation", async (t) => {
  const a = client(),
    b = client(),
    c = client(),
    member = client(),
    anon = client(),
    suffix = randomUUID().slice(0, 8),
    password = "TestPassword123!";
  const register = async (cli, name, company) => {
    const r = await cli("/auth/register", {
      name,
      email: name.toLowerCase() + suffix + "@example.test",
      password,
      ...(company ? { companyName: company + " " + suffix } : {}),
    });
    assert.equal(r.status, 201);
    return r.data;
  };
  let A, B, C, M, requestId, connectionId, attachmentId;
  await t.test(
    "public directory is accessible; private network is not",
    async () => {
      assert.equal((await anon("/companies")).status, 200);
      assert.equal((await anon("/network")).status, 401);
    },
  );
  await t.test(
    "registration creates durable accounts and company membership",
    async () => {
      A = await register(a, "Alice", "Aster");
      B = await register(b, "Bob", "Birch");
      C = await register(c, "Casey", "Cedar");
      M = await register(member, "Morgan");
      assert.equal(A.companies[0].role, "owner");
      assert.equal((await a("/session")).data.user.id, A.user.id);
    },
  );
  await t.test(
    "editable company details drive public search and filters",
    async () => {
      const profile = {
        name: A.companies[0].name,
        tagline: "Commercial project partners",
        description: "Installer team in Seattle",
        type: "Installer",
        location: "Seattle, WA",
        service_areas: ["Washington"],
        services: ["Commercial rooftops"],
        website: "https://example.com",
      };
      assert.equal(
        (await a("/companies/current", profile, { method: "PATCH" })).status,
        200,
      );
      const directory = await anon(
        "/companies?q=" +
          suffix +
          "&service=Commercial%20rooftops&area=Washington&office=Seattle",
      );
      assert.equal(directory.status, 200);
      assert.equal(directory.data.total, 1);
      assert.equal(directory.data.companies[0].id, A.activeCompanyId);
      assert.ok(directory.data.services.includes("Commercial rooftops"));
      assert.ok(directory.data.areas.includes("Washington"));
      const noMatch = await anon("/companies?q=" + suffix + "&office=Miami");
      assert.equal(noMatch.data.total, 0);
      assert.deepEqual(noMatch.data.companies, []);
      assert.equal((await anon("/companies?page=0")).status, 400);
    },
  );
  await t.test(
    "password policy and duplicate accounts are enforced",
    async () => {
      assert.equal(
        (
          await anon("/auth/register", {
            name: "Invalid",
            email: "bad" + suffix + "@example.test",
            password: "short",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await anon("/auth/register", {
            name: "Alice",
            email: A.user.email,
            password,
          })
        ).status,
        409,
      );
    },
  );
  await t.test("cross-origin writes are rejected", async () => {
    assert.equal(
      (
        await a(
          "/requests",
          { companyId: B.activeCompanyId },
          { headers: { Origin: "https://untrusted.example" } },
        )
      ).status,
      403,
    );
  });
  await t.test(
    "company switching cannot impersonate another company",
    async () => {
      assert.equal(
        (await a("/session/company", { companyId: B.activeCompanyId })).status,
        403,
      );
    },
  );
  await t.test("self requests are rejected", async () => {
    assert.equal(
      (await a("/requests", { companyId: A.activeCompanyId })).status,
      400,
    );
  });
  await t.test(
    "reciprocal and duplicate request races create one request",
    async () => {
      const results = await Promise.all([
        a("/requests", {
          companyId: B.activeCompanyId,
          note: "Commercial installation partnership",
        }),
        b("/requests", { companyId: A.activeCompanyId, note: "Partnership" }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const winning = results.find((r) => r.status === 201).data;
      requestId = winning.id;
      if (winning.from_id !== A.activeCompanyId) {
        assert.equal(
          (
            await b("/requests/" + requestId + "/respond", {
              action: "withdraw",
            })
          ).status,
          200,
        );
        const newR = await a("/requests", {
          companyId: B.activeCompanyId,
          note: "Commercial installation partnership",
        });
        assert.equal(newR.status, 201);
        requestId = newR.data.id;
      }
    },
  );
  await t.test("only recipient can accept a request", async () => {
    assert.equal(
      (await c("/requests/" + requestId + "/respond", { action: "accept" }))
        .status,
      404,
    );
    assert.equal(
      (await a("/requests/" + requestId + "/respond", { action: "accept" }))
        .status,
      404,
    );
    const r = await b("/requests/" + requestId + "/respond", {
      action: "accept",
    });
    assert.equal(r.status, 200);
    connectionId = r.data.connectionId;
    assert.ok(connectionId);
    assert.equal(
      (await b("/requests/" + requestId + "/respond", { action: "accept" }))
        .status,
      409,
    );
  });
  await t.test("message attribution cannot be forged", async () => {
    const form = new FormData();
    form.set("body", "Hello from Aster");
    form.set("sender_company_id", B.activeCompanyId);
    assert.equal(
      (await a("/conversations/" + connectionId + "/messages", form)).status,
      201,
    );
    const r = await b("/conversations/" + connectionId + "/messages");
    assert.equal(r.data.messages[0].sender_company_id, A.activeCompanyId);
    assert.equal(r.data.messages[0].author_name, "Alice");
  });
  await t.test(
    "read receipts clear unread exactly and sequence pagination retains boundaries",
    async () => {
      const form = new FormData();
      form.set("body", "Read receipt boundary");
      assert.equal(
        (await a("/conversations/" + connectionId + "/messages", form)).status,
        201,
      );
      assert.equal(
        (await b("/network")).data.connections.find(
          (c) => c.id === connectionId,
        ).unread,
        1,
      );
      const r = await b("/conversations/" + connectionId + "/messages");
      assert.equal(
        (await b("/network")).data.connections.find(
          (c) => c.id === connectionId,
        ).unread,
        0,
      );
      const last = r.data.messages.at(-1);
      const earlier = await b(
        "/conversations/" + connectionId + "/messages?before=" + last.sequence,
      );
      assert.ok(
        earlier.data.messages.every(
          (m) => BigInt(m.sequence) < BigInt(last.sequence),
        ),
      );
      assert.equal(earlier.data.messages.at(-1).body, "Hello from Aster");
      assert.equal(earlier.data.hasMore, false);
    },
  );
  await t.test("unrelated companies cannot read or send messages", async () => {
    assert.equal(
      (await c("/conversations/" + connectionId + "/messages")).status,
      404,
    );
    const f = new FormData();
    f.set("body", "Intrusion");
    assert.equal(
      (await c("/conversations/" + connectionId + "/messages", f)).status,
      404,
    );
  });
  await t.test(
    "validated attachments are private to the company conversation",
    async () => {
      const f = new FormData();
      f.set("body", "Project brief");
      f.append(
        "files",
        new Blob(["%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"], {
          type: "application/pdf",
        }),
        "brief.pdf",
      );
      assert.equal(
        (await a("/conversations/" + connectionId + "/messages", f)).status,
        201,
      );
      const r = await b("/conversations/" + connectionId + "/messages");
      attachmentId = r.data.messages.at(-1).attachments[0].id;
      assert.equal((await b("/attachments/" + attachmentId)).status, 200);
      assert.equal((await c("/attachments/" + attachmentId)).status, 404);
      assert.equal((await anon("/attachments/" + attachmentId)).status, 401);
    },
  );
  await t.test(
    "disguised attachments are rejected without creating a message",
    async () => {
      const before = (await a("/conversations/" + connectionId + "/messages"))
        .data.messages.length;
      const f = new FormData();
      f.append(
        "files",
        new Blob(["<script>alert(1)</script>"], { type: "application/pdf" }),
        "evil.pdf",
      );
      assert.equal(
        (await a("/conversations/" + connectionId + "/messages", f)).status,
        400,
      );
      assert.equal(
        (await a("/conversations/" + connectionId + "/messages")).data.messages
          .length,
        before,
      );
    },
  );
  let inviteToken;
  await t.test("invites are email-bound and single-use", async () => {
    const invite = await a("/team/invites", {
      email: M.user.email,
      role: "member",
    });
    assert.equal(invite.status, 201);
    inviteToken = invite.data.url.split("/").at(-1);
    assert.equal(
      (await c("/team/invites/" + inviteToken + "/accept", {})).status,
      403,
    );
    assert.equal(
      (await member("/team/invites/" + inviteToken + "/accept", {})).status,
      200,
    );
    assert.equal(
      (await member("/team/invites/" + inviteToken + "/accept", {})).status,
      404,
    );
  });
  await t.test(
    "members can message but cannot manage connections or profiles",
    async () => {
      assert.equal(
        (await member("/requests", { companyId: C.activeCompanyId })).status,
        403,
      );
      assert.equal(
        (
          await member("/relationships/" + B.activeCompanyId, {
            action: "block",
          })
        ).status,
        403,
      );
      assert.equal(
        (await member("/companies/current", {}, { method: "PATCH" })).status,
        403,
      );
      const f = new FormData();
      f.set("body", "Morgan from the Aster team");
      assert.equal(
        (await member("/conversations/" + connectionId + "/messages", f))
          .status,
        201,
      );
    },
  );
  await t.test(
    "removing a member revokes access without deleting history",
    async () => {
      assert.equal(
        (await a("/team/" + M.user.id, undefined, { method: "DELETE" })).status,
        200,
      );
      assert.equal(
        (await member("/conversations/" + connectionId + "/messages")).status,
        403,
      );
      assert.ok(
        (
          await a("/conversations/" + connectionId + "/messages")
        ).data.messages.some((m) => m.author_name === "Morgan"),
      );
    },
  );
  await t.test(
    "disconnect stops new messages and preserves history",
    async () => {
      assert.equal(
        (
          await a("/relationships/" + B.activeCompanyId, {
            action: "disconnect",
          })
        ).status,
        200,
      );
      const f = new FormData();
      f.set("body", "Should fail");
      assert.equal(
        (await a("/conversations/" + connectionId + "/messages", f)).status,
        403,
      );
      assert.equal(
        (await b("/conversations/" + connectionId + "/messages")).status,
        200,
      );
    },
  );
  await t.test("reconnection restores the same conversation", async () => {
    const r = await b("/requests", {
      companyId: A.activeCompanyId,
      note: "Reconnect",
    });
    assert.equal(r.status, 201);
    const accepted = await a("/requests/" + r.data.id + "/respond", {
      action: "accept",
    });
    assert.equal(accepted.data.connectionId, connectionId);
  });
  await t.test(
    "blocking prevents requests and messages in both directions",
    async () => {
      assert.equal(
        (await a("/relationships/" + B.activeCompanyId, { action: "block" }))
          .status,
        200,
      );
      assert.equal(
        (await b("/requests", { companyId: A.activeCompanyId })).status,
        403,
      );
      for (const actor of [a, b]) {
        const f = new FormData();
        f.set("body", "Blocked message");
        assert.equal(
          (await actor("/conversations/" + connectionId + "/messages", f))
            .status,
          403,
        );
      }
      assert.equal(
        (await a("/relationships/" + B.activeCompanyId, { action: "unblock" }))
          .status,
        200,
      );
      const p = await a("/companies/" + B.activeCompanyId);
      assert.equal(p.data.relationship.status, "disconnected");
    },
  );
  await t.test("withdrawal removes pending requests", async () => {
    const r = await a("/requests", { companyId: C.activeCompanyId });
    assert.equal(r.status, 201);
    assert.equal(
      (await a("/requests/" + r.data.id + "/respond", { action: "withdraw" }))
        .status,
      200,
    );
    assert.equal((await c("/network")).data.incoming.length, 0);
  });
  await t.test("logout invalidates the session", async () => {
    assert.equal((await a("/auth/logout", {})).status, 200);
    assert.equal((await a("/network")).status, 401);
  });
});
