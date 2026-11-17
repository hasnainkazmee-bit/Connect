import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

const companyIds: string[] = [];
const userIds: string[] = [];
let db: pg.Pool;

test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.pathname).toMatch(/_test$/);
  db = new pg.Pool({ connectionString: url.href });
});

test.afterAll(async () => {
  if (companyIds.length)
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companyIds,
    ]);
  if (userIds.length)
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
  await db.end();
});

for (const width of [1440, 390]) {
  test(`Company logo and cover upload, crop, preview, and persist at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const suffix = randomUUID();
    const response = await request.post("/api/auth/register", {
      data: {
        name: "Profile Photo Tester",
        email: suffix + "@example.test",
        password: "ProfilePhotoTest123!",
        companyName: "Photo test " + suffix,
        type: "Technology provider",
      },
    });
    expect(response.status()).toBe(201);
    const session = await response.json();
    companyIds.push(session.activeCompanyId);
    userIds.push(session.user.id);
    await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      session.user.id,
    ]);
    expect(
      (
        await request.post("/api/onboarding/complete", {
          data: { followIds: [] },
        })
      ).ok(),
    ).toBeTruthy();
    await page.context().addCookies((await request.storageState()).cookies);

    for (const slot of ["logo", "cover"] as const) {
      await page.goto("/settings/profile/photos");
      await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
      const changePhoto = page.getByRole("button", {
        name: slot === "logo" ? "Change logo" : "Change cover photo",
        exact: true,
      });
      await changePhoto.click();
      await page
        .locator(".brand-photo-editor input[type=file]")
        .setInputFiles(
          slot === "logo"
            ? "apps/colabb/public/assets/companies/lighthouse-solar.png"
            : "apps/colabb/public/assets/solar.jpg",
        );
      await expect(
        page.getByRole("heading", {
          name: slot === "logo" ? "Adjust company logo" : "Adjust cover photo",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const zoom = page.getByRole("slider", { name: "Photo zoom" });
      await zoom.focus();
      await page.keyboard.press("Home");
      for (let step = 0; step < 20; step++)
        await page.keyboard.press("ArrowRight");
      await expect(zoom).toHaveValue("1.2");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(zoom).toHaveValue("1");
      await zoom.focus();
      for (let step = 0; step < 20; step++)
        await page.keyboard.press("ArrowRight");
      await page
        .getByRole("group", { name: "Photo position", exact: true })
        .focus();
      await page.keyboard.press("ArrowRight");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`${slot}-crop-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page
        .getByRole("button", { name: "Use photo", exact: true })
        .click();

      const preview = page.locator(".branding-preview");
      await expect(preview).toBeVisible();
      await expect(
        preview.getByText("Choose a different photo", { exact: true }),
      ).toBeVisible();
      // A portrait image previously overflowed the fixed preview and hid the
      // change-photo control. Both image and caption must fit inside the button.
      const bounds = await preview.evaluate((button) => {
        const outer = button.getBoundingClientRect();
        return [...button.querySelectorAll("img, span")].map((child) => {
          const inner = child.getBoundingClientRect();
          return {
            top: inner.top - outer.top,
            bottom: outer.bottom - inner.bottom,
            left: inner.left - outer.left,
            right: outer.right - inner.right,
          };
        });
      });
      expect(bounds).toHaveLength(2);
      for (const child of bounds)
        for (const distance of Object.values(child))
          expect(distance).toBeGreaterThanOrEqual(-1);
      await page.screenshot({
        path: info.outputPath(`${slot}-preview-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/companies/current/branding") &&
          r.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "Save photo", exact: true })
        .click();
      expect((await saved).status()).toBe(200);
      await expect(changePhoto).toBeVisible();
      await page.reload();
      await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
      const image = page.getByAltText(
        slot === "logo" ? "Current company logo" : "Current company cover",
        { exact: true },
      );
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const asset = await page.request.get((await image.getAttribute("src"))!);
      expect(asset.status()).toBe(200);
      expect(asset.headers()["content-type"]).toMatch(/^image\/(png|jpeg)/);
      expect((await asset.body()).length).toBeGreaterThan(1000);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  });
}
