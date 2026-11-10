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
  assert.equal(await p.locator("main").count(), 1, `${name}: one main landmark`);
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
  await publicPage.screenshot({
    path: path.join(out, "landing-desktop.png"),
    fullPage: true,
  });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({
    path: path.join(out, "landing-mobile.png"),
    fullPage: true,
  });
  const hirer = await context("demo01@connect.example"),
    provider = await context("demo11@connect.example");
  const h = await hirer.newPage(),
    p = await provider.newPage();
  h.on("pageerror", (e) => failures.push(e.message));
  p.on("pageerror", (e) => failures.push(e.message));
  await visit(h, "/jobs/new");
  await h
    .getByLabel("Job title", { exact: true })
    .fill("Install rooftop systems — browser validation");
  await h.getByLabel("Location", { exact: true }).fill("Austin, TX");
  await h.getByLabel("Start", { exact: true }).fill("Within 4 weeks");
  await h
    .getByLabel("Describe the work", { exact: true })
    .fill(
      "Install and commission the rooftop array. Provide site coordination, installation labor, testing records, and final photographs.",
    );
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
  await h.getByLabel("Budget").fill("25000");
  const image = await fs.readFile("apps/web/public/assets/solar.jpg");
  const files = [
    { name: "roof-plan.pdf", mimeType: "application/pdf", buffer: pdf() },
    { name: "roof-photo.jpg", mimeType: "image/jpeg", buffer: image },
  ];
  await h
    .getByLabel("Add plans or photos", { exact: true })
    .setInputFiles(files);
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  await h
    .getByLabel("Add plans or photos", { exact: true })
    .setInputFiles({
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
  await h.getByRole("button", { name: "Publish job", exact: true }).click();
  await h.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
  const route = new URL(h.url()).pathname;
  await h.getByRole("heading", { name: "The work", exact: true }).waitFor();
  assert.equal(await h.locator(".job-attachment-card").count(), 2);
  const detail = await (await hirer.request.get(base + "/api" + route)).json();
  assert.equal(detail.job.site_count, 3);
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
  assert.deepEqual(failures, [], "No uncaught page exceptions");
  console.log(
    JSON.stringify({
      status: "passed",
      responsiveChecks: reports.length,
      workflow:
        "multiple attachments, previews, job creation, quote breakdown, comparison, messages, selection, confirmation",
      screenshots: out,
    }),
  );
} finally {
  await browser.close();
}
