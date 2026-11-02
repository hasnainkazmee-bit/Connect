import { test, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";

for (const width of [1440, 390])
  test(`directory discovery and claiming retain one profile at ${width}px`, async ({
    page,
    request,
  }) => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const suffix = randomUUID().slice(0, 8),
      username = "claim-ui-" + suffix,
      name = "Directory UI " + suffix,
      email = "owner@" + suffix + ".example.test",
      password = "DirectoryBrowser123!";
    let companyId: string | undefined, userId: string | undefined;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      const c = (
        await db.query(
          "INSERT INTO companies(name,slug,username,type,location,service_areas,services,listing_status,website,description,logo_url,cover_url,source_url,source_checked_at) VALUES($1,$2,$2,'Installer','Austin, TX','{\"Austin, TX\"}','{Installation}','unclaimed','https://official.example.test','We install solar systems for homes and businesses in Austin.','/assets/companies/lighthouse-solar.png','','https://official.example.test',now()) RETURNING id",
          [name, username],
        )
      ).rows[0];
      companyId = c.id;
      await db.query(
        "INSERT INTO company_claim_domains(company_id,domain,source_url) VALUES($1,$2,'https://official.example.test')",
        [c.id, suffix + ".example.test"],
      );
      const registered = await request.post("/api/auth/register", {
        data: { name: "Company Owner", email, password },
      });
      expect(registered.status()).toBe(201);
      userId = (await registered.json()).user.id;
      await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
        userId,
      ]);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
      await page.goto("/");
      await expect(
        page.getByRole("heading", {
          name: "Find the right company. Bring your next project to life.",
        }),
      ).toBeVisible();
      await page.getByLabel("Search directory").fill(name);
      await page.getByLabel("Service area", { exact: true }).fill("Austin");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.locator(".discovery-card")).toHaveCount(1);
      await page.locator(".discovery-card").getByRole("link").click();
      await expect(
        page.getByRole("heading", { name: "About " + name }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Visit website", exact: true }),
      ).toHaveAttribute("href", "https://official.example.test");
      await expect(
        page.getByRole("button", { name: "Connect", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("link", { name: "Claim this profile", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp("/claim/" + username));
      await page
        .locator(".claim-content")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await page.getByLabel("Work email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page
        .locator(".claim-content")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "You’re in the right place." }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByLabel("Your role at " + name).fill("Owner");
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Claim company profile", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "You’re part of " + name + "." }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Manage company profile" })
        .click();
      await expect(
        page.getByRole("button", { name: "Edit profile", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Edit profile", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: /^Headline/ })
        .fill("Solar projects managed by our Austin team");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const publicListing = await request.get(
        "/api/companies?q=" + encodeURIComponent(name),
      );
      const result = await publicListing.json();
      expect(result.total).toBe(1);
      expect(result.companies[0].id).toBe(c.id);
      expect(result.companies[0].tagline).toBe(
        "Solar projects managed by our Austin team",
      );
      await page.goto("/directory?q=" + encodeURIComponent(name));
      await expect(page.locator(".discovery-card")).toContainText(
        "Solar projects managed by our Austin team",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/directory-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      if (companyId)
        await db.query("DELETE FROM companies WHERE id=$1", [companyId]);
      if (userId) await db.query("DELETE FROM users WHERE id=$1", [userId]);
      await db.end();
    }
  });

test("public directory and profiles are readable with JavaScript disabled", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
  });
  const page = await context.newPage();
  await page.goto("/directory?type=Manufacturer");
  await page.getByRole("link", { name: /First Solar/ }).click();
  await expect(
    page.getByRole("heading", { name: "About First Solar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Claim this profile" }),
  ).toBeVisible();
  await context.close();
});
