import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createECDH } from "node:crypto";
import pg from "pg";
import {
  flushPush,
  pruneNotifications,
  validatePushEndpoint,
  recordNotificationRelease,
  pushConfiguration,
} from "../apps/api/dist/notifications.js";
import { pool as workerPool } from "../apps/api/dist/db.js";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = (process.env.API_TEST_URL || "http://localhost:4101") + "/api";
function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json() };
  };
}
const account = async (c, name, individual = false) =>
  (
    await c("/auth/register", {
      name,
      email: `push-${randomUUID()}@example.test`,
      password: "NotificationTest123!",
      ...(individual
        ? { accountType: "individual" }
        : { companyName: name + " " + randomUUID().slice(0, 8) }),
    })
  ).data;
const registration = () => ({
  platform: "android",
  token: randomBytes(64).toString("base64url"),
  installationId: randomUUID(),
  bindingId: randomUUID(),
  appVersionCode: 10,
  appVersionName: "0.5.3",
});
async function post(company, user, body = "Notification post") {
  return (
    await db.query(
      "INSERT INTO posts(company_id,author_id,body) VALUES($1,$2,$3) RETURNING *",
      [company, user, body],
    )
  ).rows[0];
}
async function comment(
  p,
  company,
  user,
  body = "A helpful comment",
  parent = null,
  reply = null,
) {
  return (
    await db.query(
      "INSERT INTO post_comments(post_id,company_id,author_id,body,parent_id,reply_to_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [p, company, user, body, parent, reply],
    )
  ).rows[0];
}
async function inbox(c) {
  const r = await c("/notifications");
  assert.equal(r.status, 200);
  return r.data;
}
async function due() {
  await db.query(
    "UPDATE push_deliveries SET next_attempt_at=now(),lease_until=NULL,lease_token=NULL WHERE delivered_at IS NULL",
  );
}

test("durable account-bound notification inbox and delivery", async (t) => {
  const a = client(),
    b = client(),
    c = client(),
    person = client(),
    anon = client();
  const A = await account(a, "Push Alpha"),
    B = await account(b, "Push Beta"),
    C = await account(c, "Push Gamma"),
    I = await account(person, "Customer", true);
  const ca = A.activeCompanyId,
    cb = B.activeCompanyId,
    cc = C.activeCompanyId;
  let da, dbb, postA, rootComment, request, connection;
  const ra = registration(),
    rb = registration();
  await t.test(
    "public configuration exposes no secrets; registrations and preferences require auth",
    async () => {
      const config = (await anon("/notifications/config")).data;
      assert.deepEqual(Object.keys(config).sort(), ["fcm", "webPush"]);
      assert.equal(config.fcm.enabled, false);
      assert.equal((await anon("/notifications")).status, 401);
      assert.equal((await anon("/notifications/devices", ra)).status, 401);
      da = (await a("/notifications/devices", ra)).data.id;
      dbb = (await b("/notifications/devices", rb)).data.id;
      assert.ok(da && dbb);
      assert.equal((await a("/notifications/devices", ra)).data.id, da);
      assert.equal((await a("/notifications/devices/" + da)).data.active, true);
      assert.equal(
        (await b("/notifications/devices/" + da)).data.active,
        false,
      );
      assert.equal(
        (await a("/notifications/preferences")).data.previews,
        false,
      );
    },
  );
  await t.test(
    "web subscription validation rejects SSRF and malformed encryption keys",
    async () => {
      for (const url of [
        "https://127.0.0.1/",
        "http://fcm.googleapis.com/test",
        "https://fcm.googleapis.com.evil.test/a",
        "https://user@fcm.googleapis.com/a",
        "https://fcm.googleapis.com:444/a",
        "https://localhost/a",
      ])
        assert.throws(() => validatePushEndpoint(url));
      assert.equal(
        validatePushEndpoint("https://fcm.googleapis.com/fcm/send/example"),
        "https://fcm.googleapis.com/fcm/send/example",
      );
      const web = {
        ...registration(),
        platform: "web",
        subscription: {
          endpoint: "https://127.0.0.1/private",
          keys: {
            p256dh: randomBytes(65).toString("base64url"),
            auth: randomBytes(16).toString("base64url"),
          },
        },
      };
      delete web.token;
      assert.equal((await a("/notifications/devices", web)).status, 400);
      web.subscription.endpoint =
        "https://fcm.googleapis.com/fcm/send/" + randomUUID();
      assert.equal((await a("/notifications/devices", web)).status, 400);
      const curve = createECDH("prime256v1");
      curve.generateKeys();
      web.subscription.keys.p256dh = curve.getPublicKey().toString("base64url");
      const valid = await a("/notifications/devices", web);
      assert.equal(valid.status, 201);
      await a("/notifications/devices/" + valid.data.id, undefined, "DELETE");
    },
  );
  await t.test(
    "invalid provider configuration reports unavailable and valid VAPID keys recover",
    async () => {
      const keys = [
        "WEB_PUSH_PUBLIC_KEY",
        "WEB_PUSH_PRIVATE_KEY",
        "WEB_PUSH_SUBJECT",
        "FIREBASE_SERVICE_ACCOUNT_FILE",
      ];
      const saved = keys.map((key) => process.env[key]);
      try {
        process.env.WEB_PUSH_PUBLIC_KEY = "invalid";
        process.env.WEB_PUSH_PRIVATE_KEY = "invalid";
        process.env.WEB_PUSH_SUBJECT = "mailto:notifications@example.test";
        process.env.FIREBASE_SERVICE_ACCOUNT_FILE =
          "/private/tmp/missing-connect-firebase-" + randomUUID() + ".json";
        assert.deepEqual(await pushConfiguration(), {
          webPush: { enabled: false, publicKey: null },
          fcm: { enabled: false },
        });
        const curve = createECDH("prime256v1");
        curve.generateKeys();
        process.env.WEB_PUSH_PUBLIC_KEY = curve
          .getPublicKey()
          .toString("base64url");
        process.env.WEB_PUSH_PRIVATE_KEY = curve
          .getPrivateKey()
          .toString("base64url");
        assert.equal((await pushConfiguration()).webPush.enabled, true);
        assert.equal((await pushConfiguration()).fcm.enabled, false);
      } finally {
        keys.forEach((key, index) =>
          saved[index] === undefined
            ? delete process.env[key]
            : (process.env[key] = saved[index]),
        );
      }
    },
  );
  await t.test(
    "transaction rollback produces neither inbox nor push; self actions are excluded",
    async () => {
      postA = await post(ca, A.user.id);
      const transaction = await db.connect();
      try {
        await transaction.query("BEGIN");
        await transaction.query(
          "INSERT INTO post_comments(post_id,company_id,author_id,body) VALUES($1,$2,$3,$4)",
          [postA.id, cb, B.user.id, "Never committed"],
        );
        await transaction.query("ROLLBACK");
      } finally {
        transaction.release();
      }
      assert.equal((await inbox(a)).notifications.length, 0);
      await comment(postA.id, ca, A.user.id, "Our own comment");
      assert.equal((await inbox(a)).notifications.length, 0);
      rootComment = await comment(postA.id, cb, B.user.id);
      assert.equal((await inbox(a)).notifications[0].type, "comment");
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM push_deliveries WHERE device_id=$1",
            [da],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "reply-to-reply notifies target and post owner once each; reactions dedupe across toggles",
    async () => {
      const reply = await comment(
        postA.id,
        cc,
        C.user.id,
        "Reply to Beta",
        rootComment.id,
        rootComment.id,
      );
      assert.equal((await inbox(b)).notifications[0].type, "reply");
      await comment(
        postA.id,
        cb,
        B.user.id,
        "Reply to Gamma",
        rootComment.id,
        reply.id,
      );
      assert.equal((await inbox(c)).notifications[0].type, "reply");
      for (const emoji of ["🎉", "👍", "🎉"]) {
        await db.query(
          "INSERT INTO post_reactions(post_id,company_id,author_id,emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [postA.id, cb, B.user.id, emoji],
        );
        await db.query(
          "DELETE FROM post_reactions WHERE post_id=$1 AND company_id=$2 AND emoji=$3",
          [postA.id, cb, emoji],
        );
      }
      assert.equal(
        (await inbox(a)).notifications.filter((n) => n.type === "reaction")
          .length,
        1,
      );
    },
  );
  await t.test(
    "connection/message events are transactional and retries do not duplicate",
    async () => {
      request = (
        await b("/requests", {
          companyId: ca,
          note: "Hello Alpha",
          kind: "message",
        })
      ).data;
      assert.equal((await inbox(a)).notifications[0].type, "message_request");
      const accepted = await a("/requests/" + request.id + "/respond", {
        action: "accept",
      });
      assert.equal(accepted.status, 200);
      connection = accepted.data.connectionId;
      assert.equal((await inbox(b)).notifications[0].type, "accepted");
      const message = (
        await db.query(
          "INSERT INTO messages(connection_id,sender_company_id,author_id,body,client_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            connection,
            cb,
            B.user.id,
            "A private project message",
            randomUUID(),
          ],
        )
      ).rows[0];
      assert.equal(
        (await inbox(a)).notifications[0].text,
        "A private project message",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM user_notifications WHERE event_key=$1",
            ["message:" + message.id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "individual conversations receive their own inbox, never another user’s",
    async () => {
      const thread = await person("/personal-inbox", {
        companyId: ca,
        body: "Please quote my roof",
        clientId: randomUUID(),
      });
      assert.equal(thread.status, 201);
      assert.equal(
        (
          await a("/personal-inbox/" + thread.data.id + "/respond", {
            accept: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (await person("/notifications")).data.notifications[0].type,
        "accepted",
      );
      assert.equal(
        (
          await a("/personal-inbox/" + thread.data.id + "/messages", {
            body: "We can help with your installation",
            clientId: randomUUID(),
          })
        ).status,
        201,
      );
      const i = await inbox(person);
      assert.equal(
        i.notifications[0].text,
        "We can help with your installation",
      );
      assert.equal(i.notifications[0].company_id, null);
      assert.ok(
        !(await inbox(b)).notifications.some((n) =>
          n.url.includes(thread.data.id),
        ),
      );
    },
  );
  await t.test(
    "per-user reads and ownership deletion cannot affect another user",
    async () => {
      const before = (await inbox(a)).unread;
      const id = (await inbox(a)).notifications[0].id;
      assert.deepEqual((await b("/notifications/read", { ids: [id] })).data.ids, []);
      assert.equal((await inbox(a)).unread, before);
      assert.deepEqual((await a("/notifications/read", { ids: [id] })).data.ids, [id]);
      assert.equal((await inbox(a)).unread, before - 1);
      await b("/notifications/devices/" + da, undefined, "DELETE");
      assert.equal((await a("/notifications/devices/" + da)).data.active, true);
    },
  );
  await t.test(
    "push respects current privacy, preferences, membership and blocks",
    async () => {
      await a("/notifications/preferences", { social: false }, "PATCH");
      await due();
      const sent = [];
      for (let i = 0; i < 5; i++)
        await flushPush(async (d, p) => sent.push({ d, p }));
      assert.ok(sent.some((s) => s.p.recipientUserId === A.user.id));
      for (const s of sent) {
        assert.equal(s.p.title, "Connect");
        assert.ok(!s.p.body.includes("private"));
        assert.equal(s.p.bindingId, s.d.binding_id);
        assert.ok(s.p.url.startsWith("/"));
      }
      assert.ok(
        !sent.some(
          (s) =>
            s.p.recipientUserId === A.user.id &&
            ["comment", "reply", "reaction"].includes(s.p.type),
        ),
      );
      await a(
        "/notifications/preferences",
        { social: true, previews: true },
        "PATCH",
      );
      await comment(postA.id, cb, B.user.id, "Before blocking");
      await db.query(
        "INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2)",
        [ca, cb],
      );
      assert.ok(
        !(await inbox(a)).notifications.some((n) => n.actor_company_id === cb),
      );
      const hidden = [];
      await due();
      await flushPush(async (d, p) => hidden.push(p));
      assert.ok(!hidden.some((p) => p.recipientUserId === A.user.id));
      await db.query(
        "DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
        [ca, cb],
      );
      const staff = client(),
        S = await account(staff, "Push Staff");
      await db.query(
        "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'member')",
        [S.user.id, ca],
      );
      const ds = (await staff("/notifications/devices", registration())).data
        .id;
      await comment(postA.id, cb, B.user.id, "Before employee leaves");
      await db.query(
        "DELETE FROM memberships WHERE user_id=$1 AND company_id=$2",
        [S.user.id, ca],
      );
      assert.equal((await inbox(staff)).notifications.length, 0);
      const delivered = [];
      await due();
      await flushPush(async (d, p) => delivered.push(p));
      assert.ok(!delivered.some((p) => p.recipientUserId === S.user.id));
      await staff("/notifications/devices/" + ds, undefined, "DELETE");
    },
  );
  await t.test(
    "delivery leases prevent concurrent sends; transient errors retry and invalid tokens are pruned",
    async () => {
      await comment(postA.id, cb, B.user.id, "Retry example");
      await due();
      let attempts = 0;
      await flushPush(async () => {
        attempts++;
        throw Object.assign(new Error("temporary"), { statusCode: 503 });
      });
      assert.ok(attempts > 0);
      const retry = (
        await db.query(
          "SELECT attempts,next_attempt_at,delivered_at FROM push_deliveries WHERE device_id=$1 AND delivered_at IS NULL",
          [da],
        )
      ).rows[0];
      assert.equal(retry.attempts, 1);
      assert.ok(new Date(retry.next_attempt_at) > new Date());
      await due();
      const keys = [];
      await Promise.all([
        flushPush(async (d, p) => {
          keys.push(d.id + ":" + p.id);
          await new Promise((r) => setTimeout(r, 20));
        }),
        flushPush(async (d, p) => keys.push(d.id + ":" + p.id)),
      ]);
      assert.equal(keys.length, new Set(keys).size);
      await comment(postA.id, cb, B.user.id, "Invalid token example");
      await due();
      await flushPush(async () => {
        throw Object.assign(new Error("gone"), {
          code: "messaging/registration-token-not-registered",
        });
      });
      assert.equal(
        (await a("/notifications/devices/" + da)).data.active,
        false,
      );
      da = (await a("/notifications/devices", ra)).data.id;
    },
  );
  await t.test(
    "delivery drains a backlog in bounded parallel batches",
    async () => {
      for (let index = 0; index < 30; index++)
        await comment(postA.id, cb, B.user.id, "Backlog " + index);
      let active = 0,
        maximum = 0;
      const received = [];
      const sender = async (d, p) => {
        active++;
        maximum = Math.max(maximum, active);
        received.push(p.id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
      };
      await due();
      await flushPush(sender);
      assert.equal(received.length, 25);
      assert.equal(maximum, 5);
      await flushPush(sender);
      assert.equal(received.length, 30);
      assert.equal(new Set(received).size, 30);
    },
  );
  await t.test(
    "same installation switches account atomically and removes queued old-account deliveries",
    async () => {
      await comment(postA.id, cb, B.user.id, "Old binding");
      const moved = { ...ra, bindingId: randomUUID() };
      const movedId = (await b("/notifications/devices", moved)).data.id;
      assert.equal(
        (await a("/notifications/devices/" + da)).data.active,
        false,
      );
      assert.equal(
        (await b("/notifications/devices/" + movedId)).data.active,
        true,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM push_deliveries WHERE device_id=$1",
            [da],
          )
        ).rows[0].count,
        "0",
      );
      await b("/auth/logout", {});
      assert.equal(
        (
          await db.query("SELECT count(*) FROM push_devices WHERE id=$1", [
            movedId,
          ])
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "team invitations require matching verified account and disappear when revoked",
    async () => {
      await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
        C.user.id,
      ]);
      const invitation = (
        await db.query(
          "INSERT INTO team_invites(token_hash,company_id,email,role,expires_at) VALUES($1,$2,$3,'member',now()+interval '7 days') RETURNING id",
          [randomBytes(32).toString("hex"), ca, C.user.email],
        )
      ).rows[0];
      assert.ok(
        (await inbox(c)).notifications.some((n) => n.type === "team_invite"),
      );
      await db.query("UPDATE team_invites SET revoked_at=now() WHERE id=$1", [
        invitation.id,
      ]);
      assert.ok(
        !(await inbox(c)).notifications.some((n) => n.type === "team_invite"),
      );
    },
  );
  await t.test(
    "release events dedupe by actual version; first baseline is silent",
    async () => {
      const platform = "web";
      await db.query("DELETE FROM notification_releases WHERE platform=$1", [
        platform,
      ]);
      await recordNotificationRelease(
        platform,
        "test-1",
        "Connect update",
        "First baseline",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM user_notifications WHERE event_key='release:web:test-1'",
          )
        ).rows[0].count,
        "0",
      );
      const row = (
        await db.query(
          "SELECT token_hash FROM sessions WHERE user_id=$1 LIMIT 1",
          [A.user.id],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO push_devices(user_id,session_hash,installation_id,binding_id,platform,address_hash,address,p256dh,auth) VALUES($1,$2,$3,$4,'web',$5,$6,'key','auth')",
        [
          A.user.id,
          row.token_hash,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          "https://fcm.googleapis.com/test",
        ],
      );
      await recordNotificationRelease(
        platform,
        "test-2",
        "Connect update",
        "New release",
      );
      await recordNotificationRelease(
        platform,
        "test-2",
        "Connect update",
        "New release",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM user_notifications WHERE user_id=$1 AND event_key='release:web:test-2'",
            [A.user.id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "Android update delivery rechecks installed versions and never crosses to web",
    async () => {
      await db.query(
        "DELETE FROM notification_releases WHERE platform='android' AND version IN('1000001','1000002')",
      );
      const reg = { ...registration(), appVersionCode: 1000001 };
      const device = (await c("/notifications/devices", reg)).data.id;
      await recordNotificationRelease(
        "android",
        "1000001",
        "Connect update",
        "Already installed",
      );
      assert.ok(
        !(await inbox(c)).notifications.some((n) => n.type === "release"),
      );
      await recordNotificationRelease(
        "android",
        "1000002",
        "Connect update",
        "New Android version",
      );
      const notification = (await inbox(c)).notifications.find(
        (n) => n.type === "release",
      );
      assert.ok(notification);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM push_deliveries p JOIN push_devices d ON d.id=p.device_id JOIN user_notifications n ON n.id=p.notification_id WHERE n.event_key='release:android:1000002' AND d.platform='web'",
          )
        ).rows[0].count,
        "0",
      );
      await c("/notifications/devices", { ...reg, appVersionCode: 1000002 });
      const sent = [];
      await due();
      await flushPush(async (d, p) => sent.push(p));
      assert.ok(!sent.some((p) => p.id === notification.id));
      assert.equal(
        (await c("/notifications/devices/" + device)).data.active,
        true,
      );
    },
  );
  await t.test("expired inbox and devices are pruned", async () => {
    await db.query(
      "UPDATE push_devices SET updated_at=now()-interval '91 days' WHERE user_id=$1",
      [A.user.id],
    );
    await db.query(
      "UPDATE user_notifications SET expires_at=now()-interval '1 day' WHERE user_id=$1",
      [A.user.id],
    );
    await pruneNotifications();
    assert.equal((await inbox(a)).notifications.length, 0);
    assert.equal(
      (
        await db.query("SELECT count(*) FROM push_devices WHERE user_id=$1", [
          A.user.id,
        ])
      ).rows[0].count,
      "0",
    );
  });
  await db.query("DELETE FROM push_devices WHERE user_id=ANY($1::uuid[])", [
    [A.user.id, B.user.id, C.user.id, I.user.id],
  ]);
});
test("viewing a context auto-reads only the reader's authorized related notifications", async () => {
  const one = client(), two = client(), outsider = client(), customer = client();
  const One = await account(one, "Read context one"), Two = await account(two, "Read context two");
  await account(outsider, "Read context outsider");
  await account(customer, "Read context customer", true);
  const request = await two("/requests", { companyId: One.activeCompanyId, note: "Hello", kind: "message" });
  const accepted = await one(`/requests/${request.data.id}/respond`, { action: "accept" });
  const connectionId = accepted.data.connectionId;
  await db.query("INSERT INTO messages(connection_id,sender_company_id,author_id,body,client_id) VALUES($1,$2,$3,'Read this message',$4)",
    [connectionId, Two.activeCompanyId, Two.user.id, randomUUID()]);
  const postOne = await post(One.activeCompanyId, One.user.id);
  const postTwo = await post(One.activeCompanyId, One.user.id);
  await comment(postOne.id, Two.activeCompanyId, Two.user.id);
  await comment(postTwo.id, Two.activeCompanyId, Two.user.id);
  const before = await inbox(one);
  assert.equal((await outsider("/notifications/read-context", {kind:"company_conversation",id:connectionId})).status,404);
  assert.equal((await inbox(one)).unread,before.unread);
  const chatRead = await one("/notifications/read-context", {kind:"company_conversation",id:connectionId});
  assert.equal(chatRead.status,200);
  assert.equal(chatRead.data.read,1);
  assert.deepEqual(chatRead.data.ids, before.notifications.filter(n=>n.type === "message" && !n.read_at).map(n=>n.id));
  assert.equal((await one("/notifications/read-context", {kind:"company_conversation",id:connectionId})).data.read,0);
  const afterChat = await inbox(one);
  assert.ok(afterChat.notifications.find(n=>n.url.includes(postOne.id))?.read_at === null);
  assert.equal((await one("/notifications/read-context", {kind:"post",id:postOne.id})).data.read,1);
  assert.equal((await inbox(one)).notifications.find(n=>n.url.includes(postTwo.id))?.read_at,null);
  const thread = await customer("/personal-inbox", {companyId:One.activeCompanyId,body:"Customer question",clientId:randomUUID()});
  await one(`/personal-inbox/${thread.data.id}/respond`,{accept:true});
  await one(`/personal-inbox/${thread.data.id}/messages`,{body:"Customer answer",clientId:randomUUID()});
  assert.equal((await outsider("/notifications/read-context",{kind:"personal_conversation",id:thread.data.id})).status,404);
  const customerRead=await customer("/notifications/read-context",{kind:"personal_conversation",id:thread.data.id});
  assert.equal(customerRead.status,200);
  assert.equal(customerRead.data.read,2);
  assert.equal(customerRead.data.ids.length,2);
  assert.equal((await inbox(customer)).unread,0);
  assert.equal((await client()("/notifications/read-context",{kind:"post",id:postOne.id})).status,401);
});
test.after(async () => {
  await db.end();
  await workerPool.end();
});
