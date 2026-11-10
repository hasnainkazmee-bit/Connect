import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const base = process.env.JOBS_TEST_URL || "http://127.0.0.1:4201";
if (
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base) ||
  !new URL(process.env.DATABASE_URL).pathname.includes("test")
)
  throw new Error("Use an isolated local test database and server.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const users = [],
  companies = [];
async function account(name, sharedCompany) {
  const slug = `inbox-test-${randomUUID().slice(0, 8)}`;
  const user = (
    await db.query(
      "INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,'test',now(),now()) RETURNING id",
      [`${slug}@example.test`, name],
    )
  ).rows[0].id;
  users.push(user);
  const company =
    sharedCompany ||
    (
      await db.query(
        "INSERT INTO companies(slug,name,username) VALUES($1,$2,$1) RETURNING id",
        [slug, name],
      )
    ).rows[0].id;
  if (!sharedCompany) companies.push(company);
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
    [user, company],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), user, company],
  );
  return { user, company, cookie: `connect_session=${token}` };
}
async function call(path, actor, method = "GET", body, expected = 200) {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: actor.cookie,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(
    r.status,
    expected,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  return data;
}
try {
  const h = await account("Inbox hiring company"),
    employee = await account("Second employee", h.company),
    p = await account("Inbox provider"),
    competitor = await account("Other provider");
  const job = await call(
    "/jobs",
    h,
    "POST",
    {
      title: "Review the commercial installation schedule",
      description:
        "Coordinate installation, electrical work, and final inspection.",
      trade: "installation",
      location: "Austin, TX",
      exactAddress: "PRIVATE SITE ADDRESS",
    },
    201,
  );
  const path = `/jobs/${job.id}/messages`;
  const send = (
    actor,
    body,
    clientId = randomUUID(),
    providerId = p.company,
    expected = 201,
  ) => call(path, actor, "POST", { body, clientId, providerId }, expected);
  const read = (actor, messageId, providerId = p.company, expected = 200) =>
    call(path + "/read", actor, "POST", { messageId, providerId }, expected);
  const thread = async (actor, provider = p.company) =>
    (await call("/jobs/inbox", actor)).threads.find(
      (t) => t.job_id === job.id && t.provider_id === provider,
    );
  const first = await send(p, "Is the site ready for our crew?");
  assert.equal(first.message.author_name, "Inbox provider");
  assert.equal((await thread(h)).unread_count, 1);
  assert.equal((await thread(p)).unread_count, 0);
  assert.equal((await thread(employee)).unread_count, 1);
  await call(path + `?providerId=${p.company}`, h);
  assert.equal(
    (await thread(h)).unread_count,
    1,
    "Fetching messages is not reading them",
  );
  const notification = (
    await db.query(
      "SELECT category,url,read_at FROM user_notifications WHERE user_id=$1 AND event_key=$2",
      [h.user, `job-message:${first.id}`],
    )
  ).rows[0];
  assert.equal(notification.category, "messages");
  assert.equal(
    notification.url,
    `/jobs/inbox?job=${job.id}&provider=${p.company}`,
  );
  assert.equal(notification.read_at, null);

  const second = await send(p, "We can start next Tuesday.");
  await read(h, first.id);
  assert.equal(
    (await thread(h)).unread_count,
    1,
    "Only messages through the read cursor are cleared",
  );
  await read(h, second.id);
  await read(h, first.id);
  assert.equal(
    (await thread(h)).unread_count,
    0,
    "A stale read cannot move the bookmark backwards",
  );
  assert.equal(
    (await thread(employee)).unread_count,
    2,
    "Reading does not clear a teammate's unread messages",
  );
  const cleared = (
    await db.query(
      "SELECT user_id,read_at FROM user_notifications WHERE event_key=$1",
      [`job-message:${first.id}`],
    )
  ).rows;
  assert.ok(cleared.find((n) => n.user_id === h.user).read_at);
  assert.equal(cleared.find((n) => n.user_id === employee.user).read_at, null);

  const otherMessage = await send(
    competitor,
    "A private competing conversation.",
    randomUUID(),
    competitor.company,
  );
  await read(h, otherMessage.id, p.company, 404);
  await call(
    path + `?providerId=${p.company}`,
    competitor,
    "GET",
    undefined,
    403,
  );
  await call(
    path + `?providerId=${p.company}&before=${otherMessage.id}`,
    h,
    "GET",
    undefined,
    404,
  );
  await read(competitor, first.id, p.company, 403);
  await send(competitor, "Forged sender", randomUUID(), p.company, 403);
  assert.equal((await thread(h, competitor.company)).unread_count, 1);
  assert.ok(
    (await call("/jobs/inbox?unread=true", h)).threads.every(
      (t) => t.unread_count > 0,
    ),
  );
  assert.equal(
    (await call("/jobs/inbox", competitor)).threads.filter(
      (t) => t.job_id === job.id,
    ).length,
    1,
  );
  assert.ok(
    !JSON.stringify(await call("/jobs/inbox", p)).includes(
      "PRIVATE SITE ADDRESS",
    ),
  );

  const client = randomUUID();
  const result = await send(h, "Site access is confirmed.", client);
  const retry = await send(
    h,
    "Site access is confirmed.",
    client,
    p.company,
    200,
  );
  assert.equal(retry.id, result.id);
  assert.equal(retry.duplicate, true);
  await send(
    h,
    "A changed body cannot reuse the same send ID.",
    client,
    p.company,
    409,
  );
  const concurrentClient = randomUUID();
  const concurrent = await Promise.all(
    [0, 1].map(async () => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          body: "One send despite concurrent retries.",
          clientId: concurrentClient,
          providerId: p.company,
        }),
      });
      assert.ok([200, 201].includes(r.status));
      return r.json();
    }),
  );
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM job_messages WHERE client_id=$1",
        [concurrentClient],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM user_notifications WHERE user_id=$1 AND event_key=$2",
        [p.user, `job-message:${concurrent[0].id}`],
      )
    ).rows[0].n,
    1,
  );

  // Use fixture inserts for volume; sending and notifications are tested through the API above.
  const history = (
    await db.query(
      "INSERT INTO job_messages(job_id,provider_company_id,sender_company_id,author_id,body,created_at) SELECT $1,$2,$2,$3,'History '||n,now()-interval '2 days'+n*interval '1 second' FROM generate_series(1,56) n RETURNING id,body",
      [job.id, p.company, p.user],
    )
  ).rows;
  const latest = await call(path + `?providerId=${p.company}`, h);
  assert.equal(latest.messages.length, 50);
  assert.equal(latest.hasOlder, true);
  const older = await call(
    path + `?providerId=${p.company}&before=${latest.messages[0].id}`,
    h,
  );
  assert.equal(older.hasOlder, false);
  assert.equal(
    new Set([...older.messages, ...latest.messages].map((m) => m.id)).size,
    60,
  );
  assert.equal(older.messages[0].id, history[0].id);
  const after = await call(
    path + `?providerId=${p.company}&after=${history[0].id}`,
    h,
  );
  assert.equal(after.messages.length, 50);
  assert.equal(after.hasNewer, true);
  const rest = await call(
    path + `?providerId=${p.company}&after=${after.messages.at(-1).id}`,
    h,
  );
  assert.equal(rest.hasNewer, false);
  assert.equal(after.messages.length + rest.messages.length, 59);
  await call(
    path + `?providerId=${p.company}&after=${first.id}&before=${second.id}`,
    h,
    "GET",
    undefined,
    400,
  );

  await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [job.id]);
  assert.equal((await call(`/jobs/${job.id}`, p)).permissions.chosen, false);
  assert.equal(
    (await call(path, p)).messages.length,
    50,
    "Message-only participants retain their own history after closure",
  );
  await send(
    p,
    "Cannot start more work on a closed job.",
    randomUUID(),
    p.company,
    403,
  );
  console.log(
    "Inbox service passed: isolated conversations, per-person unread state, scoped notification reads, concurrent idempotency, cursor pagination, closed-job history and sending permissions.",
  );
} finally {
  await db.query("DELETE FROM jobs WHERE hiring_company_id=ANY($1::uuid[])", [
    companies,
  ]);
  await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [companies]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await db.end();
}
