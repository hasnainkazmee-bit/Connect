import { test, expect, type Browser, type Page } from "@playwright/test";

const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
const windowsUA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36 ConnectWindows/0.1";

async function contextFor(
  browser: Browser,
  { bridge = true, hostUA = true, popup = false, width = 1180 } = {},
) {
  const context = await browser.newContext({
    baseURL,
    userAgent: hostUA ? windowsUA : undefined,
    viewport: { width, height: 850 },
  });
  await context.addInitScript(
    ({ bridge, popup }) => {
      const host = window as any;
      host.windowsStates = [];
      if (bridge) {
        host.chrome ||= {};
        host.chrome.webview = {
          postMessage(value: unknown) {
            host.windowsStates.push(value);
          },
        };
      }
      if (popup) host.opener = {};
    },
    { bridge, popup },
  );
  return context;
}
async function command(page: Page, detail: object, platform = "windows") {
  await page.evaluate(
    ({ detail, platform }) =>
      window.dispatchEvent(
        new CustomEvent(`connect:${platform}-command`, { detail }),
      ),
    { detail, platform },
  );
}
async function state(page: Page) {
  return page.evaluate(() => (window as any).windowsStates.at(-1));
}
async function closeDialog(page: Page) {
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
}

for (const signals of [
  { bridge: false, hostUA: true, popup: false },
  { bridge: true, hostUA: false, popup: false },
  { bridge: true, hostUA: true, popup: true },
]) {
  test(`Windows content requires matching UA, bridge and main window: ${JSON.stringify(signals)}`, async ({
    browser,
  }) => {
    const context = await contextFor(browser, signals);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/directory");
    await expect(page.locator(".site-header")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(
      /connect-desktop|connect-windows|connect-mac/,
    );
    await expect(page.locator(".discovery-card").first()).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await command(page, { type: "compose" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).windowsStates)).toEqual(
      [],
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".account-wordmark")).toBeVisible();
    await context.close();
  });
}

test("Windows guest commands use real routes and authentication without Mac identity or private state", async ({
  browser,
}) => {
  const context = await contextFor(browser);
  const page = await context.newPage();
  await page.goto("/directory");
  await expect(page.locator(".desktop-app.windows-app")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/connect-desktop/);
  await expect(page.locator("html")).not.toHaveClass(/connect-mac/);
  await expect(
    page.locator(".site-header, .site-footer, .mac-app"),
  ).toHaveCount(0);
  await command(page, { type: "account" }, "mac");
  await command(page, { type: "navigate", path: "https://example.test/" });
  await command(page, { type: "navigate", path: "/account" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/directory$/);
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole("dialog").getByLabel("Work email")).toBeVisible();
  await command(page, { type: "navigate", path: "/network" });
  await expect(page).toHaveURL(/\/network$/);
  await closeDialog(page);
  await expect(
    page.getByRole("button", { name: "Sign in to continue", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/messages$/);
  await command(page, { type: "notifications" });
  await expect(page.getByRole("dialog").getByLabel("Work email")).toBeVisible();
  await command(page, { type: "state" });
  expect(await state(page)).toEqual({
    type: "state",
    ready: true,
    path: "/messages",
    signedIn: false,
    accountType: "",
    userName: "",
    companyName: "",
    canPublish: false,
    unreadCount: 0,
  });
  await context.close();
});

for (const intent of ["compose", "notifications"] as const) {
  test(`Windows buffers early ${intent} and resumes it after Connect sign-in`, async ({
    browser,
  }) => {
    const account = await browser.newContext({ baseURL });
    const suffix = `${Date.now()}-${intent}`;
    const email = `windows-ready-${suffix}@example.test`;
    expect(
      (
        await account.request.post("/api/auth/register", {
          data: {
            name: "Windows Ready",
            email,
            password: "ConnectWindows123!",
            companyName: `Windows Ready Solar ${suffix}`,
          },
        })
      ).status(),
    ).toBe(201);
    const context = await contextFor(browser);
    const page = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/session", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/directory");
    await expect.poll(async () => (await state(page))?.ready).toBe(false);
    await command(page, { type: "account" });
    await command(page, { type: intent });
    await command(page, { type: "navigate", path: "javascript:alert(1)" });
    await command(page, { type: "unknown" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    release();
    await expect(
      page.getByRole("dialog").getByLabel("Work email"),
    ).toBeVisible();
    await page.getByLabel("Work email").fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("ConnectWindows123!");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    if (intent === "compose")
      await expect(
        page.getByRole("textbox", { name: "Update content" }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("heading", { name: "Notifications", exact: true }),
      ).toBeVisible();
    await expect.poll(async () => (await state(page))?.signedIn).toBe(true);
    const payloads = JSON.stringify(
      await page.evaluate(() => (window as any).windowsStates),
    );
    expect(payloads).not.toContain(email);
    expect(payloads).not.toMatch(/session|token|password/i);
    await context.close();
    await account.close();
  });
}

test("Windows company actions preserve drafts, company switching and live light/dark layout", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await contextFor(browser);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const companyName = `Windows Solar ${suffix}`;
  const registered = await context.request.post("/api/auth/register", {
    data: {
      name: "Windows Owner",
      email: `windows-owner-${suffix}@example.test`,
      password: "ConnectWindows123!",
      companyName,
    },
  });
  expect(registered.status()).toBe(201);
  const owner = await registered.json();
  expect(
    (
      await context.request.post("/api/companies", {
        data: { name: `Windows Projects ${suffix}` },
      })
    ).status(),
  ).toBe(201);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".windows-app .newsroom")).toBeVisible();
  await command(page, { type: "account" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: companyName, exact: true })
    .click();
  await expect
    .poll(async () => (await state(page))?.companyName)
    .toBe(companyName);
  await command(page, { type: "compose" });
  const writing = `Windows project update ${suffix}`;
  await page.getByRole("textbox", { name: "Update content" }).fill(writing);
  await command(page, { type: "navigate", path: "/directory" });
  await expect(page).toHaveURL(/\/directory$/);
  const drafts = await (await context.request.get("/api/publications")).json();
  expect(drafts.some((draft: any) => draft.body.includes(writing))).toBe(true);

  // Real React-controlled HTML selects remain available to WebView2.
  const businessType = page.getByRole("combobox", { name: "Company type" });
  await businessType.selectOption({ label: "Installer" });
  await expect(page).toHaveURL(/type=Installer/);
  await expect(businessType).toHaveValue("Installer");
  await expect(businessType).toHaveCSS("min-height", "44px");
  await expect(businessType).toHaveCSS("border-radius", "999px");
  await expect(page.locator("html")).not.toHaveClass(/mac-native-selects/);

  for (const colorScheme of ["light", "dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      colorScheme === "dark" ? "rgb(28, 45, 58)" : "rgb(242, 247, 252)",
    );
    await expect(page.locator(".discovery-card").first()).toHaveCSS(
      "background-color",
      colorScheme === "dark" ? "rgb(32, 51, 66)" : "rgb(255, 255, 255)",
    );
    await expect(businessType).not.toHaveCSS("background-image", "none");
    await expect(page.locator("body")).toHaveCSS(
      "font-family",
      '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    );
    await page.screenshot({
      path: `test-results/windows-directory-${colorScheme}.png`,
    });
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await command(page, { type: "navigate", path: "/" });
  await page.screenshot({ path: "test-results/windows-feed-dark.png" });
  await command(page, { type: "account" });
  await expect(page.locator(".desktop-action-panel")).toBeVisible();
  await page.screenshot({ path: "test-results/windows-account-dark.png" });
  await closeDialog(page);
  await command(page, { type: "compose" });
  await expect(
    page.getByRole("textbox", { name: "Update content" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/windows-publisher-dark.png" });
  await closeDialog(page);
  await command(page, { type: "profile" });
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const profileURL = page.url();
  await page
    .getByRole("dialog")
    .getByLabel("Headline", { exact: false })
    .fill("Retain this unsaved headline");
  await command(page, { type: "navigate", path: "/directory" });
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(profileURL);
  await command(page, { type: "navigate", path: "/messages" });
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(/\/messages$/);
  for (const width of [1180, 620]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator(".messaging-panel")).toBeVisible();
    const bounds = await page
      .locator(".messaging-panel")
      .evaluate((el) => ({
        bottom: el.getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }));
    expect(bounds.bottom).toBeLessThanOrEqual(851);
    expect(bounds.bottom).toBeGreaterThanOrEqual(845);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `test-results/windows-inbox-dark-${width}.png`,
    });
  }
  await command(page, { type: "notifications" });
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await closeDialog(page);
  await command(page, { type: "state" });
  expect((await state(page)).canPublish).toBe(true);
  const payloads = JSON.stringify(
    await page.evaluate(() => (window as any).windowsStates),
  );
  expect(payloads).not.toContain(owner.activeCompanyId);
  expect(payloads).not.toMatch(/session|token|password/i);
  expect(errors).toEqual([]);
  await context.close();
});

test("Windows individual accounts keep messaging while company publishing and network stay restricted", async ({
  browser,
}) => {
  const context = await contextFor(browser, { width: 760 });
  const suffix = Date.now();
  expect(
    (
      await context.request.post("/api/auth/register", {
        data: {
          name: "Windows Individual",
          email: `windows-individual-${suffix}@example.test`,
          password: "ConnectWindows123!",
          accountType: "individual",
        },
      })
    ).status(),
  ).toBe(201);
  const page = await context.newPage();
  await page.goto("/");
  await command(page, { type: "compose" });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Publishing is for company accounts." }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Update content" }),
  ).toHaveCount(0);
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page.locator(".people-inbox")).toBeVisible();
  await command(page, { type: "navigate", path: "/network" });
  await expect(page).toHaveURL(/\/messages$/);
  await command(page, { type: "account" });
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  await command(page, { type: "state" });
  expect((await state(page)).accountType).toBe("individual");
  expect((await state(page)).canPublish).toBe(false);
  await context.close();
});
