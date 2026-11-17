import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

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

// The startup animation leaves the rendered app inert until its reveal finishes.
// Playwright's fill can resolve against an inert input without changing its value.
async function openReady(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
}

test("Network keeps sidebars anchored, hides scrollbar chrome and fits phone navigation", async ({
  page,
  request,
  baseURL,
}) => {
  const f = await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  // The refill assertion needs at least four other companies, even on a fresh DB.
  for (let i = 0; i < 4; i++) {
    await fixture(request, baseURL!);
  }
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
      await openReady(page, path);
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
  await openReady(page, "/network");
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
  await openReady(page, "/network");
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
  await openReady(page, `/network/posts/${f.post.id}`);
  await expect(page.getByRole("heading", { name: /Comments/ })).toBeVisible();
  await page.getByRole("button", { name: "Save post", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unsave post", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(/^Comment as /)
    .fill("The site plans are ready to review.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page
      .locator(".nw-comment")
      .getByText("The site plans are ready to review.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Read 1 comment", exact: true }),
  ).toHaveText("1");
  await page.reload();
  await expect(
    page
      .locator(".nw-comment")
      .getByText("The site plans are ready to review.", { exact: true }),
  ).toBeVisible();
  await openReady(page, "/network/saved");
  await expect(
    page.getByText(
      "A rooftop installation, from planning to the final checks.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "View post and comments, image 1 of 1",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/network/posts/${f.post.id}$`));
  await expect(page.locator(".nw-file-viewer")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Read 1 comment", exact: true })
    .click();
  await expect(page.locator("#network-comment")).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const comment = page
    .locator(".nw-comment")
    .filter({ hasText: "The site plans are ready to review." });
  await comment.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByLabel(/^Reply as /)
    .fill("The electrical drawings are attached to the job.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Read 2 comments", exact: true }),
  ).toHaveText("2");
  const replyText = page.getByText(
    "The electrical drawings are attached to the job.",
    { exact: true },
  );
  await expect(replyText).toBeVisible();
  await page.getByRole("button", { name: "Hide reply", exact: true }).click();
  await expect(replyText).not.toBeVisible();
  await page.getByRole("button", { name: "View 1 reply", exact: true }).click();
  await expect(replyText).toBeVisible();
  await comment.getByRole("button", { name: "Delete", exact: true }).click();
  await comment
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Read 1 comment", exact: true }),
  ).toHaveText("1");
  await expect(
    page.getByText("The electrical drawings are attached to the job.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Comments 1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Read 1 comment", exact: true }),
  ).toHaveText("1");
  await expect(replyText).not.toBeVisible();
  await page.getByRole("button", { name: "View 1 reply", exact: true }).click();
  await expect(replyText).toBeVisible();
});

test("Community visibility choices fit their labels on desktop and phone", async ({
  page,
  request,
  baseURL,
}) => {
  await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  await openReady(page, "/network/communities/new");
  for (const width of [1580, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const choices = page.locator(".nc-options label");
    await expect(choices).toHaveCount(2);
    const boxes = await choices.evaluateAll((labels) =>
      labels.map((label) => {
        const radio = label.querySelector("input")!.getBoundingClientRect();
        const text = label.querySelector("span")!.getBoundingClientRect();
        const box = label.getBoundingClientRect();
        return {
          width: radio.width,
          height: radio.height,
          contains:
            text.left >= box.left &&
            text.right <= box.right &&
            text.bottom <= box.bottom,
          separated: text.left >= radio.right,
        };
      }),
    );
    for (const box of boxes) {
      expect(box.width).toBeLessThanOrEqual(24);
      expect(box.height).toBeLessThanOrEqual(24);
      expect(box.contains).toBeTruthy();
      expect(box.separated).toBeTruthy();
    }
    await expect(page.locator("#colabb-startup")).toHaveCount(0);
    await page.locator(".nc-options").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`community-choices-${width}.png`),
    });
    await page.getByRole("radio", { name: /Private/ }).check();
    await expect(page.getByRole("radio", { name: /Private/ })).toBeChecked();
    await expect(page.getByLabel("How people join")).toHaveValue("approval");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
});

test("Hosts configure the only post types shown to members, and published labels survive later edits", async ({
  page,
  request,
  baseURL,
}) => {
  const f = await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  await openReady(page, `/network/communities/${f.community.id}`);
  await page
    .getByRole("button", { name: "New post", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Post type (optional)", exact: true }),
  ).toHaveCount(0);
  await openReady(page, `/network/communities/${f.community.id}`);
  await page
    .getByRole("button", { name: "Community settings", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/communities/${f.community.id}/manage/settings$`),
  );
  await page
    .getByRole("navigation", { name: "Community settings" })
    .getByRole("button", { name: "Post types", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add your first post type", exact: true })
    .click();
  await page
    .getByLabel("Type name", { exact: true })
    .fill("Need surplus modules");
  await page
    .getByLabel("How this type works", { exact: true })
    .selectOption("sourcing");
  await page
    .getByRole("button", { name: "Save post types", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save post types", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("community-post-types.png"),
  });
  await page
    .getByRole("button", { name: "View community", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New post", exact: true })
    .first()
    .click();
  const type = page.getByRole("combobox", {
    name: "Post type (optional)",
    exact: true,
  });
  await expect(type.locator("option")).toHaveText([
    "No post type",
    "Need surplus modules",
  ]);
  await type.selectOption({ label: "Need surplus modules" });
  await page
    .getByLabel("Discussion title", { exact: true })
    .fill("Two pallets needed in Ohio");
  await page
    .getByLabel("Discussion details", { exact: true })
    .fill(
      "We need two pallets of solar modules for the upcoming installation.",
    );
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/network\/posts\//);
  const postUrl = page.url();
  await expect(page.locator(".nw-post-copy .nw-badge")).toHaveText(
    "Need surplus modules",
  );
  await page.getByLabel(/^Comment as /).fill("What wattage is needed?");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Read 1 comment", exact: true }),
  ).toContainText("1");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#network-comment")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`community-discussion-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openReady(
    page,
    `/network/communities/${f.community.id}/manage/post-types`,
  );
  await page.getByLabel("Type name", { exact: true }).fill("Module requests");
  await page
    .getByRole("button", { name: "Save post types", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save post types", exact: true }),
  ).toBeDisabled();
  await openReady(page, postUrl);
  await expect(page.locator(".nw-post-copy .nw-badge")).toHaveText(
    "Need surplus modules",
  );
  await expect(
    page.getByRole("button", { name: "Read 1 comment", exact: true }),
  ).toContainText("1");
});

test("Composer attachment controls never publish and edited posts warn before leaving", async ({
  page,
  request,
  baseURL,
}) => {
  const f = await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  await openReady(page, "/network");
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
  await openReady(page, `/network/posts/${f.post.id}/edit`);
  await page
    .getByLabel("Post caption", { exact: true })
    .fill("An unsaved edit that must not disappear silently.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Keep editing|Stay/ }),
  ).toBeVisible();
  expect(publishes).toEqual([]);
});

test("Photo selection order survives parallel uploads and photo adjustments", async ({
  page,
  request,
  baseURL,
}) => {
  await fixture(request, baseURL!);
  await page.context().addCookies((await request.storageState()).cookies);
  const photo = await readFile("apps/colabb/public/assets/solar.jpg");
  // The first selected photo deliberately finishes last.
  await page.route("**/api/network-v2/files?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("name") === "first.jpg")
      await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openReady(page, `/network/compose/${randomUUID()}`);
    await page
      .getByLabel("Post caption", { exact: true })
      .fill("Local photo-order check.");
    const pickerPromise = page.waitForEvent("filechooser");
    await page.locator(".nw-upload").click();
    await (
      await pickerPromise
    ).setFiles([
      { name: "first.jpg", mimeType: "image/jpeg", buffer: photo },
      { name: "second.jpg", mimeType: "image/jpeg", buffer: photo },
    ]);
    const attachments = page.locator(".nw-attachment-manager > div");
    await expect(attachments).toHaveCount(2);
    await expect(attachments.nth(0)).toContainText("first.jpg");
    await expect(attachments.nth(1)).toContainText("second.jpg");
    await attachments
      .nth(0)
      .getByRole("button", { name: "Adjust", exact: true })
      .click();
    await page
      .getByRole("radio", { name: "Fit whole photo", exact: true })
      .check();
    await expect(
      page.getByRole("slider", { name: "Zoom", exact: true }),
    ).toHaveCount(0);
    const frame = await page.locator(".nw-fit-frame").boundingBox();
    expect(frame).not.toBeNull();
    expect(frame!.width / frame!.height).toBeCloseTo(4 / 5, 2);
    expect(frame!.height).toBeLessThanOrEqual(550);
    await page
      .getByRole("button", { name: "Use this photo", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "New post", exact: true }),
    ).toBeVisible();
    await expect(attachments).toHaveCount(2);
    await expect(attachments.nth(0)).toContainText("first.jpg");
    await expect(attachments.nth(1)).toContainText("second.jpg");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page).toHaveURL(/\/network\/posts\//);
    const postId = new URL(page.url()).pathname.split("/").at(-1);
    const result = await request.get(`/api/network-v2/posts/${postId}`);
    expect(result.ok()).toBeTruthy();
    expect(
      (await result.json()).post.files.map(
        (file: { name: string }) => file.name,
      ),
    ).toEqual(["first.jpg", "second.jpg"]);
  }
});
