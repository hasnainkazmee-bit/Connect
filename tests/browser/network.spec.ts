import { test, expect } from "@playwright/test";

test("network groups active connections by business type and keeps requests separate", async ({
  browser,
}) => {
  const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
  const suffix = Date.now();
  const contexts = [];
  async function company(name: string, type: string, location: string) {
    const context = await browser.newContext({ baseURL });
    contexts.push(context);
    const response = await context.request.post("/api/auth/register", {
      data: {
        name: "Network Tester",
        email:
          name.toLowerCase().replaceAll(" ", "") + suffix + "@example.test",
        password: "NetworkTest123!",
        companyName: name,
      },
    });
    expect(response.status()).toBe(201);
    const session = await response.json();
    const update = await context.request.patch("/api/companies/current", {
      data: {
        name,
        type,
        location,
        tagline: "",
        description: "",
        service_areas: [],
        services: [],
        website: "",
      },
    });
    expect(update.status()).toBe(200);
    return { context, id: session.activeCompanyId };
  }
  const owner = await company(
    "Network Test Company",
    "Developer",
    "Austin, TX",
  );
  const installerA = await company("Alpine Solar", "Installer", "Denver, CO");
  const installerB = await company("Summit Solar", "Installer", "Austin, TX");
  const epc = await company("HelioWorks Solar", "EPC", "Phoenix, AZ");
  const pending = await company("Pending Developer", "Developer", "Boston, MA");
  const blocked = await company(
    "Blocked Distributor",
    "Distributor",
    "Miami, FL",
  );
  const disconnected = await company(
    "Disconnected Manufacturer",
    "Manufacturer",
    "San Diego, CA",
  );
  for (const target of [installerA, installerB, epc, blocked, disconnected]) {
    const response = await owner.context.request.post("/api/requests", {
      data: { companyId: target.id },
    });
    expect(response.status()).toBe(201);
    const request = await response.json();
    const accept = await target.context.request.post(
      `/api/requests/${request.id}/respond`,
      { data: { action: "accept" } },
    );
    expect(accept.status()).toBe(200);
  }
  expect(
    (
      await pending.context.request.post("/api/requests", {
        data: { companyId: owner.id },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await owner.context.request.post(`/api/relationships/${blocked.id}`, {
        data: { action: "block" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await owner.context.request.post(
        `/api/relationships/${disconnected.id}`,
        { data: { action: "disconnect" } },
      )
    ).status(),
  ).toBe(200);

  const page = await owner.context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/network/connections");
  const filters = page.getByRole("group", { name: "Business type" });
  await expect(
    filters.getByRole("button", { name: "All 3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    filters.getByRole("button", { name: "Installers 2", exact: true }),
  ).toBeVisible();
  await expect(
    filters.getByRole("button", { name: "EPCs 1", exact: true }),
  ).toBeVisible();
  for (const type of [
    "Developers",
    "Distributors",
    "Manufacturers",
    "Service providers",
  ])
    await expect(
      filters.getByRole("button", { name: `${type} 0`, exact: true }),
    ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Installers", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    page
      .getByRole("region", { name: "EPCs", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.locator(".network-sidebar")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/network-desktop.png",
    fullPage: true,
  });

  await filters.getByRole("button", { name: "EPCs 1", exact: true }).click();
  await expect(page.locator(".connection-row")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "HelioWorks Solar" }),
  ).toBeVisible();
  await filters.getByRole("button", { name: "All 3", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search connections" })
    .fill("Denver");
  await expect(page.locator(".connection-row")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Alpine Solar" }),
  ).toBeVisible();
  await expect(
    filters.getByRole("button", { name: "Installers 2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search connections" })
    .fill("no such company");
  await expect(
    page.getByRole("heading", { name: "No matching connections" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await filters
    .getByRole("button", { name: "Developers 0", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No developers connected yet" }),
  ).toBeVisible();
  await filters.getByRole("button", { name: "All 3", exact: true }).click();

  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("link", { name: "Message Alpine Solar", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/network-mobile.png",
    fullPage: true,
  });

  // A read notification must not hide a pending request from the bell.
  await page.getByLabel("Notifications", { exact: true }).click();
  await page.getByRole("button", { name: "Mark read" }).click();
  await page
    .getByRole("link", { name: "Connection requests 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pending Developer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "You’re all caught up" }),
  ).toBeVisible();
  await page.goto("/network/incoming");
  await expect(page).toHaveURL(/\/requests$/);

  await page.goto("/network/connections");
  await page.getByLabel("Actions for Alpine Solar", { exact: true }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    filters.getByRole("button", { name: "All 2", exact: true }),
  ).toBeVisible();
  await expect(
    filters.getByRole("button", { name: "Installers 1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    filters.getByRole("button", { name: "All 2", exact: true }),
  ).toBeVisible();
  await page.goto("/settings/blocked");
  await expect(
    page.getByRole("heading", { name: "Blocked Distributor" }),
  ).toBeVisible();
  for (const context of contexts) await context.close();
});
