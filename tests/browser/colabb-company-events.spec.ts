import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import pg from "pg";

let db: pg.Pool;
const id = randomUUID(),
  slug = "event-ui-" + id.slice(0, 8),
  event = "event-ui-" + id.slice(0, 8);
test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.pathname).toMatch(/_test$/);
  db = new pg.Pool({ connectionString: url.href });
  await db.query(
    "INSERT INTO companies(id,slug,username,name,type,website,description,tagline,services,location,listing_status) VALUES($1,$2,$2,'Event Test Solar','Manufacturer','https://example.test','Solar mounting equipment for commercial rooftop and ground-mounted installations. The company manufactures racking, attachments and module clamps for solar installation teams.','Solar mounting equipment',ARRAY['Solar racking','Roof attachments'],'Cleveland, OH','unclaimed')",
    [id, slug],
  );
  await db.query(
    "INSERT INTO industry_events(key,name,year,website,logo_path) VALUES($1,'RE+',2026,'https://re-plus.com/','/brand/events/replus.png')",
    [event],
  );
  await db.query(
    "INSERT INTO company_event_participations(company_id,event_key,participation,source_url,source_reference,identity_note,checked_at,batch_id) VALUES($1,$2,'exhibitor','https://docs.google.com/private-sheet','Row 2','Exact company and domain identity match.',now(),'ui-test')",
    [id, event],
  );
});
test.afterAll(async () => {
  await db?.query("DELETE FROM companies WHERE id=$1", [id]);
  await db?.query("DELETE FROM industry_events WHERE key=$1", [event]);
  await db?.end();
});

test("event badge appears on cards and profile without exposing internal source", async ({
  page,
}, testInfo) => {
  await page.goto("/providers?q=Event%20Test%20Solar&sample=false");
  const card = page
    .locator(".cd-company")
    .filter({ hasText: "Event Test Solar" });
  await expect(card.getByText("Attended", { exact: false })).toContainText(
    "RE+ 2026",
  );
  await expect(card.locator(".company-event img")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("directory-events.png"),
    fullPage: true,
  });
  await card
    .getByRole("heading", { name: "Event Test Solar" })
    .getByRole("link")
    .click();
  await expect(page.locator(".company-events")).toContainText(
    "Attended RE+ 2026",
  );
  await expect(page.locator(".company-events")).toContainText("Exhibitor");
  const link = page.locator(".company-event");
  await expect(link).toHaveAttribute("href", "https://re-plus.com/");
  expect(await page.locator('a[href*="private-sheet"]').count()).toBe(0);
  expect(
    await link
      .locator("img")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("profile-events.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(link).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("profile-events-mobile.png"),
    fullPage: true,
  });
});
