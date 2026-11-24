import { test, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";

// This is the live Colabb provider experience. The retired directory/social
// selectors remain in adaptive-layout.spec.ts for the explicit legacy suite.
const windows = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1221, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 844, height: 390 },
];
const suffix = randomUUID().slice(0, 8);
const query = `Colabb adaptive ${suffix}`;
const names = [`${query} Electrical`, `${query} Installation`];
const credentialNames = [`QA ${suffix} Company credential`, `QA ${suffix} Personnel qualification`];
const companyIds: string[] = [];
let userId: string | undefined;
let db: pg.Pool;

test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL || "postgres://invalid");
  if (!database.pathname.endsWith("_test")) throw Error("Use an isolated test database.");
  db = new pg.Pool({ connectionString: database.href });
  for (let i = 0; i < 2; i++) {
    const result = await db.query<{ id: string }>(
      `INSERT INTO companies(name,slug,username,type,location,description,services,service_areas,listing_status)
       VALUES($1,$2,$2,$3,$4,'A synthetic local fixture for Colabb responsive company discovery.',ARRAY['Electrical'],ARRAY[$5],$6) RETURNING id`,
      [names[i], `colabb-adaptive-${suffix}-${i}`, i ? "Contractor" : "Installer", i ? "Columbus, OH" : "Austin, TX", i ? "Ohio" : "Texas", i ? "unclaimed" : "managed"],
    );
    companyIds.push(result.rows[0].id);
    await db.query("INSERT INTO provider_profiles(company_id,trades) VALUES($1,ARRAY['Electrical'])", [result.rows[0].id]);
    await db.query(
      `INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,source_url,evidence_basis,checked_at)
       VALUES($1,$2,$3,'Local QA fixture',$4,'Synthetic test evidence only.','https://example.test/local-qa','company',now())`,
      [result.rows[0].id, i ? "qualification" : "certification", credentialNames[i], i ? "personnel" : "company"],
    );
  }
  userId = (await db.query<{ id: string }>(
    "INSERT INTO users(name,email,password_hash,email_verified_at) VALUES('Local fixture owner',$1,'not-a-login',now()) RETURNING id",
    [`adaptive-${suffix}@example.test`],
  )).rows[0].id;
  await db.query("INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')", [userId, companyIds[0]]);
});

test.afterAll(async () => {
  if (!db) return;
  if (companyIds.length) await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [companyIds]);
  if (userId) await db.query("DELETE FROM users WHERE id=$1", [userId]);
  await db.end();
});

for (const viewport of windows) {
  test(`Colabb company discovery and filters at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize(viewport);
    const badgeRequests: string[] = [];
    await page.route("**/brand/badges/on-colabb.svg", route => {
      badgeRequests.push(route.request().url());
      return route.abort();
    });
    // The supported selector route makes the chosen interface explicit even
    // when the environment defaults to the preserved Connect frontend.
    await page.context().request.get("/_interface/colabb");
    await page.goto("/directory");
    await expect(page).toHaveURL(/\/providers$/);
    await expect(page.getByRole("heading", { name: "Find a company for the work." })).toBeVisible();
    // Text can already exist behind the startup cover. Wait for its real
    // interactive handoff before fill(), which can write to an inert input.
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
    await page.getByRole("searchbox", { name: "Company or service" }).fill(query);
    await page.getByRole("search").getByRole("button", { name: /Search/ }).click();
    await expect(page.getByRole("heading", { name: "2 companies", exact: true })).toBeVisible();
    const cards = page.locator(".cd-company:not(.market-skeleton)");
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: names[0] }).locator(".cd-identity")).toHaveText("On Colabb");
    await expect(cards.filter({ hasText: names[0] }).locator(".cd-identity svg")).toBeVisible();
    expect(badgeRequests).toEqual([]);
    await expect(cards.filter({ hasText: names[1] }).locator(".cd-identity")).toHaveText("Public listing");
    await expect(cards.filter({ hasText: names[1] }).getByText("Personnel qualification", { exact: true })).toBeVisible();
    if ([320, 1920].includes(viewport.width)) {
      await page.screenshot({ path: testInfo.outputPath(`companies-${viewport.width}.png`), fullPage: true });
    }

    const service = page.getByRole("navigation", { name: "Filter by service" }).getByRole("button", { name: "Electrical work", exact: true });
    await service.click();
    await expect(service).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(2);
    const filters = page.getByRole("complementary", { name: "Company filters" });
    const toggle = filters.getByRole("button", { name: "Filters", exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await expect(page.getByLabel("Company type", { exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
      const search = document.querySelector(".cd-search-form>.cd-button")!;
      const selected = document.querySelector('.cd-services>button[aria-pressed="true"]')!;
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        header: rect(".mk-header-inner"),
        content: rect(".cd-page"),
        search: rect(".cd-search-form>.cd-button"),
        searchColor: getComputedStyle(search).backgroundColor,
        selectedColor: getComputedStyle(selected, ":after").backgroundColor,
        controls: [".cd-search-field input", ".cd-filter-panel select", ".cd-certifications summary"].map(selector => ({ selector, ...rect(selector) })),
        icons: Array.from(document.querySelectorAll(".cd-page svg")).map(element => element.getBoundingClientRect().width),
        cards: Array.from(document.querySelectorAll(".cd-company:not(.market-skeleton)")).map(element => element.getBoundingClientRect().toJSON()),
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.search.height).toBeGreaterThanOrEqual(44);
    expect(geometry.searchColor).toBe("rgb(255, 106, 0)");
    expect(geometry.selectedColor).toBe(geometry.searchColor);
    for (const control of geometry.controls) {
      expect(control.height, control.selector).toBeGreaterThanOrEqual(44);
      expect(control.width, control.selector).toBeGreaterThanOrEqual(100);
    }
    for (const width of geometry.icons) expect(width).toBeLessThanOrEqual(30);
    const contentFraction = viewport.width > 1200 ? 0.8 : 0.9;
    expect(geometry.content.width).toBeCloseTo(viewport.width * contentFraction, 0);
    expect(geometry.header.left).toBeCloseTo(geometry.content.left, 0);
    if (viewport.width >= 1800) {
      // Wide-screen cards share a row and align even when their data differs.
      expect(geometry.cards[0].top).toBeCloseTo(geometry.cards[1].top, 0);
      expect(geometry.cards[0].height).toBeCloseTo(geometry.cards[1].height, 0);
    } else {
      expect(geometry.cards[1].top).toBeGreaterThanOrEqual(geometry.cards[0].bottom);
    }

    // Participation, type and geography all filter the real paginated endpoint.
    await filters.getByRole("button", { name: "On Colabb", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(names[0]);
    await filters.getByRole("button", { name: "All companies", exact: true }).click();
    await expect(cards).toHaveCount(2);
    await page.getByLabel("Company type", { exact: true }).selectOption("Contractor");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(names[1]);
    await page.getByLabel("Company type", { exact: true }).selectOption("");
    await expect(cards).toHaveCount(2);
    await page.getByLabel("City, state or service area", { exact: false }).fill("Austin");
    await filters.getByRole("button", { name: "Apply location", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(names[0]);
    await page.getByLabel("City, state or service area", { exact: false }).fill("");
    await filters.getByRole("button", { name: "Apply location", exact: true }).click();
    await expect(cards).toHaveCount(2);

    // Certifications are multi-select OR, with personnel scope still visible.
    await filters.locator(".cd-certifications summary").click();
    const firstCredential = filters.getByRole("checkbox", { name: new RegExp(credentialNames[0]) });
    await firstCredential.click();
    await expect(firstCredential).toBeChecked();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(names[0]);
    const secondCredential = filters.getByRole("checkbox", { name: new RegExp(credentialNames[1]) });
    await secondCredential.click();
    await expect(secondCredential).toBeChecked();
    await expect(cards).toHaveCount(2);
    await expect(filters.locator(".cd-certifications summary")).toContainText("2 selected");
    await expect(filters.locator("label").filter({ hasText: credentialNames[1] }).getByText("Qualified personnel", { exact: true })).toBeVisible();
    await filters.getByRole("button", { name: "Clear certifications", exact: true }).click();
    await expect(cards).toHaveCount(2);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
