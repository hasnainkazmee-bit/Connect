import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

for (const width of [1440, 390, 2560])
  test(`public company credentials show scope and evidence at ${width}px`, async ({
    page,
  }) => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const username = `credentials-${randomUUID().slice(0, 8)}`;
    let companyId: string | undefined;
    try {
      const company = (
        await db.query(
          "INSERT INTO companies(name,slug,username,listing_status) VALUES('Evidence Solar',$1,$1,'unclaimed') RETURNING id",
          [username],
        )
      ).rows[0];
      companyId = company.id;
      await db.query(
        "INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,description,source_url,evidence_basis,period,checked_at,valid_until) VALUES($1,'certification','UL 61730 documentation','Example laboratory','product','Only the Example-400 model','Confirm the exact model in the certificate.','https://example.test/certificate','company','2025', '2026-11-06','2025-12-31'),($1,'directory','EnergySage profile','EnergySage','company','Public company profile','Listing presence does not imply network approval.','https://www.energysage.com/supplier/example/','directory','', '2026-11-06',NULL)",
        [company.id],
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/${username}`);
      const card = page.locator(".credentials-card");
      await expect(
        card.getByRole("heading", {
          name: "Credentials & presence",
          exact: true,
        }),
      ).toBeVisible();
      await expect(card.getByText("Only the Example-400 model")).toBeHidden();
      await card
        .getByRole("heading", { name: "UL 61730 documentation" })
        .click();
      await expect(card.getByText("Only the Example-400 model")).toBeVisible();
      await expect(
        card.getByText("Company-reported", { exact: false }),
      ).toBeVisible();
      await expect(card.getByText("Expired: Dec 31, 2025")).toBeVisible();
      await expect(
        card.getByRole("link", { name: "View source" }),
      ).toHaveAttribute("href", "https://example.test/certificate");
      await card.getByRole("heading", { name: "EnergySage profile" }).click();
      await expect(
        card.getByRole("link", { name: "View listing" }),
      ).toHaveAttribute("href", "https://www.energysage.com/supplier/example/");
      if (width === 2560) {
        const cover = await page.locator(".presence-showcase.has-image").boundingBox();
        const about = await page.locator(".about-main").boundingBox();
        const evidence = await card.boundingBox();
        const credential = await card.locator(".credential-entry").first().boundingBox();
        expect(cover!.height).toBeLessThanOrEqual(701);
        expect(evidence!.x).toBeGreaterThan(about!.x + about!.width);
        expect(evidence!.y).toBeCloseTo(about!.y, 0);
        expect(credential!.width).toBeLessThanOrEqual(600);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/credentials-${width}.png`,
        fullPage: true,
      });
    } finally {
      if (companyId)
        await db.query("DELETE FROM companies WHERE id=$1", [companyId]);
      await db.end();
    }
  });

test("company owner can add and edit a sourced credential through the profile", async ({
  page,
}) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  let companyId: string | undefined, userId: string | undefined;
  try {
    const response = await page.request.post("/api/auth/register", {
      data: {
        name: "Credential Editor",
        email: `editor-${suffix}@example.test`,
        password: "CredentialBrowser123!",
        companyName: `Credential Editor ${suffix}`,
      },
    });
    expect(response.status()).toBe(201);
    const session = await response.json();
    companyId = session.activeCompanyId;
    userId = session.user.id;
    await db.query(
      "UPDATE users SET email_verified_at=now(),onboarding_completed_at=now() WHERE id=$1",
      [userId],
    );
    await page.goto(`/company/${companyId}`);
    await page.getByRole("button", { name: "About", exact: true }).click();
    await page
      .locator(".credentials-card")
      .getByRole("button", {
        name: "Add credential or directory listing",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("UL 61730 test documentation");
    await page
      .getByLabel("Issuing organization or directory")
      .fill("Test laboratory");
    await page.getByLabel("Applies to").selectOption("product");
    await page
      .getByLabel("Scope", { exact: true })
      .fill("Test-400 modules only");
    await page
      .getByLabel("Public source URL")
      .fill("https://example.test/model-certificate");
    await page.getByLabel("Expiry, if stated").fill("2027-12-31");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const card = page.locator(".credentials-card");
    await expect(
      card.getByRole("heading", { name: "UL 61730 test documentation" }),
    ).toBeVisible();
    await card
      .getByRole("heading", { name: "UL 61730 test documentation" })
      .click();
    await expect(
      card.getByText("Not independently reviewed", { exact: false }),
    ).toBeVisible();
    await card
      .getByRole("button", { name: "Edit UL 61730 test documentation" })
      .click();
    await expect(page.getByLabel("Expiry, if stated")).toHaveValue(
      "2027-12-31",
    );
    await page
      .getByLabel("Name", { exact: true })
      .fill("Revised UL documentation");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      card.getByRole("heading", { name: "Revised UL documentation" }),
    ).toBeVisible();
  } finally {
    if (companyId)
      await db.query("DELETE FROM companies WHERE id=$1", [companyId]);
    if (userId) await db.query("DELETE FROM users WHERE id=$1", [userId]);
    await db.end();
  }
});
