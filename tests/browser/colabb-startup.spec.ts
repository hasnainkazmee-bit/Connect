import { expect, test } from "@playwright/test";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test.describe("Colabb document startup", () => {
  test.beforeAll(async ({ baseURL }) => {
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
  });

  for (const width of [1440, 390, 320]) {
    test(`shows the brand before JavaScript and opens the ready page at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
      const bundle = deferred();
      await page.route(/\/assets\/.*\.js(?:\?|$)/, async (route) => {
        await bundle.promise;
        await route.continue();
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto("/", { waitUntil: "commit" });
      expect(response!.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
      await expect(page.locator("#colabb-startup")).toBeVisible();
      await expect(page.locator("#root")).toHaveAttribute("inert", "");
      await expect(page.locator("#colabb-startup img")).toHaveJSProperty("complete", true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`startup-${width}.png`), animations: "disabled" });
      bundle.resolve();
      await expect(page.locator("#colabb-startup")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /No one builds solar alone/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
      expect(errors).toEqual([]);
      await page.screenshot({ path: info.outputPath(`ready-${width}.png`), animations: "disabled" });
      // A normal refresh uses the same readiness handoff, without a minimum display time.
      await page.reload();
      await expect(page.locator("#colabb-startup")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    });
  }

  test("waits for the session but lets people navigate while providers load, and respects reduced motion", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const session = deferred(), providers = deferred(), providerRequested = deferred();
    await page.route("**/api/session", async (route) => { await session.promise; await route.continue(); });
    await page.route(/\/api\/jobs\/providers(?:\?|$)/, async (route) => {
      providerRequested.resolve();
      await providers.promise;
      await route.continue();
    });
    await page.goto("/providers");
    await expect(page.locator("#colabb-startup")).toBeVisible();
    await expect(page.locator(".colabb-startup-placeholder")).toBeAttached();
    expect(await page.locator("#colabb-startup .colabb-startup-left").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await page.locator("#colabb-startup").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
    await page.screenshot({ path: info.outputPath("session-delayed-reduced-motion.png") });
    session.resolve();
    await providerRequested.promise;
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    providers.resolve();
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    await expect(page.locator(".cd-company").first()).toBeVisible();
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  });

  test("a failed route download preserves navigation and offers explicit recovery", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    await page.route(/\/assets\/companies-[^/]+\.js(?:\?|$)/, route => route.abort("failed"));
    await page.getByRole("navigation", {name:"Main navigation"}).getByRole("link", {name:"Companies",exact:true}).click();
    await expect(page.getByRole("alert")).toContainText("This page couldn’t open.");
    await expect(page.getByRole("button", {name:"Refresh to try again"})).toBeVisible();
    await page.getByRole("link", {name:"Colabb home"}).click();
    await expect(page.getByRole("heading", {name:/No one builds solar alone/})).toBeVisible();
  });

  test("a failed bundle restores the public page and an actionable recovery link", async ({ page }) => {
    await page.route(/\/assets\/.*\.js(?:\?|$)/, (route) => route.abort("failed"));
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Colabb couldn’t finish opening.");
    await expect(page.getByRole("link", { name: "Refresh to try again" })).toHaveAttribute("href", "");
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /No one builds solar alone/ })).toBeVisible();
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  });

  test("a stalled bundle reveals public content after the recovery deadline and can finish later", async ({ page }) => {
    const bundle = deferred();
    await page.clock.install();
    await page.route(/\/assets\/.*\.js(?:\?|$)/, async (route) => { await bundle.promise; await route.continue(); });
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("#colabb-startup")).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    await page.clock.runFor(12250);
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /No one builds solar alone/ })).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();
    const session = page.waitForResponse((response) => response.url().endsWith("/api/session"));
    bundle.resolve();
    await session;
    await page.clock.resume();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  });

  test("an interrupted startup preserves React ownership and can recover when the session arrives", async ({ page }) => {
    const session = deferred();
    await page.route("**/api/session", async (route) => { await session.promise; await route.continue(); });
    await page.goto("/");
    await expect(page.locator(".colabb-startup-placeholder")).toBeAttached();
    const preserved = await page.evaluate(() => {
      const placeholder = document.querySelector(".colabb-startup-placeholder");
      // Unrelated browser/extension errors must not dismiss the startup screen.
      dispatchEvent(new ErrorEvent("error", { filename: "chrome-extension://example/content.js", message: "Unrelated failure" }));
      const stillOpening = !document.querySelector("#colabb-startup")?.classList.contains("is-leaving");
      (window as typeof window & { colabbStartup: { fail(): void } }).colabbStartup.fail();
      return stillOpening && document.querySelector(".colabb-startup-placeholder") === placeholder;
    });
    expect(preserved).toBe(true);
    await expect(page.locator("#root .colabb-startup-recovery")).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    session.resolve();
    await expect(page.getByRole("heading", { name: /No one builds solar alone/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("public content remains usable without JavaScript and Connect has no Colabb startup", async ({ browser, baseURL, request }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await expect(page.locator("#colabb-startup")).toBeHidden();
      await expect(page.getByRole("heading", { name: /No one builds solar alone/ })).toBeVisible();
      await expect(page.getByRole("link", { name: "Post a job", exact: true }).first()).toBeVisible();
    } finally { await context.close(); }
    const connect = await request.get("/_interface/connect");
    expect(connect.ok()).toBe(true);
    expect(await connect.text()).not.toContain('id="colabb-startup"');
  });
});
