import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

// Generate a readable one-page PDF rather than a header-only mock attachment.
function updatePdf() {
  const text = "BT /F1 18 Tf 72 700 Td (Colabb commissioning update) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document);
}

async function post(
  actor: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
) {
  const response = await actor.post("/api" + path, { data });
  expect(response.ok(), `${path}: ${response.status()}`).toBeTruthy();
  return response.json();
}

test.describe("Colabb job update timeline", () => {
  const providerName = "Timeline Electric " + randomUUID().slice(0, 8);
  const hirerName = "Timeline Solar " + randomUUID().slice(0, 8);
  const providerMessage =
    "Cable routes and mounting positions are confirmed. Our electrical crew completed the first set of circuit checks and recorded the results in the attached commissioning report. We will return tomorrow to complete the remaining inverter checks and prepare the handover documents.";
  const hirerMessage =
    "The building manager has confirmed access for tomorrow morning. Please use the east service entrance and call the site lead when the crew arrives. The loading area will remain clear while you bring in the test equipment.";
  const filename = "Commissioning progress report.pdf";
  let jobId = "";
  let fileId = "";
  let hirer: APIRequestContext;
  let provider: APIRequestContext;
  let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

  test.beforeAll(async ({ playwright, baseURL }) => {
    // This suite creates its own accounts and job through normal authenticated
    // endpoints. Both the browser origin and database must be isolated locally.
    expect(baseURL).toBeTruthy();
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
    const database = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    expect(
      database,
      "Use the dedicated local test database runner",
    ).toBeTruthy();
    const databaseUrl = new URL(database!);
    expect(databaseUrl.pathname).toMatch(/^\/[a-z0-9_]+_test$/);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(databaseUrl.hostname);

    hirer = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL! },
    });
    provider = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL! },
    });
    for (const [actor, companyName] of [
      [hirer, hirerName],
      [provider, providerName],
    ] as const) {
      const email = `colabb-timeline-${randomUUID()}@example.test`;
      const response = await actor.post("/api/auth/register", {
        data: {
          name: "Timeline Test Owner",
          companyName,
          email,
          password: "ColabbTimelineTest123!",
        },
      });
      expect(response.status()).toBe(201);
      // Deliver the locally queued verification email to this test account.
      // Read-only access mirrors accounts.test.mjs; verification itself uses
      // the real authenticated endpoint and never changes the database here.
      const challenge = await post(actor, "/auth/verification/request", {});
      expect(
        process.env.AUTH_TOKEN_SECRET,
        "Use the isolated runner's mail key",
      ).toBeTruthy();
      const mail = new pg.Client({ connectionString: database });
      await mail.connect();
      let payload: string;
      try {
        const result = await mail.query(
          "SELECT payload_encrypted FROM email_outbox WHERE recipient=$1 ORDER BY created_at DESC LIMIT 1",
          [email],
        );
        payload = result.rows[0]?.payload_encrypted;
      } finally {
        await mail.end();
      }
      expect(payload!).toBeTruthy();
      const encrypted = Buffer.from(payload!, "base64");
      const key = createHash("sha256")
        .update(process.env.AUTH_TOKEN_SECRET!)
        .digest();
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        encrypted.subarray(0, 12),
      );
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const code = Buffer.concat([
        decipher.update(encrypted.subarray(28)),
        decipher.final(),
      ])
        .toString()
        .match(/\b\d{6}\b/)?.[0];
      expect(Boolean(code)).toBeTruthy();
      await post(actor, "/auth/verification/confirm", {
        challengeId: challenge.challengeId,
        code,
      });
      await post(actor, "/onboarding/complete", { followIds: [] });
    }

    const job = await post(hirer, "/jobs", {
      title: "Commission a commercial rooftop solar system",
      description:
        "Complete electrical commissioning for the commercial rooftop system. Confirm the cable routes, test every circuit and share the inspection-ready results with the site manager.",
      trade: "electrical",
      location: "Cleveland, OH",
      budgetCents: 2400000,
      startWindow: "In two weeks",
      workChecklist: [
        {
          id: randomUUID(),
          title: "Confirm cable routes and mounting positions",
        },
        {
          id: randomUUID(),
          title: "Complete circuit checks and share results",
        },
      ],
    });
    jobId = job.id;
    const quote = await post(provider, `/jobs/${jobId}/quote`, {
      note: "Our commercial electrical team will coordinate site access, test each circuit and supply commissioning records with the final handover. A dedicated site lead will oversee the work.",
      amountCents: 2400000,
      startWindow: "In two weeks",
      duration: "Two weeks",
    });
    await post(hirer, `/jobs/${jobId}/choose`, {
      quoteId: quote.id,
      version: quote.version,
    });
    await post(provider, `/jobs/${jobId}/confirm`, {
      quoteId: quote.id,
      version: quote.version,
      decision: "accept",
    });

    const update = await post(provider, `/jobs/${jobId}/updates`, {
      kind: "progress",
      body: providerMessage,
      attachmentCount: 1,
    });
    const params = new URLSearchParams({
      name: filename,
      updateId: update.id,
      uploadId: randomUUID(),
    });
    const uploaded = await provider.post(`/api/jobs/${jobId}/files?${params}`, {
      headers: { "Content-Type": "application/pdf" },
      data: updatePdf(),
    });
    expect(uploaded.status()).toBe(201);
    fileId = (await uploaded.json()).id;
    await post(provider, `/jobs/${jobId}/updates/${update.id}/publish`, {});
    await post(hirer, `/jobs/${jobId}/updates`, {
      kind: "progress",
      body: hirerMessage,
    });
    cookies = (await hirer.storageState()).cookies;
  });

  test.afterAll(async () => {
    await hirer?.dispose();
    await provider?.dispose();
  });

  for (const width of [1440, 390, 320]) {
    test(`updates keep metadata, message and attachment readable at ${width}px`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies(cookies);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/_interface/colabb");
      await page.goto(`/jobs/${jobId}`);
      const tabs = page.getByRole("navigation", { name: "Project sections" });
      await tabs.getByRole("button", { name: "Updates", exact: true }).click();
      await expect(
        tabs.getByRole("button", { name: "Updates", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      const list = page.getByRole("list", { name: "Job updates" });
      const rows = list.locator(".job-update");
      await expect(rows).toHaveCount(2);
      await expect(rows.first().locator(".job-update-content > p")).toHaveText(
        hirerMessage,
      );
      await expect(rows.last().locator(".job-update-content > p")).toHaveText(
        providerMessage,
      );
      await expect(rows.first().locator(".job-update-time")).toContainText(
        hirerName,
      );
      await expect(rows.last().locator(".job-update-time")).toContainText(
        providerName,
      );

      for (const row of await rows.all()) {
        const timestamp = row.locator("time");
        await expect(timestamp).toBeVisible();
        await expect(timestamp).not.toHaveText("");
        expect(
          Number.isFinite(
            Date.parse((await timestamp.getAttribute("datetime"))!),
          ),
        ).toBeTruthy();
        const content = row.locator(".job-update-content");
        const dimensions = await content.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const parent = element.parentElement!.getBoundingClientRect();
          const metadata =
            element.previousElementSibling!.getBoundingClientRect();
          return {
            x: rect.x,
            right: rect.right,
            width: rect.width,
            top: rect.top,
            innerWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            parentRight: parent.right,
            metaBottom: metadata.bottom,
          };
        });
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(
          dimensions.innerWidth + 1,
        );
        expect(dimensions.right).toBeLessThanOrEqual(
          dimensions.parentRight + 1,
        );
        expect(dimensions.x).toBeGreaterThanOrEqual(0);
        expect(dimensions.right).toBeLessThanOrEqual(width);
        if (width >= 1000) {
          expect(dimensions.width).toBeGreaterThan(500);
        } else {
          expect(dimensions.top).toBeGreaterThanOrEqual(dimensions.metaBottom);
          expect(dimensions.width).toBeGreaterThan(width * 0.65);
        }
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: testInfo.outputPath(`job-updates-${width}.png`),
        fullPage: true,
      });
      await list.screenshot({
        path: testInfo.outputPath(`job-updates-timeline-${width}.png`),
      });

      await rows
        .last()
        .getByRole("button", { name: `Preview ${filename}`, exact: true })
        .click();
      await expect(page).toHaveURL(/\/actions\/[a-f0-9-]+$/);
      const viewer = page.getByRole("region", { name: "Attachment preview" });
      await expect(viewer).toBeVisible();
      await expect(
        viewer.getByRole("heading", { name: filename, exact: true }),
      ).toBeVisible();
      await expect(
        viewer.locator(`iframe[title="PDF preview: ${filename}"]`),
      ).toHaveAttribute(
        "src",
        new RegExp(`/api/jobs/files/${fileId}.*#view=FitH$`),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const viewerWidth = await viewer.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      expect(viewerWidth).toBeGreaterThanOrEqual(width * 0.9);
      await viewer
        .getByRole("button", { name: "Close preview", exact: true })
        .click();
      await expect(page).toHaveURL(`/jobs/${jobId}`);
      await expect(list).toBeVisible();
      await expect(rows.last().locator(".job-update-content > p")).toHaveText(
        providerMessage,
      );
      expect(errors).toEqual([]);
    });
  }
});
