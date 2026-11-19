import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

let db: pg.Pool;
let hirer: APIRequestContext;
let companyId: string;
const actors: APIRequestContext[] = [];
const companies: string[] = [];
const users: string[] = [];
const jobs: string[] = [];
const providers: { id: string; name: string; actor: APIRequestContext }[] = [];

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  const database = new URL(process.env.DATABASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(database.hostname);
  expect(database.pathname).toMatch(/_test$/);
  db = new pg.Pool({ connectionString: database.href });
  for (const label of [
    "Match Hirer",
    "Northline Solar",
    "Summit Grid Electric",
    "Fieldwork Energy",
  ]) {
    const actor = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL! },
    });
    actors.push(actor);
    const response = await actor.post("/api/auth/register", {
      data: {
        name: "Local matching owner",
        companyName: label,
        email: `${randomUUID()}@example.test`,
        password: "MatchInvitationsTest123!",
        type: "Installer",
      },
    });
    expect(response.status()).toBe(201);
    const session = await response.json();
    companies.push(session.activeCompanyId);
    users.push(session.user.id);
    await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      session.user.id,
    ]);
    expect(
      (
        await actor.post("/api/onboarding/complete", {
          data: { followIds: [] },
        })
      ).ok(),
    ).toBeTruthy();
    if (!hirer) {
      hirer = actor;
      companyId = session.activeCompanyId;
    } else providers.push({ id: session.activeCompanyId, name: label, actor });
  }
});

test.afterAll(async () => {
  if (jobs.length)
    await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
  if (companies.length)
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companies,
    ]);
  if (users.length)
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await Promise.all(actors.map((actor) => actor.dispose()));
  await db?.end();
});

async function setup(
  page: Page,
  options: { expired?: boolean; secondPage?: boolean } = {},
) {
  const created = await hirer.post("/api/jobs", {
    data: {
      title: "Commercial rooftop installation in Cleveland",
      description:
        "Install and commission the commercial rooftop system. Review the plans and include electrical testing, inspection documents and a clear installation schedule in your quote.",
      trade: "installation",
      location: "Cleveland, OH",
      visibility: "invite_only",
      matchingPreferences: {
        kind: "service",
        categoryId: "solar-installation",
        countryCode: "US",
        stateCode: "OH",
      },
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  jobs.push(id);
  if (options.expired)
    await db.query(
      "UPDATE jobs SET quote_deadline=now()-interval '1 day' WHERE id=$1",
      [id],
    );
  await page.context().addCookies((await hirer.storageState()).cookies);
  // The matching research is a controlled fixture; invitation, notifications,
  // quotes and permissions below all use the real isolated Rust/API service.
  const makeMatch = (
    provider: { id: string; name: string },
    index: number,
    eligible = true,
    claimed = true,
  ) => ({
    company: {
      ...provider,
      slug: `fixture-${index}`,
      logo_url: index === 3 ? "" : `/fixture-logo-${index}.svg`,
      claimed,
      location: "Cleveland, OH",
    },
    eligible,
    score: 100,
    followUp: [],
    offerings: [
      {
        offering: {
          kind: "service",
          title: "Commercial solar installation",
          detail:
            "Rooftop installation, electrical connections and commissioning for commercial solar projects.",
          sectors: ["commercial"],
        },
        needsConfirmation: eligible ? [] : ["service_area"],
        availability: "unknown",
        sources: [],
      },
    ],
  });
  await page.route(`**/api/jobs/${id}/matches?*`, async (route) => {
    const current = await hirer.get(`/api/jobs/${id}/matches`);
    expect(current.ok()).toBeTruthy();
    const actual = await current.json();
    const matches = providers.map((p, i) => makeMatch(p, i));
    matches.push(
      makeMatch(
        { id: randomUUID(), name: "Unclaimed public listing" },
        3,
        true,
        false,
      ),
    );
    matches.push(
      makeMatch(
        { id: randomUUID(), name: "Unavailable logo listing" },
        4,
        true,
        false,
      ),
    );
    await route.fulfill({
      json: {
        ...actual,
        matches,
        needsConfirmation: [makeMatch(providers[2], 2, false)],
        totalMatches: options.secondPage ? 17 : 5,
        totalNeedsConfirmation: 1,
        pageSize: 12,
      },
    });
  });
  await page.route("**/fixture-logo-*.svg", (route) => {
    const index = Number(
      route
        .request()
        .url()
        .match(/logo-(\d+)/)?.[1],
    );
    if (index === 4) return route.fulfill({ status: 404, body: "" });
    const shapes = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="220"><rect width="1200" height="220" rx="20" fill="#192e38"/><text x="600" y="150" text-anchor="middle" font-family="Arial" font-size="125" fill="white">Northline Solar</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><circle cx="250" cy="250" r="230" fill="#ff6a00"/><path d="M290 80L100 280H240L210 420L400 200H260Z" fill="white"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect x="40" y="25" width="120" height="750" rx="60" fill="#192e38"/></svg>',
    ];
    return route.fulfill({ contentType: "image/svg+xml", body: shapes[index] });
  });
  await page.goto(`/jobs/${id}/matches${options.secondPage ? "?page=2" : ""}`);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await expect(
    page.getByRole("article", { name: providers[0].name, exact: true }),
  ).toBeVisible();
  return id;
}

for (const width of [1440, 390, 320]) {
  test(`matching keeps logos proportional and actions readable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const id = await setup(page, { secondPage: true });
    await expect(
      page.getByRole("button", { name: /Invite matched companies/ }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Invite 3 matched companies on Colabb on this page. Already invited companies are skipped.",
      ),
    ).toBeVisible();
    for (const logo of await page.locator(".match-card-logo").all())
      await logo.scrollIntoViewIfNeeded();
    await expect(page.locator(".match-card-logo img")).toHaveCount(3);
    for (const logo of await page.locator(".match-card-logo").all()) {
      const box = await logo.boundingBox();
      expect(box?.width).toBe(width > 700 ? 112 : 88);
      expect(box?.height).toBe(width > 700 ? 72 : 64);
    }
    expect(
      await page.locator(".match-card-logo img").evaluateAll((images) =>
        images.every((image) => {
          const r = image.getBoundingClientRect(),
            p = image.parentElement!.getBoundingClientRect();
          return (
            r.width <= p.width &&
            r.height <= p.height &&
            getComputedStyle(image).objectFit === "contain"
          );
        }),
      ),
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      page
        .getByRole("article", { name: "Unclaimed public listing", exact: true })
        .getByRole("button", { name: "Invite to Quote" }),
    ).toHaveCount(0);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM job_invitations WHERE job_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`job-matches-${width}.png`),
      fullPage: true,
    });
  });
}

test("single and group invitations persist, skip previous invites, then lead to real quotes", async ({
  page,
}) => {
  const id = await setup(page);
  let sends = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith(`/jobs/${id}/invite`))
      sends++;
  });
  const first = page.getByRole("article", {
    name: providers[0].name,
    exact: true,
  });
  await first
    .getByRole("button", { name: "Invite to Quote", exact: true })
    .click();
  await expect(first.locator(".match-invited")).toHaveText("Invited to quote");
  await expect(
    first.getByRole("link", { name: "Message", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(first.locator(".match-invited")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Invite matched companies/ }),
  ).toHaveText("Invite matched companies2");
  await page.getByRole("button", { name: /Invite matched companies/ }).click();
  await expect(
    page.getByRole("button", { name: "Companies invited", exact: true }),
  ).toBeDisabled();
  expect(sends).toBe(2);
  const rows = (
    await db.query(
      "SELECT provider_company_id::text id FROM job_invitations WHERE job_id=$1",
      [id],
    )
  ).rows;
  expect(rows.map((r) => r.id).sort()).toEqual(
    providers.map((p) => p.id).sort(),
  );
  expect(
    (
      await db.query("SELECT status, chosen_quote_id FROM jobs WHERE id=$1", [
        id,
      ])
    ).rows[0],
  ).toEqual({ status: "open", chosen_quote_id: null });
  const quote = await providers[0].actor.post(`/api/jobs/${id}/quote`, {
    data: {
      note: "Our installation team will complete the rooftop installation, electrical commissioning and inspection records, with a dedicated lead on site.",
      amountCents: 15000000,
      startWindow: "In two weeks",
      duration: "Four weeks",
    },
  });
  expect(quote.ok()).toBeTruthy();
  await page
    .locator(".match-job-ticket")
    .getByRole("link", { name: "View quotes", exact: true })
    .click();
  await expect(page.locator("#received-quotes")).toBeVisible();
  await expect(
    page
      .locator("#received-quotes")
      .getByText(providers[0].name, { exact: true })
      .first(),
  ).toBeVisible();
});

test("failed invitation keeps the company card and allows a safe retry", async ({
  page,
}) => {
  const id = await setup(page);
  await page.route(
    `**/api/jobs/${id}/invite`,
    (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: "Invitations are temporarily unavailable. Please try again.",
        },
      }),
    { times: 1 },
  );
  const card = page.getByRole("article", {
    name: providers[0].name,
    exact: true,
  });
  await card
    .getByRole("button", { name: "Invite to Quote", exact: true })
    .click();
  await expect(card.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    card.getByRole("button", { name: "Invite to Quote", exact: true }),
  ).toBeEnabled();
  await card
    .getByRole("button", { name: "Invite to Quote", exact: true })
    .click();
  await expect(card.locator(".match-invited")).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
});

test("expired jobs offer no invitation actions", async ({ page }) => {
  await setup(page, { expired: true });
  await expect(
    page.getByRole("button", { name: "Invite to Quote", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Invite matched companies/ }),
  ).toHaveCount(0);
});

test("members can review matches but cannot invite companies", async ({
  page,
}) => {
  try {
    // Create the job as the owner first, then downgrade before rendering.
    const id = await setup(page);
    await db.query("UPDATE memberships SET role='member' WHERE company_id=$1", [
      companyId,
    ]);
    await page.reload();
    await expect(
      page.getByRole("article", { name: providers[0].name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Invite to Quote", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Invite matched companies/ }),
    ).toHaveCount(0);
    const denied = await hirer.post(`/api/jobs/${id}/invite`, {
      data: { companyIds: [providers[0].id] },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await db.query("UPDATE memberships SET role='owner' WHERE company_id=$1", [
      companyId,
    ]);
  }
});

test("group invitation errors remain visible if the job closes before sending", async ({
  page,
}) => {
  const id = await setup(page);
  await db.query(
    "UPDATE jobs SET quote_deadline=now()-interval '1 day' WHERE id=$1",
    [id],
  );
  await page.getByRole("button", { name: /Invite matched companies/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "quote deadline has passed",
  );
  await expect(
    page.getByRole("button", { name: /Invite matched companies/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: providers[0].name, exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM job_invitations WHERE job_id=$1",
        [id],
      )
    ).rows[0].n,
  ).toBe(0);
});
