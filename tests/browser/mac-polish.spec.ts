import { test, expect } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`directory search keeps its capsule shape in Mac ${colorScheme} appearance`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: process.env.API_TEST_URL || "http://localhost:4101",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 ConnectMac/0.1.2",
      viewport: { width: 1180, height: 850 },
      colorScheme,
    });
    await context.addInitScript(() => {
      (window as any).webkit = {
        messageHandlers: { connectMac: { postMessage() {} } },
      };
    });
    const page = await context.newPage();
    await page.goto("/directory");
    await expect(page.locator(".mac-app")).toBeVisible();
    const button = page.locator(".discovery-search > .button.primary");
    await expect(button).toHaveText("Find companies");
    await expect(button).toHaveCSS("border-radius", "999px");
    await expect(button).toHaveCSS("background-color", "rgb(255, 107, 11)");
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(32);
    expect(bounds.width).toBeGreaterThan(120);
    await page.screenshot({
      path: `test-results/mac-find-companies-${colorScheme}.png`,
    });
    await context.close();
  });
}

test("directory search retains its existing browser capsule", async ({
  page,
}) => {
  await page.goto("/directory");
  await expect(page.locator(".site-header")).toBeVisible();
  const button = page.locator(".discovery-search > .button.primary");
  const before = await button.evaluate((element) => ({
    radius: getComputedStyle(element).borderRadius,
    height: element.getBoundingClientRect().height,
  }));
  expect(before.radius).toBe("999px");
  expect(before.height).toBeGreaterThanOrEqual(40);
});
