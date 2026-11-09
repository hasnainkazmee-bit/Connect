import { test, expect } from "@playwright/test";

test("Google rating stays distinct from Connect reviews and credits Google Maps", async ({
  page,
  request,
}) => {
  const result = await request.get("/api/companies");
  expect(result.ok()).toBe(true);
  const company = (await result.json()).companies[0];
  expect(company).toBeTruthy();
  await page.route("**/api/companies/*/google-rating", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        linked: true,
        rating: 4.7,
        count: 42,
        googleMapsUri: "https://maps.google.com/?cid=123",
        attributions: [],
      }),
    }),
  );
  await page.goto(`/${company.username || company.slug}?tab=reviews`);
  const rating = page.locator(".presence-google-rating");
  await expect(rating).toBeVisible();
  await expect(rating).toHaveAttribute(
    "aria-label",
    "Google Maps rating 4.7 out of 5 from 42 ratings",
  );
  await expect(rating).toHaveAttribute(
    "href",
    "https://maps.google.com/?cid=123",
  );
  await expect(rating.getByRole("img", { name: "Google Maps" })).toBeVisible();
  await expect(page.getByText("Great installation team.")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Customer reviews" }),
  ).toBeVisible();
});

test("profiles link to Google Maps without a Places API key or an asserted rating", async ({
  page,
  request,
}) => {
  const result = await request.get("/api/companies");
  expect(result.ok()).toBe(true);
  const company = (await result.json()).companies[0];
  expect(company).toBeTruthy();
  await page.route("**/api/companies/*/google-rating", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ linked: false }),
    }),
  );
  await page.goto(`/${company.username || company.slug}`);
  const link = page.getByRole("link", {
    name: `Check ${company.name}'s rating on Google Maps`,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [company.name, company.location].filter(Boolean).join(" "),
    )}`,
  );
  await expect(page.locator(".presence-google-score")).toHaveCount(0);
});
