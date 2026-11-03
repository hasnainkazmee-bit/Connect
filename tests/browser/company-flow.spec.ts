import { test, expect } from "@playwright/test";
test("two company accounts connect, accept and chat with real persistence", async ({
  browser,
  request,
}) => {
  const id = Date.now(),
    password = "BrowserTest123!";
  const a = await request.post("/api/auth/register", {
    data: {
      name: "Amina Browser",
      email: "amina" + id + "@example.test",
      password,
      companyName: "Brightfield Browser " + id,
    },
  });
  expect(a.status()).toBe(201);
  const A = await a.json();
  const b = await request.post("/api/auth/register", {
    data: {
      name: "Maya Browser",
      email: "maya" + id + "@example.test",
      password,
      companyName: "HelioWorks Browser " + id,
    },
  });
  expect(b.status()).toBe(201);
  const B = await b.json();
  const options = {
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
  };
  const contextA = await browser.newContext(options),
    contextB = await browser.newContext(options),
    pageA = await contextA.newPage(),
    pageB = await contextB.newPage();
  const errors: string[] = [];
  pageA.on("pageerror", (e) => errors.push(e.message));
  pageB.on("pageerror", (e) => errors.push(e.message));
  const login = async (page: typeof pageA, email: string) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await login(pageA, A.user.email);
  await login(pageB, B.user.email);
  await pageA.goto("/company/" + B.activeCompanyId);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA
    .locator("textarea[name=note]")
    .fill("Let’s discuss a commercial installation in Austin.");
  await pageA.getByRole("button", { name: "Send connection request" }).click();
  await expect(
    pageA.getByRole("heading", { name: "Connection request sent" }),
  ).toBeVisible();
  await pageB.getByLabel("Notifications", { exact: true }).click();
  const incomingRequests = pageB.getByRole("link", {
    name: /^Connection requests/,
  });
  await expect(incomingRequests.locator(".count")).toHaveText("1");
  await expect(incomingRequests).toHaveAttribute("href", "/requests");
  await incomingRequests.click();
  await expect(
    pageB.getByText("Let’s discuss a commercial installation in Austin."),
  ).toBeVisible();
  await pageB.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(pageB.getByLabel("Message", { exact: true })).toBeVisible();
  await pageB
    .getByLabel("Message", { exact: true })
    .fill("Thanks, happy to talk about the project.");
  await pageB.getByRole("button", { name: "Send message" }).click();
  await pageA.getByRole("button", { name: "Close dialog" }).click();
  await pageA.goto("/messages");
  await pageA.locator(".conversation-link").first().click();
  await expect(
    pageA
      .getByText("Thanks, happy to talk about the project.", { exact: true })
      .last(),
  ).toBeVisible();
  await pageA
    .getByLabel("Message", { exact: true })
    .fill("Can we review the scope tomorrow?");
  await pageA.getByRole("button", { name: "Send message" }).click();
  await expect(
    pageB
      .getByText("Can we review the scope tomorrow?", { exact: true })
      .last(),
  ).toBeVisible();
  await expect(
    pageA.locator('.primary-nav > a[href="/messages"] .count'),
  ).toHaveCount(0);
  await pageB.reload();
  await expect(
    pageB
      .getByText("Can we review the scope tomorrow?", { exact: true })
      .last(),
  ).toBeVisible();
  await pageA.setViewportSize({ width: 375, height: 812 });
  await expect(pageA.getByLabel("Message", { exact: true })).toBeVisible();
  expect(
    await pageA.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await pageA.screenshot({
    path: "test-results/mobile-messages.png",
    fullPage: true,
  });
  await pageA.goto("/");
  expect(
    await pageA.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await contextA.close();
  await contextB.close();
});
