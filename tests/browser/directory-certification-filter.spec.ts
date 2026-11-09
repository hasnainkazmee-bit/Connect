import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

for (const width of [1440, 390])
  test(`directory certification filter combines with existing filters at ${width}px`, async ({
    page,
    request,
  }) => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const suffix = randomUUID().slice(0, 8);
    const marker = `Credential filter ${suffix}`;
    const ids: string[] = [];
    try {
      for (const [index, [name, type, service]] of [
        ["Tesla installer", "Installer", "Installation"],
        ["Enphase installer", "Installer", "Energy storage"],
        ["Expired credential", "Installer", "Installation"],
        ["Directory listing only", "Manufacturer", "Equipment supply"],
      ].entries()) {
        const result = await db.query<{ id: string }>(
          "INSERT INTO companies(name,slug,username,type,services,listing_status) VALUES($1,$2,$2,$3,ARRAY[$4],'unclaimed') RETURNING id",
          [`${name} ${marker}`, `credential-${suffix}-${index}`, type, service],
        );
        ids.push(result.rows[0].id);
      }
      await db.query(
        `INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,source_url,evidence_basis,valid_until)
         VALUES ($1,'qualification','Tesla Certified Installer','Tesla','personnel','Current installer team','https://example.test/tesla','company',NULL),
                ($2,'qualification','Enphase Platinum Installer','Enphase','personnel','Current installer team','https://example.test/enphase','company',NULL),
                ($3,'certification','Expired filter test certificate','Test issuer','company','No longer valid','https://example.test/expired','issuer',CURRENT_DATE-1),
                ($4,'directory','Tesla Certified Installer','Tesla','company','Directory listing, not a credential','https://example.test/listing','directory',NULL)`,
        ids,
      );

      await page.setViewportSize({ width, height: 950 });
      await page.goto(`/directory?q=${encodeURIComponent(marker)}`);
      const cards = page.locator(".discovery-card");
      const certification = page.getByRole("button", {
        name: "Certifications and qualifications",
      });
      await expect(cards).toHaveCount(4);
      await certification.click();
      const options = page.locator(".discovery-certification-menu");
      await expect(options.getByText("Tesla", { exact: true })).toBeVisible();
      await expect(
        options.getByText("Expired filter test certificate"),
      ).toHaveCount(0);
      await options.getByLabel(/Tesla Certified Installer/).click();
      await expect(
        options.getByLabel(/Tesla Certified Installer/),
      ).toBeChecked();
      await options.getByLabel(/Enphase Platinum Installer/).click();
      await expect(
        options.getByLabel(/Enphase Platinum Installer/),
      ).toBeChecked();
      await expect(cards).toHaveCount(2);
      await expect(cards.first()).toContainText(
        /Tesla installer|Enphase installer/,
      );
      await expect(page).toHaveURL(/certification=tesla\+certified\+installer/);
      await expect(page).toHaveURL(
        /certification=enphase\+platinum\+installer/,
      );
      await expect(certification).toContainText("2 certifications");

      await page
        .getByLabel("Services", { exact: true })
        .selectOption("Energy storage");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Enphase installer");
      await page
        .getByLabel("Services", { exact: true })
        .selectOption("Installation");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Tesla installer");

      await page.reload();
      await expect(certification).toContainText("2 certifications");
      await expect(cards).toHaveCount(1);
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(certification).toContainText("Any certification");

      const response = await request.get(
        `/api/companies?q=${encodeURIComponent(marker)}&certification=${encodeURIComponent("expired filter test certificate")}`,
      );
      expect(response.ok()).toBe(true);
      expect((await response.json()).total).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      if (ids.length)
        await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
      await db.end();
    }
  });
