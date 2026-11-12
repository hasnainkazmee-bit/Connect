import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Use an isolated test database.");
const base = "http://127.0.0.1:4214";
const server = spawn("./target/debug/connect-jobs", [], {
  env: { ...process.env, JOBS_BIND: "127.0.0.1:4214" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const companies = [],
  users = [];
let assertions = 0;
const check = (value, message) => {
  assert.ok(value, message);
  assertions++;
};
async function account(name, sharedCompany, role = "owner") {
  const user = randomUUID(),
    company = sharedCompany || randomUUID();
  users.push(user);
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES($1,$2,$3,'test',now())",
    [user, `contact-${user}@example.test`, name],
  );
  if (!sharedCompany) {
    companies.push(company);
    await db.query(
      "INSERT INTO companies(id,slug,name) VALUES($1::uuid,$1::text,$2)",
      [company, name],
    );
  }
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)",
    [user, company, role],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), user, company],
  );
  return { company, user, cookie: `connect_session=${token}` };
}
async function call(path, actor, body, expected = 200) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  assertions++;
  return data;
}
try {
  for (let n = 0; n < 50; n++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  check(server.exitCode === null, "Test service started");
  const h = await account("Contact test hirer"),
    p = await account("Contact test provider"),
    other = await account("Contact test other"),
    unclaimed = await account("Unclaimed test profile"),
    employee = await account("Hirer member", h.company, "member");
  await db.query(
    "UPDATE companies SET listing_status='unclaimed' WHERE id=$1",
    [unclaimed.company],
  );
  const job = await call(
    "/jobs",
    h,
    {
      title: "Test commercial installation matching",
      description:
        "Discuss scope and availability for a commercial solar installation. Isolated test only.",
      trade: "installation",
      location: "Cleveland, OH",
      exactAddress: "PRIVATE CONTACT TEST ADDRESS",
      visibility: "invite_only",
      matchingPreferences: {
        kind: "service",
        categoryId: "solar-installation",
        countryCode: "US",
        stateCode: "OH",
      },
    },
    201,
  );
  const path = `/jobs/${job.id}/messages`,
    preview = (actor) => call(`${path}?providerId=${p.company}`, actor);
  await call(`/jobs/${job.id}`, p, undefined, 404);
  const context = await preview(h);
  check(
    context.messages.length === 0 &&
      context.conversation.needsStart &&
      context.conversation.canSend &&
      !context.conversation.invited &&
      context.conversation.company.id === p.company,
    "New composer resolves recipient without starting a conversation",
  );
  const counts = async () =>
    (
      await db.query(
        "SELECT (SELECT count(*)::int FROM job_messages WHERE job_id=$1) AS messages,(SELECT count(*)::int FROM job_invitations WHERE job_id=$1) AS invitations,(SELECT count(*)::int FROM user_notifications WHERE source_id=$1) AS notifications",
        [job.id],
      )
    ).rows[0];
  check(
    JSON.stringify(await counts()) ===
      JSON.stringify({ messages: 0, invitations: 0, notifications: 0 }),
    "Opening composer neither sends, invites, nor notifies",
  );
  check(
    !(await call("/jobs/inbox", h)).threads.some((t) => t.job_id === job.id),
    "Preview does not create an inbox row",
  );
  check(
    (await call(`/jobs/${job.id}/matches`, h)).conversationCompanyIds.length ===
      0,
    "Matching has no conversation until first send",
  );
  const memberContext = await preview(employee);
  check(
    !memberContext.conversation.canSend &&
      memberContext.conversation.reason.includes("owner or admin"),
    "Member sees why a new conversation requires an admin",
  );
  const first = {
    providerId: p.company,
    body: "Can your team handle this installation?",
    clientId: randomUUID(),
    startConversation: true,
  };
  await call(path, employee, first, 403);
  await call(path, h, { ...first, startConversation: false }, 409);
  await call(path, h, { ...first, startConversation: "yes" }, 400);
  await call(path, h, { ...first, providerId: unclaimed.company }, 409);
  await call(path, h, { ...first, providerId: h.company }, 400);
  await call(`${path}?providerId=${unclaimed.company}`, h, undefined, 409);
  await call(path, h, { ...first, body: "  " }, 400);
  check((await counts()).messages === 0, "Rejected sends have no side effects");
  await db.query(
    "UPDATE jobs SET quote_deadline=now()-interval '1 day' WHERE id=$1",
    [job.id],
  );
  const expired = await preview(h);
  check(
    !expired.conversation.canSend &&
      expired.conversation.reason.includes("deadline"),
    "Expired first-contact composer is read-only",
  );
  await call(path, h, first, 409);
  await db.query(
    "UPDATE jobs SET quote_deadline=NULL,status='draft' WHERE id=$1",
    [job.id],
  );
  check(
    !(await preview(h)).conversation.canSend,
    "Draft cannot start a conversation",
  );
  await call(path, h, first, 409);
  await db.query("UPDATE jobs SET status='open' WHERE id=$1", [job.id]);
  const sent = await call(path, h, first, 201);
  const duplicate = await call(path, h, first);
  check(
    sent.id === duplicate.id && duplicate.duplicate,
    "Retry of first send reuses the exact message",
  );
  await call(
    path,
    h,
    { ...first, body: "Different content using the same send key" },
    409,
  );
  const finalCounts = await counts();
  check(
    finalCounts.messages === 1 &&
      finalCounts.invitations === 0 &&
      finalCounts.notifications === 1,
    "First send creates one message and notification, never an invitation",
  );
  const active = await preview(h);
  check(
    !active.conversation.needsStart &&
      active.conversation.canSend &&
      !active.conversation.invited,
    "Started conversation is reused without start intent",
  );
  const matches = await call(`/jobs/${job.id}/matches`, h);
  check(
    matches.conversationCompanyIds.includes(p.company) &&
      matches.invitedCompanyIds.length === 0,
    "Matches separately report conversations and invitations",
  );
  const providerJob = await call(`/jobs/${job.id}`, p);
  check(
    providerJob.job.exact_address === "" &&
      !providerJob.permissions.invited &&
      providerJob.quotes.length === 0,
    "Message shares job context without private address, invitation, or competitor quotes",
  );
  await call(`/jobs/${job.id}`, other, undefined, 404);
  await call(path + `?providerId=${p.company}`, other, undefined, 404);
  await call(
    `/jobs/${job.id}/quote`,
    p,
    {
      amountCents: 10000,
      note: "Quote should require a separate invitation on a private job.",
    },
    403,
  );
  const providerContext = await call(path, p);
  check(
    providerContext.conversation.company.id === h.company &&
      !providerContext.conversation.needsStart,
    "Recipient sees hiring company context",
  );
  await call(
    path,
    p,
    {
      body: "We can discuss the scope and availability.",
      clientId: randomUUID(),
    },
    201,
  );
  await call(
    path,
    employee,
    {
      providerId: p.company,
      body: "Our project manager can send the plans.",
      clientId: randomUUID(),
    },
    201,
  );
  check(
    (await call("/jobs/inbox", h)).threads.filter(
      (t) => t.job_id === job.id && t.provider_id === p.company,
    ).length === 1,
    "Both sides and team members use one job-scoped thread",
  );
  await db.query(
    "UPDATE jobs SET quote_deadline=now()-interval '1 day' WHERE id=$1",
    [job.id],
  );
  check(
    (await preview(h)).conversation.canSend,
    "Existing conversation remains usable after quote deadline",
  );
  await call(
    path,
    h,
    {
      providerId: p.company,
      body: "The quote window has ended; thank you for the discussion.",
      clientId: randomUUID(),
    },
    201,
  );
  const otherContext = await call(path + `?providerId=${other.company}`, h);
  check(
    !otherContext.conversation.canSend && otherContext.conversation.needsStart,
    "Deadline still blocks contacting a new company",
  );
  await call(
    path,
    h,
    {
      providerId: other.company,
      body: "New outreach after deadline must be blocked.",
      clientId: randomUUID(),
      startConversation: true,
    },
    409,
  );
  await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [job.id]);
  check(
    !(await call(path, p)).conversation.canSend,
    "Closed-job provider history is readable but cannot send",
  );
  await call(
    path,
    p,
    {
      body: "Closed job cannot accept provider messages",
      clientId: randomUUID(),
    },
    403,
  );
  const closedOther = await call(path + `?providerId=${other.company}`, h);
  check(
    !closedOther.conversation.canSend &&
      closedOther.conversation.reason.includes("no longer"),
    "Closed new-contact context explains restriction",
  );
  await call(
    path,
    h,
    {
      providerId: other.company,
      body: "Cannot start on closed job",
      clientId: randomUUID(),
      startConversation: true,
    },
    409,
  );
  const quoteOnlyJob = await call(
    "/jobs",
    h,
    {
      title: "Quote-only commercial installation conversation",
      description:
        "Receive a company quote before starting a conversation. Isolated test only.",
      trade: "installation",
      location: "Cleveland, OH",
      matchingPreferences: {
        kind: "service",
        categoryId: "solar-installation",
        countryCode: "US",
        stateCode: "OH",
      },
    },
    201,
  );
  await call(`/jobs/${quoteOnlyJob.id}/quote`, other, {
    amountCents: 120000,
    note: "We can provide the requested installation and discuss the scope.",
  });
  await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [
    quoteOnlyJob.id,
  ]);
  const quoteOnlyMatches = await call(
    `/jobs/${quoteOnlyJob.id}/matches`,
    employee,
  );
  check(
    quoteOnlyMatches.conversationCompanyIds.includes(other.company) &&
      quoteOnlyMatches.invitedCompanyIds.length === 0,
    "A quote-only thread remains discoverable to a team member after the job closes",
  );
  const quoteOnlyContext = await call(
    `/jobs/${quoteOnlyJob.id}/messages?providerId=${other.company}`,
    employee,
  );
  check(
    quoteOnlyContext.messages.length === 0 &&
      !quoteOnlyContext.conversation.needsStart &&
      quoteOnlyContext.conversation.canSend,
    "A quote establishes conversation access without messages or an invitation",
  );
  console.log(JSON.stringify({ status: "passed", assertions }));
} catch (e) {
  console.error(log);
  throw e;
} finally {
  server.kill("SIGTERM");
  await db.query("DELETE FROM jobs WHERE hiring_company_id=ANY($1::uuid[])", [
    companies,
  ]);
  await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [companies]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await db.end();
}
