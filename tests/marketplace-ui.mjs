import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
const base = process.env.MARKETPLACE_TEST_URL || "http://localhost:5173";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base))
  throw new Error(
    "UI workflow tests may only mutate a local test environment.",
  );
const password = process.env.MARKETPLACE_DEMO_PASSWORD;
if (!password)
  throw new Error(
    "Provide MARKETPLACE_DEMO_PASSWORD for the isolated demo accounts.",
  );
const out =
  process.env.MARKETPLACE_SCREENSHOTS || "/private/tmp/connect-marketplace-qa";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  args: ["--disable-quic"],
});
const failures = [];
const reports = [];
async function context(email) {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  if (email) {
    const r = await c.request.post(base + "/api/auth/login", {
      data: { email, password },
      headers: { Origin: base },
    });
    assert.equal(r.status(), 200, "Demo login");
  }
  return c;
}
async function visit(p, route) {
  await p.goto(base + route);
  await p.waitForTimeout(350);
  await p
    .locator(".job-loading,.market-skeleton")
    .first()
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {});
}
async function noOverflow(p, name) {
  assert.equal(
    await p.locator("main").count(),
    1,
    `${name}: one main landmark`,
  );
  const result = await p.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    wide: [...document.querySelectorAll("main *")]
      .filter(
        (e) =>
          e.getBoundingClientRect().right > innerWidth + 1 &&
          getComputedStyle(e).position !== "fixed",
      )
      .slice(0, 6)
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        width: e.getBoundingClientRect().width,
      })),
  }));
  assert.ok(
    result.scroll <= result.width + 1,
    `${name}: ${JSON.stringify(result)}`,
  );
  reports.push(name);
}
function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 57 >>\nstream\nBT /F1 18 Tf 72 700 Td (Connect test project plan) Tj ET\nendstream",
  ];
  let doc = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(doc));
    doc += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(doc);
  doc += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(doc);
}
try {
  const guest = await context();
  const publicPage = await guest.newPage();
  publicPage.on("pageerror", (e) => failures.push(e.message));
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await publicPage.setViewportSize({ width, height: 1000 });
    for (const route of ["/", "/providers?sample=true", "/jobs?sample=true"]) {
      await visit(publicPage, route);
      await noOverflow(publicPage, `guest ${route} ${width}`);
    }
  }
  await publicPage.setViewportSize({ width: 1440, height: 1000 });
  await visit(publicPage, "/");
  await publicPage.locator(".landing-grow-photo img").scrollIntoViewIfNeeded();
  await publicPage
    .locator(".landing-grow-photo img")
    .evaluate((i) => i.decode());
  await publicPage.evaluate(() => scrollTo(0, 0));
  await publicPage.screenshot({
    path: path.join(out, "landing-desktop.png"),
    fullPage: true,
  });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({
    path: path.join(out, "landing-mobile.png"),
    fullPage: true,
  });
  for (const label of [
    "Choose the right company.",
    "Keep the work together.",
    "Tell us what you need.",
  ]) {
    const control = publicPage.getByRole("button", {
      name: new RegExp(label.replaceAll(".", "\\.")),
    });
    await control.focus();
    await control.press("Enter");
    assert.equal(await control.getAttribute("aria-pressed"), "true");
    assert.equal(
      await publicPage.locator(".landing-preview-bar small").innerText(),
      "Example",
    );
    await noOverflow(publicPage, `landing walkthrough ${label}`);
  }
  for (const img of await publicPage
    .locator(".landing-hero-photo img,.landing-grow-photo img")
    .all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((i) => i.decode());
    assert.ok(await img.evaluate((i) => i.naturalWidth > 0));
  }
  const hirer = await context("demo01@connect.example"),
    provider = await context("demo11@connect.example");
  const h = await hirer.newPage(),
    p = await provider.newPage();
  h.on("pageerror", (e) => failures.push(e.message));
  p.on("pageerror", (e) => failures.push(e.message));
  await visit(h, "/jobs/new");
  await h
    .getByLabel("Job title", { exact: true })
    .fill("Need a 4-person installation crew — browser validation");
  await h.getByLabel("Type of work", { exact: true }).selectOption("crew");
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await h.setViewportSize({ width, height: 1000 });
    await noOverflow(h, `job title ${width}`);
  }
  await h.setViewportSize({ width: 1440, height: 1000 });
  await h.screenshot({ path: path.join(out, "job-title.png"), fullPage: true });
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  await h
    .getByLabel("Describe what you need", { exact: true })
    .fill(
      "Install and commission the rooftop array. Provide site coordination, installation labor, testing records, and final photographs.",
    );
  await h
    .getByText("Requirements & project details", { exact: false })
    .first()
    .click();
  await h
    .getByLabel("Project type", { exact: true })
    .selectOption("commercial");
  await h.getByLabel("System size (kW)", { exact: true }).fill("180");
  await h.getByLabel("Number of sites", { exact: true }).fill("3");
  await h
    .getByLabel("Who supplies materials?", { exact: true })
    .selectOption("hiring_company");
  await h
    .getByLabel("Requirements")
    .fill("Current insurance and commercial rooftop experience.");

  const image = await fs.readFile("apps/web/public/assets/solar.jpg");
  const files = [
    { name: "roof-plan.pdf", mimeType: "application/pdf", buffer: pdf() },
    { name: "roof-photo.jpg", mimeType: "image/jpeg", buffer: image },
  ];
  await h
    .getByLabel("Add files or photos", { exact: true })
    .setInputFiles(files);
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  await h.getByLabel("Add files or photos", { exact: true }).setInputFiles({
    name: "extra-photo.jpg",
    mimeType: "image/jpeg",
    buffer: image,
  });
  assert.equal(await h.locator(".job-attachment-card").count(), 3);
  await h
    .getByRole("button", { name: "Remove extra-photo.jpg", exact: true })
    .click();
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  await h
    .getByRole("button", { name: "Preview roof-photo.jpg", exact: true })
    .click();
  await h.locator(".job-file-viewer img").waitFor();
  await h.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.match(await h.locator(".viewer-zoom").innerText(), /150%/);
  await h.locator(".modal-close").click();
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await h.setViewportSize({ width, height: 1000 });
    await noOverflow(h, `job form ${width}`);
  }
  await h.setViewportSize({ width: 1440, height: 1000 });
  await h.screenshot({ path: path.join(out, "post-job.png"), fullPage: true });
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(
    await h.getByLabel("City or service area", { exact: true }).isVisible(),
    true,
    "Missing site location keeps the user on this step",
  );
  await h
    .getByLabel("City or service area", { exact: true })
    .fill("Austin, TX");
  await h.getByLabel("How many people do you need?").fill("4");
  await h.getByLabel("How long do you need help?").fill("4 weeks");
  await h.getByLabel("Start date or timing").fill("Within 4 weeks");

  await h.getByRole("radio", { name: /^Remote / }).check();
  assert.equal(
    await h.getByLabel("City or service area", { exact: true }).count(),
    0,
  );
  await h.getByRole("radio", { name: /^On site / }).check();
  assert.equal(
    await h.getByLabel("City or service area", { exact: true }).inputValue(),
    "Austin, TX",
  );
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await h.setViewportSize({ width, height: 1000 });
    await noOverflow(h, `job location ${width}`);
  }
  await h.setViewportSize({ width: 1440, height: 1000 });
  await h.screenshot({
    path: path.join(out, "job-location.png"),
    fullPage: true,
  });
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  await h.getByRole("radio", { name: /^I have a budget in mind/ }).check();
  await h.getByLabel("Total budget").fill("25000");
  await h
    .getByRole("radio", { name: /^Let companies propose a price/ })
    .check();
  assert.equal(await h.getByLabel("Total budget").count(), 0);
  await h.getByRole("radio", { name: /^I have a budget in mind/ }).check();
  assert.equal(await h.getByLabel("Total budget").inputValue(), "25000");
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await h.setViewportSize({ width, height: 1000 });
    await noOverflow(h, `job budget ${width}`);
  }
  await h.setViewportSize({ width: 1440, height: 1000 });
  await h.screenshot({
    path: path.join(out, "job-budget.png"),
    fullPage: true,
  });
  await h.getByRole("button", { name: "Review job", exact: true }).click();
  await h
    .getByRole("heading", { name: "Review your job", exact: true })
    .waitFor();
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await h.setViewportSize({ width, height: 1000 });
    await noOverflow(h, `review job ${width}`);
  }
  await h.getByRole("button", { name: "Edit details", exact: true }).click();
  await h
    .getByRole("heading", {
      name: "Give companies the full picture.",
      exact: true,
    })
    .waitFor();
  assert.match(
    await h.getByLabel("Describe what you need", { exact: true }).inputValue(),
    /commission the rooftop array/,
  );
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  await h.getByRole("button", { name: "Review job", exact: true }).click();
  await h.setViewportSize({ width: 1440, height: 1000 });
  await h.screenshot({
    path: path.join(out, "review-job.png"),
    fullPage: true,
  });
  await h.getByRole("button", { name: "Edit timing", exact: true }).click();
  assert.equal(
    await h.getByLabel("How many people do you need?").inputValue(),
    "4",
  );
  await h.getByRole("button", { name: "Review job", exact: true }).click();
  await h.getByRole("button", { name: "Publish job", exact: true }).click();
  await h.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
  const route = new URL(h.url()).pathname;
  await h
    .getByRole("heading", { name: "What’s needed", exact: true })
    .waitFor();
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  const detail = await (await hirer.request.get(base + "/api" + route)).json();
  assert.equal(detail.job.site_count, 3);
  assert.equal(detail.job.people_needed, 4);
  assert.equal(detail.job.expected_duration, "4 weeks");
  assert.equal(detail.job.trade, "crew");
  assert.equal(detail.files.length, 2);
  const pdfFile = detail.files.find((f) => f.mime_type === "application/pdf");
  const preview = await hirer.request.get(
    base + `/api/jobs/files/${pdfFile.id}?preview=1`,
  );
  assert.equal(preview.status(), 200);
  assert.match(preview.headers()["content-disposition"], /^inline/);
  assert.equal(preview.headers()["x-frame-options"], "SAMEORIGIN");
  await h
    .getByRole("button", { name: "Preview roof-plan.pdf", exact: true })
    .click();
  await h.locator(".job-file-viewer iframe").waitFor();
  await h.waitForTimeout(600);
  await h.screenshot({ path: path.join(out, "pdf-preview.png") });
  await h.locator(".modal-close").click();
  await visit(p, route);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    await noOverflow(p, `open job ${width}`);
    if (width <= 768)
      assert.equal(await p.locator(".job-mobile-action").isVisible(), true);
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.getByRole("button", { name: "Send a quote", exact: true }).click();
  await p.getByLabel("Your price (USD)", { exact: true }).fill("25000");
  await p.getByLabel("Earliest start", { exact: true }).fill("In 3 weeks");
  await p.getByLabel("Estimated duration", { exact: true }).fill("4 weeks");
  await p
    .getByLabel("Your approach", { exact: true })
    .fill(
      "Our four-person crew will install one rooftop at a time and provide weekly progress reports and commissioning records.",
    );
  await p
    .getByText("Add a price breakdown (optional)", { exact: true })
    .click();
  await p.getByRole("button", { name: "Add cost item", exact: true }).click();
  await p.getByLabel("Cost item 1", { exact: true }).fill("Installation labor");
  await p
    .getByLabel("Cost item 1 amount in USD", { exact: true })
    .fill("20000");
  await p.getByRole("button", { name: "Add cost item", exact: true }).click();
  await p.getByLabel("Cost item 2", { exact: true }).fill("Mobilization");
  await p.getByLabel("Cost item 2 amount in USD", { exact: true }).fill("5000");
  await p
    .getByLabel("Add proposal files or photos", { exact: true })
    .setInputFiles(files);
  await p
    .getByLabel("Add proposal files or photos", { exact: true })
    .setInputFiles({
      name: "crew-photo.jpg",
      mimeType: "image/jpeg",
      buffer: image,
    });
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    await noOverflow(p, `quote form ${width}`);
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.screenshot({
    path: path.join(out, "send-quote.png"),
    fullPage: true,
  });
  await p.getByRole("button", { name: "Send quote", exact: true }).click();
  await p.getByRole("heading", { name: "Your quote", exact: true }).waitFor();
  await visit(h, route);
  await h
    .getByRole("heading", { name: "1 quote received", exact: true })
    .waitFor();
  assert.match(
    await h.locator(".quote-breakdown-display").innerText(),
    /Installation labor/,
  );
  assert.equal(await h.locator(".job-attachment-card").count(), 5);
  await h.getByRole("button", { name: "Message", exact: true }).click();
  await h
    .getByLabel("Job message", { exact: true })
    .fill("Can you confirm the proposed start?");
  await h.getByRole("button", { name: "Send", exact: true }).click();
  await h
    .getByText("Can you confirm the proposed start?", { exact: true })
    .waitFor();
  await h.getByRole("button", { name: "Overview", exact: true }).click();
  await h.screenshot({
    path: path.join(out, "compare-quote.png"),
    fullPage: true,
  });
  await h.getByRole("button", { name: "Choose company", exact: true }).click();
  await h
    .locator(".job-confirm-dialog")
    .getByRole("button", { name: "Choose company", exact: true })
    .click();
  await h.getByText("Waiting for confirmation", { exact: true }).waitFor();
  await visit(p, route);
  await p.getByRole("button", { name: "Confirm job", exact: true }).click();
  await p.getByRole("heading", { name: "Progress", exact: true }).waitFor();
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    await noOverflow(p, `active job ${width}`);
    await visit(h, "/jobs/mine?view=posted");
    await h.setViewportSize({ width, height: 1000 });
    await noOverflow(h, `my jobs ${width}`);
  }
  await visit(p, "/demo-mesa-peak-solar");
  await p
    .getByRole("heading", { name: "Mesa Peak Solar", exact: true })
    .waitFor();
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    await noOverflow(p, `company profile ${width}`);
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.screenshot({
    path: path.join(out, "company-profile.png"),
    fullPage: true,
  });
  await visit(h, "/jobs/new");
  await h
    .getByLabel("Job title", { exact: true })
    .fill("Remote solar design support — browser validation");
  await h.getByLabel("Type of work", { exact: true }).selectOption("design");
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  await h
    .getByLabel("Describe what you need", { exact: true })
    .fill(
      "We need a remote specialist to prepare a complete solar design drawing package.",
    );
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  await h.getByRole("radio", { name: /^Remote / }).check();
  assert.equal(
    await h.getByLabel("City or service area", { exact: true }).count(),
    0,
  );
  assert.equal(await h.getByLabel("How many people do you need?").count(), 0);
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  await h.getByRole("button", { name: "Review job", exact: true }).click();
  await h.getByRole("button", { name: "Publish job", exact: true }).click();
  await h.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
  const remote = await (
    await hirer.request.get(base + "/api" + new URL(h.url()).pathname)
  ).json();
  assert.equal(remote.job.work_arrangement, "remote");
  assert.equal(remote.job.location, "Remote");
  assert.equal(remote.job.system_size_kw, null);
  assert.equal(
    remote.job.budget_cents,
    null,
    "Open pricing remains genuinely open",
  );
  await visit(h, "/jobs/new");
  await h.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(
    await h.getByLabel("Job title", { exact: true }).isVisible(),
    true,
    "A title is required before advancing",
  );
  await h
    .getByLabel("Job title", { exact: true })
    .fill("Draft for next week — browser validation");
  await h.getByRole("button", { name: "Save draft", exact: true }).click();
  await h.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
  const draftPath = new URL(h.url()).pathname;
  const draft = await (
    await hirer.request.get(base + "/api" + draftPath)
  ).json();
  assert.equal(draft.job.status, "draft");
  assert.equal(draft.job.description, "");
  await visit(h, draftPath + "/edit");
  assert.equal(
    await h.getByLabel("Job title", { exact: true }).inputValue(),
    "Draft for next week — browser validation",
  );
  await h.getByRole("button", { name: "Review job", exact: true }).click();
  await h
    .getByRole("heading", {
      name: "Give companies the full picture.",
      exact: true,
    })
    .waitFor();
  assert.match(await h.locator(".job-error").innerText(), /little more detail/);

  await visit(p, "/jobs?trade=crew&sample=true");
  assert.equal(
    await p.locator('.work-type-nav button[aria-pressed="true"]').innerText(),
    "Crews & labor",
  );
  assert.deepEqual(failures, [], "No uncaught page exceptions");
  console.log(
    JSON.stringify({
      status: "passed",
      responsiveChecks: reports.length,
      workflow:
        "crew and remote requests, review and edit, multiple attachments, previews, quote breakdown, comparison, messages, selection, confirmation",
      screenshots: out,
    }),
  );
} finally {
  await browser.close();
}
