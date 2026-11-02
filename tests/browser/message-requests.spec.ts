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

test("unclaimed company contact state stays navigable across inbox sizes", async ({
  browser,
}) => {
  const { default: pg } = await import("pg");
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = Date.now();
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
  });
  let id: string | undefined;
  try {
    const registered = await context.request.post("/api/auth/register", {
      data: {
        name: "Inbox Reviewer",
        companyName: `Solar Studio ${suffix}`,
        email: `inbox-${suffix}@example.test`,
        password: "InboxReview123!",
      },
    });
    expect(registered.status()).toBe(201);
    id = (
      await db.query(
        "INSERT INTO companies(name,slug,username,type,location,service_areas,services,listing_status,website,tagline,logo_url) VALUES($1,$2,$2,'Installer','Saint Paul, MN',ARRAY['Minnesota','Wisconsin','Iowa'],ARRAY['Installation','Design','Energy storage'],'unclaimed','https://official.example.test','Solar installation and storage for homes and businesses.','/assets/companies/all-energy-solar.png') RETURNING id",
        [`Solar Partner ${suffix}`, `inbox-listing-${suffix}`],
      )
    ).rows[0].id;
    const page = await context.newPage();
    for (const width of [1912, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 917 });
      await page.goto(`/messages/company/${id}`);
      const state = page.locator(".unclaimed-company-state");
      await expect(
        state.getByRole("heading", {
          name: `Reach Solar Partner ${suffix} directly`,
        }),
      ).toBeVisible();
      await expect(
        state.getByRole("link", { name: "Visit website" }),
      ).toHaveAttribute("href", "https://official.example.test");
      await expect(
        state.getByRole("link", { name: "View company profile" }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Message request", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/inbox-unclaimed-${width}.png`,
        fullPage: true,
      });
      if (width === 390) {
        await page.getByRole("link", { name: "Back to companies" }).click();
        await expect(page.getByLabel("Search companies")).toBeVisible();
      }
    }
  } finally {
    await context.close();
    if (id) await db.query("DELETE FROM companies WHERE id=$1", [id]);
    await db.end();
  }
});
