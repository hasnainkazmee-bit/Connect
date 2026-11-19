import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ids: string[] = [],
  suffix = randomUUID().slice(0, 8),
  userId = randomUUID(),
  privateJob = randomUUID(),
  demoJob = randomUUID();
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const description =
  "Installs commercial rooftop solar systems, handles electrical connections, and documents commissioning and handover for businesses.";
let first = "";
test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Isolated test database required");
  for (let i = 0; i < 35; i++) {
    const id = randomUUID(),
      slug = `seo-${suffix}-${i}`,
      service =
        i < 29 ? "solar-installation" : i < 33 ? "roofing" : "electrical",
      location =
        i < 29 ? "Cleveland, OH" : i < 33 ? "Atlanta, GA" : "Anchorage, AK",
      demo = i === 34;
    ids.push(id);
    if (!i) first = slug;
    await db.query(
      `INSERT INTO companies(id,slug,username,name,description,location,services,website,is_demo,listing_status) VALUES($1,$2,$2,$3,$4,$5,$6,'https://example.test',$7,'unclaimed')`,
      [
        id,
        slug,
        `SEO Company ${suffix} ${i}`,
        description,
        location,
        [service],
        demo,
      ],
    );
    await db.query(
      "INSERT INTO provider_profiles(company_id,project_types,updated_at) VALUES($1,ARRAY['Commercial'],now()-interval '1 minute')",
      [id],
    );
    await db.query(
      "INSERT INTO provider_capabilities(company_id,batch_id,research,checked_at,updated_at) VALUES($1,'seo-test','{}',now(),now())",
      [id],
    );
    await db.query(
      `UPDATE provider_matching_profiles m SET state='source_checked',source_batch_id='seo-test',checked_at=now(),valid_until=now()+interval '1 day',projected_at=now(),profile_snapshot=jsonb_build_object('type',c.type,'website',c.website,'services',c.services,'serviceAreas',c.service_areas,'trades',p.trades,'projectTypes',p.project_types) FROM companies c JOIN provider_profiles p ON p.company_id=c.id WHERE m.company_id=c.id AND c.id=$1`,
      [id],
    );
    await db.query(
      "INSERT INTO provider_offerings(company_id,id,kind,category_id,title,detail,delivery,sectors) VALUES($1,'main','service',$2,$3,$4,'specialist-service',ARRAY['commercial'])",
      [
        id,
        service,
        service === "roofing"
          ? "Commercial roofing"
          : "Commercial solar installation",
        description,
      ],
    );
  }
  // A company serving Ohio from another state must say so. State coverage must
  // not imply service in every city, and names must never classify a service.
  await db.query("UPDATE companies SET location='Erie, PA' WHERE id=$1", [
    ids[28],
  ]);
  await db.query(
    "INSERT INTO provider_coverage_areas(company_id,id,label,kind,country_code,state_code) VALUES($1,'ohio','Ohio','state','US','OH')",
    [ids[28]],
  );
  await db.query(
    "INSERT INTO provider_coverage_offerings(company_id,area_id,offering_id) VALUES($1,'ohio','main')",
    [ids[28]],
  );
  await db.query(
    "UPDATE companies SET name='Roofing name but electrical service' WHERE id=$1",
    [ids[33]],
  );
  await db.query("UPDATE companies SET name=$2 WHERE id=$1", [
    ids[0],
    "SEO Company <script>window.seoInjected=1</script>",
  ]);
  await db.query(
    "INSERT INTO company_username_history(username,company_id) VALUES($1,$2)",
    ["old-" + suffix, ids[0]],
  );
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'SEO fixture','not-a-login')",
    [userId, `seo-${suffix}@example.test`],
  );
  await db.query(
    "INSERT INTO jobs(id,hiring_company_id,author_id,title,description,trade,location,visibility,exact_address) VALUES($1,$2,$3,'PRIVATE SEO CANARY','This private equipment sourcing brief must never appear in public HTML.','other','Cleveland, OH','invite_only','SECRET ADDRESS CANARY')",
    [privateJob, ids[0], userId],
  );
  await db.query(
    "INSERT INTO jobs(id,hiring_company_id,author_id,title,description,trade,location) VALUES($1,$2,$3,'DEMO SEO CANARY','This demonstration job must never enter public search content.','other','Cleveland, OH')",
    [demoJob, ids[0], userId],
  );
});
test.afterAll(async () => {
  await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [
    [privateJob, demoJob],
  ]);
  await db.query("DELETE FROM users WHERE id=$1", [userId]);
  await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
  await db.end();
});
const canonical = (html: string) =>
  html.match(/rel="canonical" href="([^"]+)"/)?.[1];
const schemas = (html: string) =>
  [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1]));

test("clean service, state and city pages contain real companies without JavaScript", async ({
  request,
  baseURL,
}) => {
  for (const path of [
    "/services",
    "/services/solar-installation",
    "/services/solar-installation/ohio",
    "/services/roofing/georgia/atlanta",
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(canonical(html)).toBe(baseURL + path);
    expect(html).toContain("index,follow,max-image-preview:large");
    expect(html).toContain("application/ld+json");
    expect(html).not.toContain("Enable JavaScript");
    expect(
      schemas(html)[0]["@graph"].some(
        (v: any) => v["@type"] === "CollectionPage",
      ),
    ).toBe(true);
    expect(html).not.toMatch(/href="\/services[^" ]*\?/);
  }
  const ohio = await (
    await request.get("/services/solar-installation/ohio/page/2")
  ).text();
  expect(canonical(ohio)).toBe(
    baseURL + "/services/solar-installation/ohio/page/2",
  );
  expect(
    ohio +
      (await (await request.get("/services/solar-installation/ohio")).text()),
  ).toContain("Recorded service area: Ohio");
  expect(ohio).not.toContain("SEO Company " + suffix + " 34");
  const atlanta = await (
    await request.get("/services/roofing/georgia/atlanta")
  ).text();
  expect(atlanta).toContain("Based in Atlanta, GA");
  expect(atlanta).not.toContain("Roofing name but electrical service");
  expect(
    (await request.get("/services/roofing/georgia/atlantaaaa")).status(),
  ).toBe(404);
  expect((await request.get("/services/not-a-service")).status()).toBe(404);
  expect(
    (await request.get("/services/roofing/georgia/atlanta/page/9999")).status(),
  ).toBe(404);
  expect(
    (
      await request.get("/services/solar-installation/ohio/page/1", {
        maxRedirects: 0,
      })
    ).headers().location,
  ).toBe("/services/solar-installation/ohio");
  const sparse = await (
    await request.get("/services/electrical/alaska/anchorage")
  ).text();
  expect(sparse).toContain("noindex,follow");
});

test("social cards, safe schema, aliases, help content and sitemap obey the same indexing policy", async ({
  request,
  baseURL,
}) => {
  const profile = await (await request.get("/" + first)).text();
  expect(profile).toContain(description);
  expect(profile).toContain("Overview");
  expect(profile).toContain("Commercial solar installation");
  expect(canonical(profile)).toBe(baseURL + "/" + first);
  expect(profile).toContain("\\u003cscript>");
  expect(profile).not.toContain("<script>window.seoInjected=1</script>");
  const data = schemas(profile)[0]["@graph"];
  expect(
    data.find((x: any) => x["@type"] === "Organization").hasOfferCatalog
      .itemListElement[0].itemOffered["@type"],
  ).toBe("Service");
  expect(data.some((x: any) => x["@type"] === "AggregateRating")).toBe(false);
  const alias = await request.get("/old-" + suffix, { maxRedirects: 0 });
  expect(alias.status()).toBe(301);
  expect(alias.headers().location).toBe("/" + first);
  const home = await (await request.get("/?utm_source=test")).text();
  expect(canonical(home)).toBe(baseURL + "/");
  expect(home).toContain('property="og:image"');
  expect(home).toContain('name="twitter:card" content="summary_large_image"');
  expect(
    (await request.get("/brand/colabb-social-preview.png")).headers()[
      "content-type"
    ],
  ).toContain("image/png");
  const payments = await (await request.get("/help/payments")).text();
  expect(payments).toContain("No escrow or payment processing");
  expect(payments).toContain("Payments are arranged directly");
  expect((await request.get("/help/not-real")).status()).toBe(404);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/services/solar-installation/ohio</loc>");
  expect(sitemap).toContain("/services/roofing/georgia/atlanta</loc>");
  expect(sitemap).not.toContain("/services/electrical/alaska/anchorage");
  expect(sitemap).not.toContain("seo-" + suffix + "-34");
  expect(
    [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].every(
      (m) => !m[1].includes("?"),
    ),
  ).toBe(true);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /api/company-assets/");
  expect(robots).toContain("Allow: /api/public-page?");
  expect(
    (await request.get("/api/public-page?path=/")).headers()["x-robots-tag"],
  ).toBe("noindex");
  const filters = await (await request.get("/providers?trade=Roofing")).text();
  expect(filters).toContain("noindex,follow");
  expect(canonical(filters)).toBe(baseURL + "/providers");
  const page = await request.get("/providers?page=2", { maxRedirects: 0 });
  expect(page.headers().location).toBe("/providers/page/2");
  const jobs = await (await request.get("/jobs")).text();
  expect(jobs).not.toContain("PRIVATE SEO CANARY");
  expect(jobs).not.toContain("DEMO SEO CANARY");
  const secret = await (await request.get("/jobs/" + privateJob)).text();
  expect(secret).toContain("noindex,follow");
  expect(secret).not.toContain("SECRET ADDRESS CANARY");
  expect(secret).not.toContain("PRIVATE SEO CANARY");
  expect(
    (await request.get("/api/public-page?path=https://example.com")).status(),
  ).toBe(400);
});

test("service pages work without scripts and remain readable on phones", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(baseURL + "/services/roofing/georgia/atlanta");
  await expect(
    page.getByRole("heading", {
      name: "Roofing companies in Atlanta, GA",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View company", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/colabb-seo-mobile.png",
    fullPage: true,
  });
  await context.close();
});

test("SPA navigation replaces canonical and structured data, and removes public schema in account screens", async ({
  page,
  baseURL,
}) => {
  await page.goto("/services");
  await page.getByRole("link", { name: /Solar installers/ }).click();
  await expect(
    page.getByRole("heading", { name: "Solar installers", exact: true }),
  ).toBeVisible();
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    baseURL + "/services/solar-installation",
  );
  await page.getByRole("link", { name: /Ohio \d+ companies/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Solar installers in Ohio",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#colabb-startup")).toHaveCount(0);
  await page.screenshot({ path: "test-results/colabb-seo-desktop.png" });
  // Footer uses React navigation rather than a document reload.
  await page
    .getByRole("link", { name: "Agreements & payments", exact: true })
    .click();
  await expect(page).toHaveTitle(/Agree the work. Record the payment/);
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    baseURL + "/help/payments",
  );
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("meta[name=robots]")).toHaveAttribute(
    "content",
    "noindex,follow",
  );
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    0,
  );
});

test('company-directory pagination uses clean paths and resetting filters returns to page one',async({page,baseURL})=>{
 await page.goto('/providers');
 await expect(page.locator('.cd-company').first()).toBeVisible();
 await page.getByRole('navigation',{name:'Company pages'}).getByRole('link',{name:'Next',exact:true}).click();
 await expect(page).toHaveURL(baseURL+'/providers/page/2');
 await expect(page.getByRole('navigation',{name:'Company pages'})).toContainText('Page 2');
 await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',baseURL+'/providers/page/2');
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await expect(page).toHaveURL(baseURL+'/providers');
 await expect(page.getByRole('navigation',{name:'Company pages'})).toContainText('Page 1');
});
