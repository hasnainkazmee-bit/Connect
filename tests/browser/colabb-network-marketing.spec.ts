import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Network marketing explains both feeds and returns to the app after sign-in at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    if (viewport.width < 1050) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation", { name: viewport.width < 1050 ? "Mobile navigation" : "Main navigation", exact: true }).getByRole("link", { name: "Network", exact: true }).click();
    await expect(page).toHaveURL(/\/network$/);
    await expect(page.getByRole("heading", { name: "Follow companies. Join the conversation." })).toBeVisible();
    await expect(page.locator("#mx-network-example")).toContainText("Company post");
    await page.getByRole("button", { name: "Communities", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Equipment sourcing", exact: true })).toBeVisible();
    await expect(page.locator("#mx-network-example")).toContainText("200 modules");
    await expect(page.getByRole("button", { name: "Communities", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Company posts", exact: true }).click();
    await expect(page.locator("#mx-network-example")).toContainText("Colabb team");
    const preview = page.locator("#mx-network-example");
    const writes: string[] = [];
    page.on("request", sent => { if (sent.method() !== "GET" && sent.url().includes("/api/network")) writes.push(sent.url()); });
    await expect(preview.getByRole("button", { name: "Like post", exact: true }).locator("svg")).toHaveClass(/lucide-heart/);
    await preview.getByRole("button", { name: "Like post", exact: true }).click();
    await expect(preview.getByRole("button", { name: "Unlike post", exact: true })).toHaveAttribute("aria-pressed", "true");
    await preview.getByRole("button", { name: "Save post", exact: true }).click();
    await expect(preview.getByRole("button", { name: "Unsave post", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // A test-owned account is created through the normal isolated test API.
    const suffix = randomUUID();
    const email = `network-marketing-${suffix}@example.test`;
    const password = "NetworkMarketing123!";
    const registered = await request.post("/api/auth/register", { data: { name: "Network Marketing Owner", companyName: "Network Marketing Solar " + suffix, email, password } });
    expect(registered.status()).toBe(201);
    expect((await request.post("/api/onboarding/complete", { data: { followIds: [] } })).ok()).toBeTruthy();
    await page.getByRole("button", { name: "Sign in to Network", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.locator("form").filter({ has: page.getByLabel("Email address", { exact: true }) }).getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/network$/);
    await expect(page.getByRole("main", { name: "Network content", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Follow companies. Join the conversation." })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("main", { name: "Network content", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("only the public Network overview is indexable; private routes still require sign-in", async ({ page, request }) => {
  const overview = await request.get("/network");
  expect(overview.ok()).toBeTruthy();
  const html = await overview.text();
  expect(html).toContain("Follow companies.");
  expect(html).toContain("Company posts and communities | Colabb");
  expect(html).not.toContain("noindex,follow");
  const privatePage = await request.get("/network/communities");
  expect(await privatePage.text()).toContain("noindex,follow");
  expect((await request.get("/api/network-v2/bootstrap")).status()).toBe(401);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /network$");
  expect(robots).toContain("Disallow: /network/");
  await page.goto("/");
  await page.getByRole("link", { name: "Company messaging", exact: true }).click();
  await expect(page).toHaveURL(/how-it-works#mx-messaging-title$/);
  await expect.poll(async () => (await page.locator("#mx-messaging-title").boundingBox())?.y ?? -1).toBeGreaterThan(0);
  await expect.poll(async () => (await page.locator("#mx-messaging-title").boundingBox())?.y ?? 9999).toBeLessThan(300);
  await page.goto("/network/communities");
  await expect(page.getByRole("heading", { name: "Your network in solar", exact: true })).toBeVisible();
  await expect(page.getByText("Sign in to follow companies, join communities and share what you’re working on.")).toBeVisible();
});
