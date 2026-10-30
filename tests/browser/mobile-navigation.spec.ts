import { test, expect } from "@playwright/test";

test("phone bottom navigation and deliberate swipes preserve form gestures", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.request.post("/api/auth/register", {
    data: {
      name: "Mobile Owner",
      email: `navigation-${Date.now()}@example.test`,
      password: "ConnectNavigation123!",
      companyName: "Mobile Studio",
    },
  });
  const page = await context.newPage();
  await page.goto("/directory");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const bounds = await nav.boundingBox();
  expect(bounds!.y).toBeGreaterThan(760);
  expect(bounds!.height).toBeLessThan(85);
  const swipe = async (
    locator: ReturnType<typeof page.locator>,
    dx: number,
    dy = 0,
  ) => {
    await locator.dispatchEvent("touchstart", {
      touches: [{ identifier: 1, clientX: 195, clientY: 330 }],
    });
    await locator.dispatchEvent("touchend", {
      changedTouches: [{ identifier: 1, clientX: 195 + dx, clientY: 330 + dy }],
    });
  };
  await swipe(page.getByLabel("Search directory"), -140);
  await expect(page).toHaveURL(/\/directory$/);
  await swipe(page.locator("main"), -140, 210);
  await expect(page).toHaveURL(/\/directory$/);
  await swipe(page.locator("main"), -140);
  await expect(page).toHaveURL(/\/network\/connections$/);
  await swipe(page.locator("main"), 140);
  await expect(page).toHaveURL(/\/directory$/);
  await nav.getByRole("link", { name: "Messages", exact: true }).click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(
    page.getByRole("textbox", { name: "Search companies" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-bottom-navigation.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
