import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const base = process.env.JOBS_TEST_URL || "http://127.0.0.1:4201";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function account(name, isDemo = false) {
  const slug = `jobs-test-${name.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const user = (await db.query("INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,'test',now(),now()) RETURNING id", [`${slug}@example.test`, name])).rows[0].id;
  const company = (await db.query("INSERT INTO companies(slug,name,username,is_demo) VALUES($1,$2,$1,$3) RETURNING id", [slug, `${name} Solar`, isDemo])).rows[0].id;
  await db.query("INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')", [user, company]);
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash("sha256").update(token).digest("hex"), user, company]);
  return { cookie: `connect_session=${token}`, company, slug };
}
async function call(path, account, method = "GET", body) {
  const res = await fetch(base + path, { method, headers: { ...(account ? { cookie: account.cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
try {
  const hirer = await account("Hirer"), provider = await account("Provider"), other = await account("Other"), demo = await account("Demo", true);
  assert.equal((await call(`/jobs/providers?q=${provider.slug}`)).providers.some(p => p.id === provider.company), true);
  assert.equal((await call(`/jobs/providers?q=${demo.slug}&sample=true`)).providers.some(p => p.id === demo.company), true);
  assert.equal((await call(`/jobs/providers?q=${demo.slug}`)).total, 0);
  const draft = await call("/jobs", hirer, "POST", { title: "", description: "", location: "", trade: "installation", status: "draft" });
  assert.equal((await call(`/jobs/${draft.id}`, hirer)).job.status, "draft");
  await call(`/jobs/${draft.id}`, hirer, "PATCH", { title: "Install systems near Austin", description: "Install ten systems in the greater Austin area.", location: "Austin, TX", trade: "installation", status: "open" });
  assert.equal((await call(`/jobs/${draft.id}`, hirer)).job.status, "open");
  const created = await call("/jobs", hirer, "POST", { title: "Install rooftop systems in Austin", description: "Install and commission 18 residential rooftop solar systems in Austin.", trade: "installation", location: "Austin, TX", exactAddress: "Private Test Road 12", startWindow: "Next month", budgetCents: 6000000 });
  const id = created.id;
  assert.ok(id);
  const demoQuote = await fetch(`${base}/jobs/${id}/quote`, { method: "POST", headers: { cookie: demo.cookie, "content-type": "application/json" }, body: JSON.stringify({ amountCents: 5000000, note: "A demo account must not quote a real job." }) });
  assert.equal(demoQuote.status, 403);
  await call(`/jobs/${id}/invite`, hirer, "POST", { companyIds: [demo.company] });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM job_invitations WHERE job_id=$1 AND provider_company_id=$2", [id, demo.company])).rows[0].n, 0);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.4\nConnect test attachment\n"));
  const uploaded = await fetch(`${base}/jobs/${id}/files?name=plan.pdf`, { method: "POST", headers: { cookie: hirer.cookie, "content-type": "application/pdf" }, body: pdf });
  assert.equal(uploaded.status, 201);
  const fileId = (await uploaded.json()).id;
  assert.equal((await fetch(`${base}/jobs/files/${fileId}`, { headers: { cookie: hirer.cookie } })).status, 200);
  const publicJob = await call(`/jobs/${id}`);
  assert.equal(publicJob.job.exact_address, "");
  assert.equal((await call("/jobs")).jobs.some(j => j.id === id), true);
  await call(`/jobs/${id}/quote`, provider, "POST", { amountCents: 5000000, note: "Our install crew can complete all 18 systems.", startWindow: "Next month", duration: "3 weeks" });
  const cannotEdit = await fetch(`${base}/jobs/${id}`, { method: "PATCH", headers: { cookie: hirer.cookie, "content-type": "application/json" }, body: JSON.stringify({ title: "Changed scope", description: "This job has a new and different scope now.", location: "Austin, TX", trade: "installation", status: "open" }) });
  assert.equal(cannotEdit.status, 409);
  await call(`/jobs/${id}/quote`, other, "POST", { amountCents: 4900000, note: "Our crew can also complete these systems." });
  const hirerView = await call(`/jobs/${id}`, hirer);
  assert.equal(hirerView.quotes.length, 2);
  assert.equal(hirerView.job.exact_address, "Private Test Road 12");
  const providerQuote = hirerView.quotes.find(q => q.provider_company_id === provider.company);
  await call(`/jobs/${id}/choose`, hirer, "POST", { quoteId: providerQuote.id });
  const rejectedView = await call(`/jobs/${id}`, other);
  assert.equal(rejectedView.selected, null, "Rejected bidder must not see winner's price");
  assert.equal(rejectedView.job.exact_address, "");
  await call(`/jobs/${id}/confirm`, provider, "POST", {});
  await call(`/jobs/${id}/payment-stages`, hirer, "POST", { stages: [{ title: "Deposit", amountCents: 2000000 }, { title: "Completion", amountCents: 3000000 }] });
  const stage = (await call(`/jobs/${id}`, hirer)).paymentStages[0];
  await call(`/jobs/${id}/payment-stages/${stage.id}`, provider, "POST", { status: "invoiced", invoiceReference: "TEST-001" });
  await call(`/jobs/${id}/payment-stages/${stage.id}`, hirer, "POST", { status: "reported_paid" });
  await call(`/jobs/${id}/payment-stages/${stage.id}`, provider, "POST", { status: "confirmed_received" });
  await call(`/jobs/${id}/messages`, provider, "POST", { body: "Crew is scheduled for next week." });
  assert.equal((await call(`/jobs/${id}/messages?providerId=${provider.company}`, hirer)).messages.length, 1);
  const progress = await call(`/jobs/${id}/updates`, provider, "POST", { kind: "progress", body: "First half of the roofs are finished." });
  const privateUpload = await fetch(`${base}/jobs/${id}/files?name=progress.pdf&updateId=${progress.id}`, { method: "POST", headers: { cookie: provider.cookie, "content-type": "application/pdf" }, body: pdf });
  assert.equal(privateUpload.status, 201);
  const privateFileId = (await privateUpload.json()).id;
  assert.equal((await fetch(`${base}/jobs/files/${privateFileId}`, { headers: { cookie: other.cookie } })).status, 404);
  assert.equal((await call(`/jobs/${id}`, other)).files.some(f => f.id === privateFileId), false);
  await call(`/jobs/${id}/updates`, provider, "POST", { kind: "completion", body: "All 18 systems installed and commissioned." });
  assert.equal((await call(`/jobs/${id}`, hirer)).job.status, "review");
  await call(`/jobs/${id}/review-work`, hirer, "POST", { decision: "accept" });
  await call(`/jobs/${id}/reviews`, hirer, "POST", { rating: 5, text: "Finished on schedule." });
  assert.equal((await call(`/jobs/${id}`, provider)).job.status, "completed");
  const workProfile = await call(`/jobs/companies/${(await db.query("SELECT slug FROM companies WHERE id=$1", [provider.company])).rows[0].slug}`);
  assert.ok(workProfile.rating >= 5 && workProfile.completedJobs >= 1);
  console.log("Rust jobs smoke test passed: draft/edit/publish, attachment, quote privacy, award, confirm, payments, messages, progress, finish, review, work profile.");
} finally {
  await db.end();
}
