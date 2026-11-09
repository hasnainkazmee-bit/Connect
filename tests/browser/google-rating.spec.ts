import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

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

test("owner-authorized Google score and Connect customer score stay separate and expire safely", async ({
  page,
  request,
}) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  let companyId = "",
    ownerId = "",
    customerId = "";
  try {
    const owner = await request.post("/api/auth/register", {
      data: {
        name: "Rating Owner",
        email: `rating-owner-${suffix}@example.test`,
        password: "ConnectRating123!",
        companyName: `Rating Solar ${suffix}`,
      },
    });
    expect(owner.status()).toBe(201);
    const registered = await owner.json();
    companyId = registered.activeCompanyId;
    ownerId = registered.user.id;
    const emptyStatus = await request.get(
      "/api/companies/current/google-business",
    );
    expect(await emptyStatus.json()).toMatchObject({
      enabled: false,
      connected: false,
    });
    const customer = await request.post("/api/auth/register", {
      data: {
        name: "Rating Customer",
        email: `rating-customer-${suffix}@example.test`,
        password: "ConnectRating123!",
        accountType: "individual",
      },
    });
    expect(customer.status()).toBe(201);
    customerId = (await customer.json()).user.id;
    expect(
      (await request.get("/api/companies/current/google-business")).status(),
    ).toBe(403);
    await db.query(
      "INSERT INTO company_reviews(company_id,user_id,rating,title,body,experience_date) VALUES($1,$2,5,'Great work','The solar installation went smoothly.',CURRENT_DATE)",
      [companyId, customerId],
    );
    await db.query(
      `INSERT INTO google_business_connections(company_id,authorized_by,refresh_token_ciphertext,account_name,location_name,location_title,google_maps_uri,rating,review_count,rating_fetched_at)
       VALUES($1,$2,'test-only','accounts/123','locations/456',$3,'https://www.google.com/maps/place/test',4.4,87,now())`,
      [companyId, ownerId, `Rating Solar ${suffix}`],
    );
    const directory = await request.get(
      `/api/companies?q=Rating%20Solar%20${suffix}`,
    );
    expect(directory.ok()).toBe(true);
    const listed = (await directory.json()).companies.find(
      (c: { id: string }) => c.id === companyId,
    );
    expect(listed).toMatchObject({
      rating_average: 5,
      review_count: 1,
      google_rating: 4.4,
      google_review_count: 87,
    });
    const publicRating = await request.get(
      `/api/companies/${companyId}/google-rating`,
    );
    expect(await publicRating.json()).toMatchObject({
      linked: true,
      rating: 4.4,
      count: 87,
    });
    const relog = await request.post("/api/auth/login", {
      data: {
        email: `rating-owner-${suffix}@example.test`,
        password: "ConnectRating123!",
      },
    });
    expect(relog.ok()).toBe(true);
    const status = await request.get("/api/companies/current/google-business");
    const statusData = await status.json();
    expect(statusData).toMatchObject({
      connected: true,
      locationTitle: `Rating Solar ${suffix}`,
      rating: 4.4,
      count: 87,
    });
    expect(JSON.stringify(statusData)).not.toContain("test-only");
    await page.goto(`/${listed.username || listed.slug}?tab=reviews`);
    await expect(
      page.getByRole("button", { name: /Connect 5.0/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Google Maps rating 4.4/ }),
    ).toBeVisible();
    await page.goto(`/directory?q=Rating%20Solar%20${suffix}`);
    const card = page
      .locator(".discovery-card")
      .filter({ hasText: `Rating Solar ${suffix}` });
    await expect(card.getByLabel(/Connect rating 5.0/)).toBeVisible();
    await expect(card.getByLabel(/Google rating 4.4/)).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.height).toBe(384);
    await page.screenshot({
      path: "/tmp/connect-rating-directory.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 850 });
    await expect(card.getByLabel(/Connect rating 5.0/)).toBeVisible();
    await expect(card.getByLabel(/Google rating 4.4/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({ path: "/tmp/connect-rating-directory-mobile.png", fullPage: true });
    const browserLogin = await page.request.post("/api/auth/login", {
      data: {
        email: `rating-owner-${suffix}@example.test`,
        password: "ConnectRating123!",
      },
    });
    expect(browserLogin.ok()).toBe(true);
    await page.goto(`/${listed.username || listed.slug}?tab=reviews`);
    await expect(
      page.getByRole("region", { name: "Google rating connection" }),
    ).toBeVisible();
    await expect(
      page.getByText("Google Business Profile access is being set up."),
    ).toBeVisible();
    await db.query(
      "UPDATE google_business_connections SET rating_fetched_at=now()-interval '31 days' WHERE company_id=$1",
      [companyId],
    );
    const stale = await request.get(
      `/api/companies?q=Rating%20Solar%20${suffix}`,
    );
    const staleListing = (await stale.json()).companies.find(
      (c: { id: string }) => c.id === companyId,
    );
    expect(staleListing.google_rating).toBeNull();
    expect(staleListing.rating_average).toBe(5);
  } finally {
    if (companyId)
      await db.query("DELETE FROM companies WHERE id=$1", [companyId]);
    if (ownerId) await db.query("DELETE FROM users WHERE id=$1", [ownerId]);
    if (customerId)
      await db.query("DELETE FROM users WHERE id=$1", [customerId]);
    await db.end();
  }
});
