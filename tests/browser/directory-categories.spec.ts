import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("every directory business category is visible and filters its listings", async ({
  page,
}) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const types = ["Contractor", "Developer", "Distributor", "Service provider"];
  const ids: string[] = [];
  try {
    for (const [index, type] of types.entries()) {
      const username = `category-check-${suffix}-${index}`;
      const result = await db.query<{ id: string }>(
        "INSERT INTO companies(name,slug,username,type,description,listing_status) VALUES($1,$2,$2,$3,'A company used to verify directory category filtering.','unclaimed') RETURNING id",
        [`Directory Category ${suffix} ${index}`, username, type],
      );
      ids.push(result.rows[0].id);
    }
    await page.goto(`/directory?q=Directory%20Category%20${suffix}`);
    const categories = page.getByRole("navigation", {
      name: "Business categories",
    });
    const labels = [
      "All companies",
      "Installers",
      "EPCs",
      "Manufacturers",
      "Contractors",
      "Developers",
      "Distributors",
      "Service providers",
    ];
    await expect(categories.getByRole("button")).toHaveCount(labels.length);
    for (const label of labels)
      await expect(
        categories.getByRole("button", {
          name: new RegExp(`^${label}(?:\\s|$)`),
        }),
      ).toBeVisible();

    for (const [label, type] of [
      ["Contractors", "Contractor"],
      ["Developers", "Developer"],
      ["Distributors", "Distributor"],
      ["Service providers", "Service provider"],
    ]) {
      const button = categories.getByRole("button", {
        name: new RegExp(`^${label}(?:\\s|$)`),
      });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      expect(new URL(page.url()).searchParams.get("type")).toBe(type);
      await expect(
        page.locator(".discovery-card .discovery-type").first(),
      ).toHaveText(type);
    }
  } finally {
    if (ids.length)
      await db.query("DELETE FROM companies WHERE id = ANY($1::uuid[])", [ids]);
    await db.end();
  }
});
