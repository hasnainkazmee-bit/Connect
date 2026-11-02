import { test, expect, type Browser, type Page } from "@playwright/test";

const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
const macUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 ConnectMac/0.1.0";
async function contextFor(
  browser: Browser,
  bridge = true,
  mac = true,
  width = 1180,
) {
  const context = await browser.newContext({
    baseURL,
    userAgent: mac ? macUA : undefined,
    viewport: { width, height: 850 },
  });
  if (bridge)
    await context.addInitScript(() => {
      const host = window as any;
      host.macStates = [];
      host.webkit = {
        messageHandlers: {
          connectMac: {
            postMessage(value: unknown) {
              host.macStates.push(value);
            },
          },
        },
      };
    });
  return context;
}
async function command(page: Page, value: object) {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent("connect:mac-command", { detail })),
    value,
  );
}
async function capture(page: Page, path: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({ path, animations: "disabled" });
}

for (const setup of [
  { bridge: false, mac: true },
  { bridge: true, mac: false },
]) {
  test(`Mac mode requires both host signals: bridge=${setup.bridge}, UA=${setup.mac}`, async ({
    browser,
  }) => {
    const context = await contextFor(browser, setup.bridge, setup.mac);
    const page = await context.newPage();
    await page.goto("/directory");
    await expect(page.locator(".site-header")).toBeVisible();
    await expect(page.locator(".app-main")).not.toHaveClass(/mac-app/);
    await command(page, { type: "compose" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await context.close();
  });
}

test("authentication popup fallback retains web chrome despite inherited Mac signals", async ({
  browser,
}) => {
  const context = await contextFor(browser);
  await context.addInitScript(() => {
    (window as any).opener = {};
  });
  const page = await context.newPage();
  await page.goto("/directory");
  await expect(page.locator(".site-header")).toBeVisible();
  await expect(page.locator(".app-main")).not.toHaveClass(/mac-app/);
  await context.close();
});

test("native guest actions keep the real authentication flow and strict route allowlist", async ({
  browser,
}) => {
  const context = await contextFor(browser);
  const page = await context.newPage();
  await page.goto("/directory");
  await expect(page.locator(".app-main.mac-app")).toBeVisible();
  await expect(page.locator(".site-header, .site-footer")).toHaveCount(0);
  await command(page, { type: "navigate", path: "https://example.com/" });
  await command(page, { type: "navigate", path: "/account" });
  await expect(page).toHaveURL(/\/directory$/);
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page.getByRole("dialog").getByLabel("Work email")).toBeVisible();
  await expect(page).toHaveURL(/\/directory$/);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await command(page, { type: "account" });
  await expect(
    page.getByRole("dialog").getByLabel("Password", { exact: true }),
  ).toBeVisible();
  await command(page, { type: "state" });
  const state = await page.evaluate(() => (window as any).macStates.at(-1));
  expect(state.signedIn).toBe(false);
  expect(state.canPublish).toBe(false);
  expect(Object.keys(state).sort()).toEqual(
    [
      "type",
      "path",
      "signedIn",
      "accountType",
      "userName",
      "companyName",
      "canPublish",
      "unreadCount",
    ].sort(),
  );
  await context.close();
});

test("native company workspace reuses publishing guards, account switching and notifications", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await contextFor(browser);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const companyName = `Mac Solar ${suffix}`;
  const email = `mac-${suffix}@example.test`;
  const registration = await context.request.post("/api/auth/register", {
    data: {
      name: "Mac Owner",
      email,
      password: "ConnectMacOwner123!",
      companyName,
    },
  });
  expect(registration.status()).toBe(201);
  const owner = await registration.json();
  const added = await context.request.post("/api/companies", {
    data: { name: `Mac Projects ${suffix}` },
  });
  expect(added.ok()).toBe(true);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".mac-app .newsroom")).toBeVisible();
  await expect(
    page.locator(".newsroom-heading, .feed-composer").first(),
  ).toBeHidden();
  await page.evaluate(() => {
    (window as any).navigationMarker = "same-react-app";
  });
  await command(page, { type: "account" });
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: companyName, exact: true })
    .click();
  await expect(page).toHaveURL(/\/network\/connections$/);
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).macStates.at(-1)?.companyName),
    )
    .toBe(companyName);
  await command(page, { type: "compose" });
  const editor = page.getByRole("textbox", { name: "Update content" });
  await expect(editor).toBeVisible();
  const writing = `Native draft ${suffix}: project progress stays saved.`;
  await editor.fill(writing);
  await command(page, { type: "navigate", path: "/directory" });
  await expect(page).toHaveURL(/\/directory$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const drafts = await (await context.request.get("/api/publications")).json();
  expect(drafts.some((draft: any) => draft.body.includes(writing))).toBe(true);
  expect(await page.evaluate(() => (window as any).navigationMarker)).toBe(
    "same-react-app",
  );

  await command(page, { type: "profile" });
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const profileURL = page.url();
  await page
    .getByRole("dialog")
    .getByLabel("Headline", { exact: false })
    .fill("Keep this unsaved company introduction");
  await command(page, { type: "navigate", path: "/directory" });
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(profileURL);
  await expect(
    page.getByRole("dialog").getByLabel("Headline", { exact: false }),
  ).toHaveValue("Keep this unsaved company introduction");
  await command(page, { type: "navigate", path: "/directory" });
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(/\/directory$/);

  await command(page, { type: "notifications" });
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Connection requests" })
    .click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const width of [1440, 760, 620]) {
    await page.setViewportSize({ width, height: 850 });
    await command(page, { type: "navigate", path: "/messages" });
    await expect(
      page.getByRole("button", { name: "All companies", exact: true }),
    ).toBeVisible();
    const bounds = await page
      .locator(".messaging-panel")
      .evaluate((element) => ({
        bottom: element.getBoundingClientRect().bottom,
        top: element.getBoundingClientRect().top,
        width: element.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth - innerWidth,
        bodyPadding: getComputedStyle(document.body).paddingBottom,
      }));
    expect(bounds.bottom).toBeLessThanOrEqual(851);
    expect(bounds.bottom).toBeGreaterThanOrEqual(845);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    expect(bounds.bodyPadding).toBe("0px");
    await expect(page.locator(".mac-app")).toHaveCount(1);
    await expect(page.locator(".messaging-panel")).toHaveCount(1);
    await capture(page, `test-results/mac-messages-${width}.png`);
  }
  await page.setViewportSize({ width: 1180, height: 850 });
  await command(page, { type: "navigate", path: "/" });
  await capture(page, "test-results/mac-feed-1180.png");
  await command(page, { type: "account" });
  await capture(page, "test-results/mac-account.png");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).macStates.at(-1)?.signedIn),
    )
    .toBe(false);
  const snapshots = await page.evaluate(() => (window as any).macStates);
  expect(JSON.stringify(snapshots)).not.toContain(email);
  expect(JSON.stringify(snapshots)).not.toContain(owner.activeCompanyId);
  expect(JSON.stringify(snapshots)).not.toMatch(/session|token|password/i);
  expect(errors).toEqual([]);
  await context.close();
});

test("native individual account can message but cannot open a publisher", async ({
  browser,
}) => {
  const context = await contextFor(browser, true, true, 760);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const registration = await context.request.post("/api/auth/register", {
    data: {
      name: "Mac Individual",
      email: `mac-person-${suffix}@example.test`,
      password: "ConnectMacPerson123!",
      accountType: "individual",
    },
  });
  expect(registration.status()).toBe(201);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".mac-app")).toBeVisible();
  await command(page, { type: "compose" });
  await expect(
    page.getByRole("textbox", { name: "Update content" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Publishing is for company accounts." }),
  ).toBeVisible();
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page.locator(".people-inbox")).toBeVisible();
  await command(page, { type: "navigate", path: "/network" });
  await expect(page).toHaveURL(/\/messages$/);
  expect(
    await page
      .locator(".people-inbox")
      .evaluate((element) => element.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(851);
  await command(page, { type: "state" });
  expect(
    await page.evaluate(() => (window as any).macStates.at(-1)?.canPublish),
  ).toBe(false);
  expect(
    await page.evaluate(() => (window as any).macStates.at(-1)?.accountType),
  ).toBe("individual");
  await context.close();
});
