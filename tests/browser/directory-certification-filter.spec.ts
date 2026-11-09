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
      const certification = page.locator(
        "select.discovery-certification-select",
      );
      await expect(cards).toHaveCount(4);
      await expect(
        certification.locator('optgroup[label="Tesla"]'),
      ).toHaveCount(1);
      await expect(
        certification.locator('option[value="tesla certified installer"]'),
      ).toContainText("Tesla Certified Installer");
      await expect(
        certification.locator("option", {
          hasText: "Expired filter test certificate",
        }),
      ).toHaveCount(0);

      await certification.selectOption("tesla certified installer");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Tesla installer");
      await expect(page).toHaveURL(/certification=tesla\+certified\+installer/);

      await page
        .getByLabel("Services", { exact: true })
        .selectOption("Energy storage");
      await expect(cards).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "No companies match just yet." }),
      ).toBeVisible();
      await page
        .getByLabel("Services", { exact: true })
        .selectOption("Installation");
      await expect(cards).toHaveCount(1);

      await page.reload();
      await expect(certification).toHaveValue("tesla certified installer");
      await expect(cards).toHaveCount(1);
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(certification).toHaveValue("");

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
