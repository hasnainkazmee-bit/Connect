import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function fixture(request: APIRequestContext, baseURL: string) {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL).hostname);
  const dbURL = new URL(process.env.DATABASE_URL!);
  expect(dbURL.pathname).toMatch(/_test$/);
  const suffix = randomUUID(),
    companyName = "Network browser " + suffix;
  const register = await request.post("/api/auth/register", {
    data: {
      name: "Network Owner",
      companyName,
      email: `${suffix}@example.test`,
      password: "NetworkBrowserTest123!",
    },
  });
  expect(register.status()).toBe(201);
  const { user, activeCompanyId } = await register.json();
  await request.post("/api/onboarding/complete", { data: { followIds: [] } });
  const db = new pg.Pool({ connectionString: dbURL.href });
  try {
    await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      user.id,
    ]);
  } finally {
    await db.end();
  }
  const image = await request.post("/api/network-v2/files?name=roof.jpg", {
    headers: { "content-type": "image/jpeg" },
    data: await readFile("apps/colabb/public/assets/solar.jpg"),
  });
  expect(image.ok()).toBeTruthy();
  const { file } = await image.json();
  const post = await request.post("/api/network-v2/posts", {
    data: {
      client_id: randomUUID(),
      kind: "post",
      body: "A rooftop installation, from planning to the final checks.",
      file_ids: [file.id],
      media_format: "1.91:1",
      comments_open: true,
    },
  });
  expect(post.ok()).toBeTruthy();
  const community = await request.post("/api/network-v2/communities", {
    data: {
      name: "Working together " + suffix,
      description: "A place to share practical installation experience.",
      visibility: "public",
      join_policy: "open",
      rules: [],
      topics: [],
      require_topic: false,
    },
  });
  expect(community.ok()).toBeTruthy();
  return {
    companyName,
    company: activeCompanyId,
    post: (await post.json()).post,
    community: (await community.json()).community,
  };
}

test("Network keeps sidebars anchored, hides scrollbar chrome and fits phone navigation", async ({
  page,
  request,
  baseURL,
}) => {
  const f = await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1882, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    let anchors: { x: number; y: number; width: number }[] | undefined;
    for (const path of [
      "/network",
      "/network/saved",
      "/network/communities",
      `/network/communities/${f.community.id}`,
      `/network/companies/${f.company}`,
    ]) {
      await page.goto(path);
      await expect(page.locator(".nw-workspace")).toBeVisible();
      await expect(page.locator(".nw-content [role=alert]")).toHaveCount(0);
      const current = await page
        .locator(".nw-sidebar, .nw-context")
        .evaluateAll((elements) =>
          elements.map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width };
          }),
        );
      if (anchors) expect(current).toEqual(anchors);
      else anchors = current;
      expect(
        await page
          .locator(".nw-content")
          .evaluate((e) => getComputedStyle(e).scrollbarWidth),
      ).toBe("none");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    }
  }
  await page.setViewportSize({ width: 1882, height: 900 });
  await page.goto("/network");
  const suggestions = page.locator(".nw-wide-suggestions .nw-suggestion");
  await expect(suggestions).toHaveCount(3);
  const names = await suggestions.locator("strong").allTextContents();
  await suggestions
    .first()
    .getByRole("button", { name: /Follow/ })
    .click();
  await expect(suggestions).toHaveCount(3);
  await expect(suggestions.first().locator("strong")).toHaveText(names[1]);
  await expect(suggestions.nth(1).locator("strong")).toHaveText(names[2]);
  await expect(
    suggestions.locator("strong").filter({ hasText: names[0] }),
  ).toHaveCount(0);
  await page.reload();
  await expect(suggestions).toHaveCount(3);
  await expect(
    suggestions.locator("strong").filter({ hasText: names[0] }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/network");
  await expect(page.locator(".nw-workspace")).toBeVisible();
  await expect(page.getByLabel("Network section")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  for (const label of ["Jobs", "My jobs", "Companies", "Network", "Inbox"])
    await expect(
      page
        .locator(".jobs-top-nav")
        .getByRole("link", { name: label, exact: true }),
    ).toBeInViewport();
  await page.getByLabel("Network section").selectOption("/communities");
  await expect(
    page.getByRole("heading", { name: "Find your people in solar." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Saved posts and focused comments persist through reload", async ({
  page,
  request,
  baseURL,
}) => {
  const f = await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/network/posts/${f.post.id}`);
  await expect(page.getByRole("heading", { name: /Comments/ })).toBeVisible();
  await page.getByRole("button", { name: "Save post", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unsave post", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("The site plans are ready to review.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page
      .locator(".nw-comment")
      .getByText("The site plans are ready to review.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator(".nw-comment")
      .getByText("The site plans are ready to review.", { exact: true }),
  ).toBeVisible();
  await page.goto("/network/saved");
  await expect(
    page.getByText(
      "A rooftop installation, from planning to the final checks.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Read comments", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/network/posts/${f.post.id}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Composer attachment controls never publish and edited posts warn before leaving", async ({
  page,
  request,
  baseURL,
}) => {
  const f = await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/network");
  await page.getByRole("button", { name: /^Share something from/ }).click();
  await page
    .getByLabel("Post caption", { exact: true })
    .fill("A draft that must stay private while previewing its photos.");
  const photo = await readFile("apps/colabb/public/assets/solar.jpg");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "roof-one.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "roof-two.jpg", mimeType: "image/jpeg", buffer: photo },
    {
      name: "plans.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nNetwork draft preview\n%%EOF"),
    },
  ]);
  await expect(page.locator(".nw-attachment-manager>div")).toHaveCount(3);
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const draftURL = page.url(),
    publishes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/network-v2/posts"
    )
      publishes.push(r.url());
  });
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await expect(page.locator(".nw-gallery-count")).toHaveText("2 / 2");
  await page.getByRole("button", { name: "Show image 1", exact: true }).click();
  await expect(page.locator(".nw-gallery-count")).toHaveText("1 / 2");
  await page.locator(".nw-gallery-slide").first().click();
  await expect(page.locator(".nw-file-viewer")).toBeVisible();
  expect(publishes).toEqual([]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(draftURL);
  await expect(page.getByLabel("Post caption", { exact: true })).toHaveValue(
    "A draft that must stay private while previewing its photos.",
  );
  await page.locator(".nw-documents .nw-file").click();
  await expect(page.locator(".nw-file-viewer iframe")).toBeVisible();
  expect(publishes).toEqual([]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(draftURL);
  await page.goto(`/network/posts/${f.post.id}/edit`);
  await page
    .getByLabel("Post caption", { exact: true })
    .fill("An unsaved edit that must not disappear silently.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Keep editing|Stay/ }),
  ).toBeVisible();
  expect(publishes).toEqual([]);
});
