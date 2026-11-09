import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

for (const width of [1440, 390])
  test(`directory cards show credentials and listings in the company detail style at ${width}px`, async ({
    page,
  }) => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const marker = `Card credentials ${randomUUID().slice(0, 8)}`;
    const ids: string[] = [];
    try {
      for (const prefix of ["Z Certified", "A Listed"])
        ids.push(
          (
            await db.query(
              "INSERT INTO companies(name,slug,username,listing_status,logo_url) VALUES($1,$2,$2,'unclaimed',$3) RETURNING id",
              [
                `${prefix} ${marker}`,
                `card-${randomUUID().slice(0, 12)}`,
                prefix === "A Listed"
                  ? "/assets/companies/lighthouse-solar.png"
                  : "",
              ],
            )
          ).rows[0].id,
        );
      await db.query(
        "INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,source_url,evidence_basis) VALUES($1,'certification','UL 61730','','product','Example-400 model only','https://example.test/ul','issuer'),($1,'qualification','NABCEP professionals','','personnel','Named professionals only','https://example.test/nabcep','company'),($1,'certification','A long certification title for checking narrow directory cards','','company','Named entity','https://example.test/long','company'),($2,'directory','EnergySage profile','EnergySage','company','Public listing only','https://example.test/listing','directory')",
        ids,
      );
      await db.query(
        "INSERT INTO company_credentials(company_id,category,title,scope,scope_detail,source_url,evidence_basis,valid_until) VALUES($1,'certification','Expired certification','company','Old certificate','https://example.test/expired','issuer',CURRENT_DATE-1)",
        [ids[1]],
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/directory?q=${encodeURIComponent(marker)}`);
      const cards = page.locator(".discovery-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.first()).toContainText("Z Certified");
      await expect(cards.first().locator(".discovery-certificate")).toHaveCount(
        1,
      );
      await expect(
        cards.first().locator(".discovery-certificate").first(),
      ).toContainText("UL 61730");
      await expect(
        cards.first().locator(".discovery-certificate").first(),
      ).toHaveAttribute("title", "UL 61730");
      await expect(
        cards.first().locator(".discovery-certificate-more"),
      ).toHaveText("+2");
      await expect(
        cards.last().locator(".discovery-certifications"),
      ).toHaveCount(0);
      await expect(
        cards.last().locator(".discovery-directory-profiles"),
      ).toContainText("EnergySage");
      await expect(
        cards.last().locator(".discovery-directory-name"),
      ).toHaveText("EnergySage");
      await expect(
        cards.last().locator(".discovery-directory-name"),
      ).toHaveAttribute("title", /Public listing only/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/directory-certifications-${width}.png`,
        fullPage: true,
      });
      await cards.first().click();
      await expect(
        page
          .locator(".credentials-card")
          .getByRole("link", { name: "UL 61730 — view source" }),
      ).toBeVisible();
      await page.goto(`/directory?q=${encodeURIComponent(marker)}`);
      await page.locator(".discovery-card").last().click();
      await expect(
        page
          .locator(".credentials-card")
          .getByRole("heading", { name: "EnergySage profile" }),
      ).toBeVisible();
    } finally {
      if (ids.length)
        await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
      await db.end();
    }
  });
