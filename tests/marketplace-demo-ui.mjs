import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { hashPassword } from "../apps/api/dist/auth.js";

const base = process.env.MARKETPLACE_TEST_URL || "http://localhost:5173";
const databaseUrl = new URL(process.env.DATABASE_URL);
if (
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base) ||
  !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
  !databaseUrl.pathname.includes("test")
) {
  throw new Error("Use an isolated local test database and web server.");
}
const password = process.env.MARKETPLACE_DEMO_PASSWORD;
if (!password) throw new Error("Provide the isolated demo account password.");
const db = new pg.Client({ connectionString: databaseUrl.href });
await db.connect();
const out =
  process.env.MARKETPLACE_SCREENSHOTS || "/private/tmp/connect-demo-ui";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  args: ["--disable-quic"],
});
const suffix = randomBytes(5).toString("hex"),
  slug = "demo-access-test-" + suffix,
  email = slug + "@example.test";
let companyId, userId;
const jobIds = [],
  errors = [];
try {
  // A new regular company is test-owned; existing demo records are never reclassified.
  companyId = (
    await db.query(
      "INSERT INTO companies(slug,username,name,listing_status,is_demo) VALUES($1,$1,$2,'managed',false) RETURNING id",
      [slug, "Regular Test Company " + suffix],
    )
  ).rows[0].id;
  userId = (
    await db.query(
      "INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at,account_type) VALUES($1,'Demo Access Tester',$2,now(),now(),'company') RETURNING id",
      [email, await hashPassword(password)],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
    [userId, companyId],
  );
  const context = async (email) => {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const r = await c.request.post(base + "/api/auth/login", {
      data: { email, password },
      headers: { Origin: base },
    });
    assert.equal(r.status(), 200, "Fixture login");
    return c;
  };
  const demo = await context("demo11@connect.example"),
    regular = await context(email);
  const d = await demo.newPage(),
    r = await regular.newPage();
  for (const p of [d, r])
    p.on("pageerror", (error) => errors.push(error.message));
  const api = async (c, path, body) => {
    const response = body
      ? await c.request.post(base + "/api" + path, {
          data: body,
          headers: { Origin: base },
        })
      : await c.request.get(base + "/api" + path);
    assert.ok(response.ok(), path + " status " + response.status());
    return response.json();
  };
  const createJob = async (c, label) => {
    const job = await api(c, "/jobs", {
      title: label + " " + suffix,
      description:
        "Prepare an installation plan and coordinate the solar crew for this test project.",
      location: "Austin, TX",
      trade: "installation",
      budgetCents: 100000,
    });
    jobIds.push(job.id);
    return job.id;
  };
  const normalJob = await createJob(regular, "Regular company hiring"),
    demoJob = await createJob(demo, "Demo company hiring");
  const visit = async (p, path, selector) => {
    await p.goto(base + path);
    await p.locator(selector).first().waitFor();
  };
  await visit(d, "/providers", ".provider-card");
  assert.equal(
    await d.getByRole("checkbox", { name: "Show demo companies" }).isChecked(),
    true,
  );
  await d.getByRole("checkbox", { name: "Show demo companies" }).click();
  await expect(
    d.getByRole("checkbox", { name: "Show demo companies" }),
  ).not.toBeChecked();
  await d
    .getByLabel("Company or service")
    .fill("Regular Test Company " + suffix);
  await d.getByRole("button", { name: "Find companies", exact: true }).click();
  await d
    .getByRole("heading", {
      name: "Regular Test Company " + suffix,
      exact: true,
    })
    .waitFor();
  await d.getByRole("button", { name: "Clear filters", exact: true }).click();
  assert.equal(
    new URL(d.url()).searchParams.get("sample"),
    "false",
    "Clearing filters preserves explicit regular-company selection",
  );
  assert.equal(
    await d.getByRole("checkbox", { name: "Show demo companies" }).isChecked(),
    false,
  );
  await visit(d, "/" + slug, ".provider-profile-hero");
  await d.getByRole("button", { name: "Invite to a job", exact: true }).click();
  await d
    .getByLabel("Choose a job to invite this company to")
    .selectOption(demoJob);
  await d.getByRole("button", { name: "Send invitation", exact: true }).click();
  await d.getByText("Invitation sent", { exact: true }).waitFor();
  assert.equal(
    (await api(regular, "/jobs/" + demoJob)).permissions.invited,
    true,
  );
  await visit(r, "/jobs/" + normalJob, ".workspace-job-header");
  await r
    .getByRole("button", { name: "Invite companies", exact: true })
    .click();
  await r.getByRole("checkbox", { name: "Show demo companies" }).check();
  await r.getByLabel("Search companies to invite").fill("Summit Grid Electric");
  await r
    .locator(".job-invite-result")
    .filter({ hasText: "Summit Grid Electric" })
    .click();
  await r
    .getByRole("button", { name: "Send 1 invitation", exact: true })
    .click();
  await r.getByText("Invitations sent", { exact: true }).waitFor();
  assert.equal(
    (await api(demo, "/jobs/" + normalJob)).permissions.invited,
    true,
  );
  await visit(d, "/jobs/" + normalJob, ".workspace-job-header");
  await d.getByRole("button", { name: "Send a quote", exact: true }).click();
  await d.getByLabel("Your price (USD)", { exact: true }).fill("1000");
  await d.getByLabel("Earliest start", { exact: true }).fill("Next week");
  await d.getByLabel("Estimated duration", { exact: true }).fill("2 weeks");
  await d
    .getByLabel("Your approach", { exact: true })
    .fill(
      "Our demo crew will prepare the installation plan and coordinate the on-site work.",
    );
  await d.getByRole("button", { name: "Send quote", exact: true }).click();
  await d.getByRole("heading", { name: "Your quote", exact: true }).waitFor();
  await visit(r, "/jobs/" + normalJob, ".workspace-job-header");
  await r
    .getByRole("heading", { name: "1 quote received", exact: true })
    .waitFor();
  await r.getByRole("button", { name: "Message", exact: true }).click();
  await r
    .getByLabel("Job message", { exact: true })
    .fill("Thanks for the demo quote. Can you confirm availability?");
  await r.getByRole("button", { name: "Send", exact: true }).click();
  await r
    .getByRole("log", { name: "Job messages" })
    .getByText("Thanks for the demo quote. Can you confirm availability?", {
      exact: true,
    })
    .waitFor();
  await visit(r, "/jobs/" + demoJob, ".workspace-job-header");
  await r.getByRole("button", { name: "Send a quote", exact: true }).click();
  await r.getByLabel("Your price (USD)", { exact: true }).fill("950");
  await r.getByLabel("Earliest start", { exact: true }).fill("Next week");
  await r.getByLabel("Estimated duration", { exact: true }).fill("2 weeks");
  await r
    .getByLabel("Your approach", { exact: true })
    .fill(
      "Our team will prepare the installation plan and manage the solar work schedule.",
    );
  await r.getByRole("button", { name: "Send quote", exact: true }).click();
  await r.getByRole("heading", { name: "Your quote", exact: true }).waitFor();
  await visit(r, "/demo-summit-grid-electric", ".provider-profile-hero");
  assert.ok(
    await r
      .getByRole("button", { name: "Invite to a job", exact: true })
      .isVisible(),
  );
  await visit(r, "/jobs/" + normalJob, ".workspace-job-header");
  await r
    .getByRole("button", { name: "Invite companies", exact: true })
    .click();
  for (const width of [390, 1440]) {
    await r.setViewportSize({ width, height: 900 });
    await r.locator(".job-invite").scrollIntoViewIfNeeded();
    assert.ok(
      await r.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await r.screenshot({ path: out + "/invite-" + width + ".png" });
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      tested:
        "Demo discovery defaults, filter persistence, invitations and quotes in both directions, job messages, mobile and desktop invitation controls",
    }),
  );
} finally {
  await browser.close();
  if (jobIds.length)
    await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobIds]);
  if (companyId)
    await db.query("DELETE FROM companies WHERE id=$1", [companyId]);
  if (userId) await db.query("DELETE FROM users WHERE id=$1", [userId]);
  await db.end();
}
