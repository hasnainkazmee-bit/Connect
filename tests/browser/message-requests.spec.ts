import { test, expect } from "@playwright/test";

test("message requests connect companies and carry the first message into chat", async ({
  browser,
}) => {
  const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
  const suffix = Date.now().toString().slice(-8);
  const contextA = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const contextB = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 812 },
  });
  const register = async (
    context: typeof contextA,
    name: string,
    companyName: string,
  ) => {
    const response = await context.request.post("/api/auth/register", {
      data: {
        name,
        companyName,
        email: name.toLowerCase() + suffix + "@message.test",
        password: "MessageBrowser123!",
      },
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const A = await register(contextA, "Amina", "Brightfield " + suffix);
  const B = await register(contextB, "Maya", "HelioWorks " + suffix);
  const bName = B.companies[0].name;
  const aName = A.companies[0].name;
  const pageA = await contextA.newPage(),
    pageB = await contextB.newPage();
  const errors: string[] = [];
  pageA.on("pageerror", (e) => errors.push(e.message));
  pageB.on("pageerror", (e) => errors.push(e.message));
  await pageA.goto("/messages");
  await expect(
    pageA.getByRole("button", { name: "All companies", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await pageA.getByRole("textbox", { name: "Search companies" }).fill(bName);
  await expect(pageA.locator(".conversation-link")).toHaveCount(1);
  await pageA.locator(".conversation-link").click();
  await expect(
    pageA.getByLabel("Message request", { exact: true }),
  ).toBeVisible();
  const intro =
    "Hi Maya, we’re looking for an installation partner for a commercial rooftop in Austin. Can we discuss the scope?";
  await pageA.getByLabel("Message request", { exact: true }).fill(intro);
  await pageA.reload();
  await expect(
    pageA.getByLabel("Message request", { exact: true }),
  ).toHaveValue(intro);
  await pageA.screenshot({
    path: "test-results/message-request-compose.png",
    fullPage: true,
  });
  await pageA
    .getByRole("button", { name: "Send message request", exact: true })
    .click();
  await expect(
    pageA.getByRole("heading", { name: "Request sent", exact: true }),
  ).toBeVisible();
  await expect(pageA.getByLabel("Message", { exact: true })).toHaveCount(0);
  expect(
    (await (await contextA.request.get("/api/network")).json()).connections,
  ).toHaveLength(0);

  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: "Requests 1", exact: true }).click();
  await expect(
    pageB.locator(".conversation-link").filter({ hasText: aName }),
  ).toBeVisible();
  await pageB.locator(".conversation-link").filter({ hasText: aName }).click();
  await expect(
    pageB.locator(".message-bubble").getByText(intro, { exact: true }),
  ).toBeVisible();
  await expect(
    pageB.getByRole("button", { name: "Accept & connect", exact: true }),
  ).toBeVisible();
  expect(
    await pageB.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await pageB.screenshot({
    path: "test-results/message-request-mobile.png",
    fullPage: true,
  });
  await pageB
    .getByRole("button", { name: "Accept & connect", exact: true })
    .click();
  await expect(pageB.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(pageA.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(
    pageA.locator(".message-bubble").getByText(intro, { exact: true }),
  ).toHaveCount(1);
  await pageB
    .getByLabel("Message", { exact: true })
    .fill("Absolutely. Send us the project details.");
  await pageB
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    pageA
      .locator(".message-bubble")
      .getByText("Absolutely. Send us the project details.", { exact: true }),
  ).toBeVisible();
  await pageA.reload();
  await expect(
    pageA.locator(".message-bubble").getByText(intro, { exact: true }),
  ).toHaveCount(1);
  await pageA.goto("/network/connections");
  await expect(
    pageA.getByRole("button", { name: "Installers 1", exact: true }),
  ).toBeVisible();
  await expect(
    pageA.getByRole("heading", { name: bName, exact: true }),
  ).toBeVisible();
  await pageB.goto("/network/connections");
  await expect(
    pageB.getByRole("heading", { name: aName, exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await contextA.close();
  await contextB.close();
});
