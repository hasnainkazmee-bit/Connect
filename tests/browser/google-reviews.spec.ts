import { test, expect } from "@playwright/test";

test("Google reviews remain distinct from Connect reviews and credit their source", async ({
  page,
  request,
}) => {
  const result = await request.get("/api/companies");
  expect(result.ok()).toBe(true);
  const company = (await result.json()).companies[0];
  expect(company).toBeTruthy();
  await page.route("**/api/companies/*/google-reviews", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        linked: true,
        rating: 4.7,
        count: 42,
        googleMapsUri: "https://maps.google.com/?cid=123",
        reviews: [
          {
            id: "places/example/reviews/one",
            rating: 5,
            body: "Great installation team.",
            published: "a week ago",
            googleMapsUri: "https://maps.google.com/review/one",
            author: {
              displayName: "Alex Customer",
              uri: "https://maps.google.com/profile/alex",
              photoUri: "https://example.test/alex.png",
            },
          },
        ],
      }),
    }),
  );
  await page.goto(`/${company.username || company.slug}?tab=reviews`);
  const card = page.locator(".google-reviews-card");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("heading", { name: "Google reviews" }),
  ).toBeVisible();
  await expect(card.getByText("42 ratings on Google Maps")).toBeVisible();
  await expect(card.getByText("Great installation team.")).toBeVisible();
  await expect(
    card.getByRole("link", { name: "View review on Google Maps" }),
  ).toHaveAttribute("href", "https://maps.google.com/review/one");
  await expect(
    card.getByRole("link", { name: "Alex Customer" }),
  ).toHaveAttribute("href", "https://maps.google.com/profile/alex");
  await expect(card.getByRole("img", { name: "Google Maps" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Customer reviews" }),
  ).toBeVisible();
});
