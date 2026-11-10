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

async function account(name, isDemo = false) {
  const slug = `jobs-test-${name.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const user = (
    await db.query(
      "INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,'test',now(),now()) RETURNING id",
      [`${slug}@example.test`, name],
    )
  ).rows[0].id;
  const company = (
    await db.query(
      "INSERT INTO companies(slug,name,username,is_demo) VALUES($1,$2,$1,$3) RETURNING id",
      [slug, `${name} Solar`, isDemo],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
    [user, company],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), user, company],
  );
  return { cookie: `connect_session=${token}`, company, slug };
}
async function call(path, account, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(account ? { cookie: account.cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
try {
  const hirer = await account("Hirer"),
    provider = await account("Provider", true),
    other = await account("Other"),
    demo = await account("Demo", true);
  assert.equal(
    (
      await call(`/jobs/providers?q=${provider.slug}&sample=true`)
    ).providers.some((p) => p.id === provider.company),
    true,
  );
  assert.equal(
    (await call(`/jobs/providers?q=${demo.slug}&sample=true`)).providers.some(
      (p) => p.id === demo.company,
    ),
    true,
  );
  assert.equal((await call(`/jobs/providers?q=${demo.slug}`)).total, 0);
  const draft = await call("/jobs", hirer, "POST", {
    title: "",
    description: "",
    location: "",
    trade: "installation",
    status: "draft",
  });
  assert.equal((await call(`/jobs/${draft.id}`, hirer)).job.status, "draft");
  await call(`/jobs/${draft.id}`, hirer, "PATCH", {
    title: "Install systems near Austin",
    description: "Install ten systems in the greater Austin area.",
    location: "Austin, TX",
    trade: "installation",
    status: "open",
  });
  assert.equal((await call(`/jobs/${draft.id}`, hirer)).job.status, "open");
  const crew = await call("/jobs", hirer, "POST", {
    title: "Need four installers for two weeks",
    description:
      "Our team needs four experienced installers to help with module and racking installation.",
    trade: "crew",
    location: "Dallas, TX",
    peopleNeeded: 4,
    expectedDuration: "2 weeks",
    workArrangement: "onsite",
  });
  const crewJob = (await call(`/jobs/${crew.id}`, provider)).job;
  assert.equal(crewJob.people_needed, 4);
  assert.equal(crewJob.expected_duration, "2 weeks");
  assert.equal(crewJob.system_size_kw, null);
  const crewSearch = await call("/jobs?trade=crew", provider);
  assert.ok(
    crewSearch.jobs.some((j) => j.id === crew.id && j.people_needed === 4),
  );
  for (const trade of [
    "permitting",
    "inspection",
    "equipment",
    "logistics",
    "other",
  ]) {
    const request = await call("/jobs", hirer, "POST", {
      title: `Need solar ${trade} support`,
      description:
        "Our solar business needs specialist help. Please send your availability and approach.",
      trade,
      location: "Remote",
      workArrangement: "remote",
      expectedDuration: "Ongoing",
    });
    const detail = (await call(`/jobs/${request.id}`, provider)).job;
    assert.equal(detail.work_arrangement, "remote");
  }
  for (const extra of [
    { peopleNeeded: 0 },
    { peopleNeeded: 1.5 },
    { peopleNeeded: 1001 },
    { workArrangement: "unknown" },
  ]) {
    const invalid = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { cookie: hirer.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Need a qualified crew",
        description: "This request must reject invalid staffing details.",
        trade: "crew",
        location: "Austin, TX",
        ...extra,
      }),
    });
    assert.equal(invalid.status, 400);
  }
  const created = await call("/jobs", hirer, "POST", {
    title: "Install rooftop systems in Austin",
    description:
      "Install and commission 18 residential rooftop solar systems in Austin.",
    trade: "installation",
    location: "Austin, TX",
    exactAddress: "Private Test Road 12",
    startWindow: "Next month",
    budgetCents: 6000000,
    projectType: "residential",
    systemSizeKw: 144,
    siteCount: 18,
    materialsBy: "hiring_company",
    requirements: "Crew must have current insurance.",
  });
  const id = created.id;
  assert.ok(id);
  const brief = (await call(`/jobs/${id}`, hirer)).job;
  assert.equal(brief.project_type, "residential");
  assert.equal(brief.system_size_kw, 144);
  assert.equal(brief.site_count, 18);
  assert.equal(brief.requirements, "Crew must have current insurance.");
  const invalidBrief = await fetch(`${base}/jobs`, {
    method: "POST",
    headers: { cookie: hirer.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Invalid numeric scope",
      description: "This should reject invalid structured numbers.",
      location: "Austin, TX",
      trade: "installation",
      siteCount: 0,
    }),
  });
  assert.equal(invalidBrief.status, 400);
  const badBreakdown = await fetch(`${base}/jobs/${id}/quote`, {
    method: "POST",
    headers: { cookie: provider.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      amountCents: 5000000,
      note: "Proposal with incorrect price total.",
      priceBreakdown: [{ label: "Labor", amountCents: 1 }],
    }),
  });
  assert.equal(badBreakdown.status, 400);
  await call(`/jobs/${id}/messages`, provider, "POST", {
    body: "Can you confirm site access before we quote?",
  });
  assert.equal(
    (await call(`/jobs/${id}`, hirer)).conversations.some(
      (c) => c.id === provider.company,
    ),
    true,
  );
  await call(`/jobs/${id}/invite`, hirer, "POST", {
    companyIds: [provider.company],
  });
  assert.equal(
    (await call(`/jobs/${id}`, provider)).permissions.invited,
    true,
    "A regular company can invite a demo company",
  );
  // A demo company can also hire a regular company, with the usual invite-only privacy.
  const demoJob = await call("/jobs", demo, "POST", {
    title: "Demo company hiring a solar specialist",
    description:
      "Prepare a design package and coordinate the installation schedule.",
    trade: "design",
    location: "Remote",
    workArrangement: "remote",
    visibility: "invite_only",
  });
  const notInvited = await fetch(`${base}/jobs/${demoJob.id}/quote`, {
    method: "POST",
    headers: { cookie: hirer.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      amountCents: 100000,
      note: "Invite-only jobs still need an invitation.",
    }),
  });
  assert.equal(notInvited.status, 403);
  await call(`/jobs/${demoJob.id}/invite`, demo, "POST", {
    companyIds: [hirer.company],
  });
  assert.equal(
    (await call(`/jobs/${demoJob.id}`, hirer)).permissions.invited,
    true,
  );
  await call(`/jobs/${demoJob.id}/messages`, hirer, "POST", {
    body: "We can help with this demo project.",
  });
  await call(`/jobs/${demoJob.id}/messages`, demo, "POST", {
    providerId: hirer.company,
    body: "Please send your quote.",
  });
  assert.equal(
    (await call(`/jobs/${demoJob.id}/messages`, hirer)).messages.length,
    2,
  );
  const mixedQuote = await call(`/jobs/${demoJob.id}/quote`, hirer, "POST", {
    amountCents: 100000,
    note: "Design package, installation schedule and project support.",
  });
  await call(`/jobs/${demoJob.id}/choose`, demo, "POST", {
    quoteId: mixedQuote.id,
  });
  await call(`/jobs/${demoJob.id}/confirm`, hirer, "POST", {});
  assert.equal(
    (await call(`/jobs/${demoJob.id}`, demo)).job.status,
    "in_progress",
  );
  const pdf = new Uint8Array(
    Buffer.from("%PDF-1.4\nConnect test attachment\n"),
  );
  const uploaded = await fetch(`${base}/jobs/${id}/files?name=plan.pdf`, {
    method: "POST",
    headers: { cookie: hirer.cookie, "content-type": "application/pdf" },
    body: pdf,
  });
  assert.equal(uploaded.status, 201);
  const fileId = (await uploaded.json()).id;
  assert.equal(
    (
      await fetch(`${base}/jobs/files/${fileId}`, {
        headers: { cookie: hirer.cookie },
      })
    ).status,
    200,
  );
  const preview = await fetch(`${base}/jobs/files/${fileId}?preview=1`, {
    headers: { cookie: hirer.cookie },
  });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-disposition"), /^inline/);
  assert.equal(preview.headers.get("content-type"), "application/pdf");
  const secondFile = await fetch(
    `${base}/jobs/${id}/files?name=site-notes.pdf`,
    {
      method: "POST",
      headers: { cookie: hirer.cookie, "content-type": "application/pdf" },
      body: pdf,
    },
  );
  assert.equal(secondFile.status, 201);
  assert.equal((await call(`/jobs/${id}`, hirer)).files.length, 2);
  const publicJob = await call(`/jobs/${id}`);
  assert.equal(publicJob.job.exact_address, "");
  assert.equal(
    (await call("/jobs")).jobs.some((j) => j.id === id),
    true,
  );
  await call(`/jobs/${id}/quote`, provider, "POST", {
    amountCents: 5000000,
    note: "Our install crew can complete all 18 systems.",
    startWindow: "Next month",
    duration: "3 weeks",
    priceBreakdown: [
      { label: "Labor", amountCents: 4000000 },
      { label: "Coordination", amountCents: 1000000 },
    ],
  });
  const cannotEdit = await fetch(`${base}/jobs/${id}`, {
    method: "PATCH",
    headers: { cookie: hirer.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Changed scope",
      description: "This job has a new and different scope now.",
      location: "Austin, TX",
      trade: "installation",
      status: "open",
    }),
  });
  assert.equal(cannotEdit.status, 409);
  await call(`/jobs/${id}/quote`, other, "POST", {
    amountCents: 4900000,
    note: "Our crew can also complete these systems.",
  });
  const hirerView = await call(`/jobs/${id}`, hirer);
  assert.equal(hirerView.quotes.length, 2);
  assert.equal(
    hirerView.quotes.find((q) => q.provider_company_id === provider.company)
      .price_breakdown.length,
    2,
  );
  assert.equal(hirerView.job.exact_address, "Private Test Road 12");
  const providerQuote = hirerView.quotes.find(
    (q) => q.provider_company_id === provider.company,
  );
  await call(`/jobs/${id}/choose`, hirer, "POST", {
    quoteId: providerQuote.id,
  });
  const rejectedView = await call(`/jobs/${id}`, other);
  assert.equal(
    rejectedView.selected,
    null,
    "Rejected bidder must not see winner's price",
  );
  assert.equal(rejectedView.job.exact_address, "");
  await call(`/jobs/${id}/confirm`, provider, "POST", {});
  await assert.rejects(
    () =>
      call(`/jobs/${id}/activity`, provider, "POST", {
        kind: "update_requested",
      }),
    /403/,
  );
  await assert.rejects(
    () =>
      call(`/jobs/${id}/activity`, other, "POST", {
        kind: "problem",
        body: "A company outside the job cannot report on it.",
      }),
    /403/,
  );
  await call(`/jobs/${id}/activity`, hirer, "POST", {
    kind: "update_requested",
  });
  await assert.rejects(
    () =>
      call(`/jobs/${id}/activity`, hirer, "POST", { kind: "update_requested" }),
    /409/,
  );
  await call(`/jobs/${id}/activity`, provider, "POST", {
    kind: "problem",
    body: "Please confirm site access with the building manager.",
  });
  const activity = (await call(`/jobs/${id}`, hirer)).updates;
  assert.ok(activity.some((u) => u.kind === "update_requested"));
  assert.ok(activity.some((u) => u.kind === "problem"));
  assert.equal(
    (await call(`/jobs/${id}`, other)).updates.length,
    0,
    "Job problems remain private to the two selected companies",
  );
  await assert.rejects(() => call("/jobs/inbox", null), /401/);
  const inbox = (await call("/jobs/inbox", provider)).threads;
  assert.ok(inbox.some((t) => t.job_id === id));
  assert.ok(
    inbox.every(
      (t) =>
        t.provider_id === provider.company || t.company.id !== provider.company,
    ),
    "Threads belong to this account",
  );
  assert.equal(
    inbox.find((t) => t.job_id === id).provider_id,
    provider.company,
  );
  assert.equal(inbox.find((t) => t.job_id === id).company.id, hirer.company);
  assert.ok(!JSON.stringify(inbox).includes("exact_address"));
  const otherInbox = (await call("/jobs/inbox", other)).threads;
  assert.ok(
    otherInbox.every((t) => t.provider_id !== provider.company),
    "No competing bidder conversations leak into inbox",
  );
  assert.equal(
    (await call("/jobs/inbox?q=no-such-job-zzzz", hirer)).threads.length,
    0,
  );
  await call(`/jobs/${id}/payment-stages`, hirer, "POST", {
    stages: [
      { title: "Deposit", amountCents: 2000000 },
      { title: "Completion", amountCents: 3000000 },
    ],
  });
  const stage = (await call(`/jobs/${id}`, hirer)).paymentStages[0];
  await call(`/jobs/${id}/payment-stages/${stage.id}`, provider, "POST", {
    status: "invoiced",
    invoiceReference: "TEST-001",
  });
  await call(`/jobs/${id}/payment-stages/${stage.id}`, hirer, "POST", {
    status: "reported_paid",
  });
  await call(`/jobs/${id}/payment-stages/${stage.id}`, provider, "POST", {
    status: "confirmed_received",
  });
  await call(`/jobs/${id}/messages`, provider, "POST", {
    body: "Crew is scheduled for next week.",
  });
  assert.equal(
    (await call(`/jobs/${id}/messages?providerId=${provider.company}`, hirer))
      .messages.length,
    2,
  );
  const progress = await call(`/jobs/${id}/updates`, provider, "POST", {
    kind: "progress",
    body: "First half of the roofs are finished.",
  });
  const privateUpload = await fetch(
    `${base}/jobs/${id}/files?name=progress.pdf&updateId=${progress.id}`,
    {
      method: "POST",
      headers: { cookie: provider.cookie, "content-type": "application/pdf" },
      body: pdf,
    },
  );
  assert.equal(privateUpload.status, 201);
  const privateFileId = (await privateUpload.json()).id;
  assert.equal(
    (
      await fetch(`${base}/jobs/files/${privateFileId}?preview=1`, {
        headers: { cookie: other.cookie },
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(`/jobs/${id}`, other)).files.some(
      (f) => f.id === privateFileId,
    ),
    false,
  );
  await call(`/jobs/${id}/updates`, provider, "POST", {
    kind: "completion",
    body: "All 18 systems installed and commissioned.",
  });
  assert.equal((await call(`/jobs/${id}`, hirer)).job.status, "review");
  await call(`/jobs/${id}/review-work`, hirer, "POST", { decision: "accept" });
  await call(`/jobs/${id}/reviews`, hirer, "POST", {
    rating: 5,
    text: "Finished on schedule.",
  });
  assert.equal((await call(`/jobs/${id}`, provider)).job.status, "completed");
  const workProfile = await call(
    `/jobs/companies/${(await db.query("SELECT slug FROM companies WHERE id=$1", [provider.company])).rows[0].slug}`,
  );
  assert.ok(workProfile.rating >= 5 && workProfile.completedJobs >= 1);
  await call(`/jobs/${draft.id}/quote`, provider, "POST", {
    amountCents: 900000,
    note: "Complete the work to the agreed scope.",
    startWindow: "Next week",
    duration: "Two weeks",
  });
  const ratedQuote = (await call(`/jobs/${draft.id}`, hirer)).quotes.find(
    (q) => q.provider_company_id === provider.company,
  );
  assert.equal(ratedQuote.job_rating, 5);
  assert.equal(
    ratedQuote.job_review_count,
    1,
    "Quote rating uses actual completed-job reviews",
  );
  console.log(
    "Rust jobs smoke test passed: demo and regular company interactions in both directions, draft/edit/publish, attachment, invite-only and quote privacy, award, confirm, payments, messages, progress, request update, private problem reports, scoped inbox, finish, review, real quote rating, work profile.",
  );
} finally {
  await db.end();
}
