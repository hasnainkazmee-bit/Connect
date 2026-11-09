import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

for (const width of [1440, 390, 320])
  test(`directory cards keep a uniform size at ${width}px`, async ({
    page,
  }) => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const marker = `Card density ${randomUUID().slice(0, 8)}`;
    const slug = randomUUID().slice(0, 12);
    const ids: string[] = [];
    try {
      const dense = await db.query<{ id: string }>(
        "INSERT INTO companies(name,slug,username,listing_status,logo_url,tagline,location,service_areas,services) VALUES($1,$2,$2,'unclaimed','/assets/companies/lighthouse-solar.png','Solar installation and storage','Austin, TX',ARRAY['Austin, TX','Round Rock, TX'],ARRAY['Installation','Energy storage']) RETURNING id",
        [`Complete ${marker}`, `complete-${slug}`],
      );
      ids.push(dense.rows[0].id);
      const sparse = await db.query<{ id: string }>(
        "INSERT INTO companies(name,slug,username,listing_status) VALUES($1,$2,$2,'unclaimed') RETURNING id",
        [`New ${marker}`, `new-${slug}`],
      );
      ids.push(sparse.rows[0].id);
      for (let index = 2; index <= 5; index++) {
        const extra = await db.query<{ id: string }>(
          "INSERT INTO companies(name,slug,username,listing_status) VALUES($1,$2,$2,'unclaimed') RETURNING id",
          [`New ${marker} ${index}`, `new-${slug}-${index}`],
        );
        ids.push(extra.rows[0].id);
      }
      await db.query(
        "INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,source_url,evidence_basis) VALUES($1,'certification','NABCEP-certified team','','personnel','Named staff','https://example.test/certificate','company'),($1,'directory','EnergySage profile','EnergySage','company','Public listing','https://example.test/listing','directory')",
        [ids[0]],
      );
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`/directory?q=${encodeURIComponent(marker)}`);
      const complete = page.locator(".discovery-card").filter({
        hasText: `Complete ${marker}`,
      });
      const newCompany = page.locator(".discovery-card").filter({
        has: page.getByRole("heading", { name: `New ${marker}`, exact: true }),
      });
      await expect(page.locator(".discovery-card")).toHaveCount(6);
      await expect(complete).toBeVisible();
      await expect(newCompany).toBeVisible();
      await expect(complete.locator(".discovery-facts")).toHaveCount(1);
      await expect(complete.locator(".discovery-evidence")).toHaveCount(1);
      await expect(newCompany.locator(".company-logo")).toHaveCount(0);
      await expect(newCompany.locator(".discovery-tagline")).toHaveCount(0);
      await expect(newCompany.locator(".discovery-facts")).toHaveCount(0);
      await expect(newCompany.locator(".discovery-evidence")).toHaveCount(0);
      await expect(newCompany).not.toContainText("Location not added");
      const dimensions = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".discovery-card")];
        return cards.map((card) => {
          const footer = card.querySelector(".discovery-card-footer")!;
          const heading = card.querySelector("h2")!;
          return {
            name: card.querySelector("h2")?.textContent?.trim() || "",
            x: card.getBoundingClientRect().x,
            y: card.getBoundingClientRect().y,
            height: card.getBoundingClientRect().height,
            footerBottom: footer.getBoundingClientRect().bottom,
            cardBottom: card.getBoundingClientRect().bottom,
            headingTop: heading.getBoundingClientRect().top,
            cardTop: card.getBoundingClientRect().top,
            scrollHeight: card.scrollHeight,
            clientHeight: card.clientHeight,
          };
        });
      });
      expect(
        Math.max(...dimensions.map((card) => card.height)) -
          Math.min(...dimensions.map((card) => card.height)),
      ).toBeLessThanOrEqual(1);
      for (const card of dimensions) {
        expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight + 1);
        expect(card.cardBottom - card.footerBottom).toBeGreaterThanOrEqual(-1);
        expect(card.cardBottom - card.footerBottom).toBeLessThanOrEqual(2);
      }
      const sparseCard = dimensions.find((card) => card.name === `New ${marker}`)!;
      expect(sparseCard.headingTop - sparseCard.cardTop).toBeGreaterThan(65);
      const columns = new Map<number, typeof dimensions>();
      for (const card of dimensions) {
        const x = Math.round(card.x);
        columns.set(x, [...(columns.get(x) || []), card]);
      }
      expect(columns.size).toBe(width <= 390 ? 1 : 3);
      for (const column of columns.values()) {
        for (let index = 1; index < column.length; index++) {
          const previous = column[index - 1];
          expect(
            column[index].y - previous.y - previous.height,
          ).toBeGreaterThanOrEqual(0);
          expect(
            column[index].y - previous.y - previous.height,
          ).toBeLessThanOrEqual(28);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/directory-card-density-${width}.png`,
        fullPage: true,
      });
      if (width === 1440) {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect
          .poll(() =>
            page
              .locator(".discovery-card")
              .evaluateAll(
                (cards) =>
                  new Set(
                    cards.map((card) =>
                      Math.round(card.getBoundingClientRect().x),
                    ),
                  ).size,
              ),
          )
          .toBe(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    } finally {
      if (ids.length)
        await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
      await db.end();
    }
  });
