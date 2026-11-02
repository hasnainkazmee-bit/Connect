import { test, expect } from "@playwright/test";
import path from "node:path";

for (const width of [1440, 390]) {
  test(`press-release photos, descriptions, draft restore and preview at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: process.env.API_TEST_URL || "http://localhost:4101",
      viewport: { width, height: 960 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const suffix = `${Date.now()}-${width}`;
    const response = await context.request.post("/api/auth/register", {
      data: {
        name: "Release Editor",
        email: `release-${suffix}@example.test`,
        password: "ConnectRelease123!",
        companyName: `Release Studio ${suffix}`,
      },
    });
    expect(response.status()).toBe(201);
    const owner = await response.json();
    await page.goto("/company/" + owner.activeCompanyId);
    await page
      .getByRole("region", { name: "Create a post" })
      .getByRole("button", { name: "Press release", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog
        .getByRole("group", { name: "Publication format" })
        .getByRole("button"),
    ).toHaveCount(2);
    await expect(
      dialog
        .getByRole("group", { name: "Publication format" })
        .getByRole("button", { name: /Article|Case study/ }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("Story title")
      .fill("Solar storage arrives at the community centre");
    await dialog
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Add summary", exact: true })
      .click();
    await dialog
      .getByLabel("Story subtitle")
      .fill("A new installation built for reliable local energy.");
    await dialog
      .getByRole("textbox", { name: "Story content" })
      .fill(
        "Our team completed a solar and storage installation at the community centre. The project will support the next chapter for local energy.",
      );

    let picker = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: /Add a cover photo/ }).click();
    await (
      await picker
    ).setFiles(path.resolve("apps/web/public/assets/solar.jpg"));
    await expect(dialog.locator(".publisher-cover-slot img")).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
    await dialog.getByRole("button", { name: /Photos & files/ }).click();
    await dialog
      .getByLabel("Image description")
      .first()
      .fill("Solar panels on the community centre roof");
    await dialog.getByLabel("Story title").click();

    await dialog.getByRole("textbox", { name: "Story content" }).click();
    await page.keyboard.press("ControlOrMeta+End");
    picker = page.waitForEvent("filechooser");
    await dialog
      .getByRole("button", { name: "Insert photo", exact: true })
      .click();
    await (
      await picker
    ).setFiles(path.resolve("apps/web/public/assets/solar.jpg"));
    await expect(dialog.locator(".story-editor img")).toHaveCount(1);
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
    await dialog
      .getByLabel("Image description")
      .nth(1)
      .fill("Installation team checking the finished system");
    await dialog.getByLabel("Story title").click();
    await expect(dialog.locator(".story-editor img")).toHaveAttribute(
      "alt",
      "Installation team checking the finished system",
    );
    await dialog.getByRole("button", { name: "Save & close" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Drafts", exact: true }).click();
    await dialog.getByRole("button", { name: /Solar storage arrives/ }).click();
    await expect(dialog.getByLabel("Story title")).toHaveValue(
      "Solar storage arrives at the community centre",
    );
    await expect(dialog.locator(".publisher-cover-slot img")).toHaveAttribute(
      "alt",
      "Solar panels on the community centre roof",
    );
    await expect(dialog.locator(".story-editor img")).toHaveAttribute(
      "alt",
      "Installation team checking the finished system",
    );
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.locator(".publisher-preview img")).toHaveCount(2);
    await expect(dialog.getByLabel("Image description")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/press-release-photos-${width}.png`,
    });
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const publications = await (
      await context.request.get(
        "/api/feed?companyId=" + owner.activeCompanyId + "&kind=press_release",
      )
    ).json();
    const publication = publications.posts.find(
      (p: any) => p.title === "Solar storage arrives at the community centre",
    );
    expect(publication).toBeTruthy();
    expect(publication.media).toHaveLength(2);
    expect(publication.cover_media_id).toBe(publication.media[0].id);
    expect(
      publication.document.content.some(
        (n: any) =>
          n.type === "image" &&
          n.attrs.alt === "Installation team checking the finished system",
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("body-only drafts and partial photo batches survive editing and upload failure", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
    viewport: { width: 1100, height: 900 },
  });
  const suffix = Date.now();
  const owner = await (
    await context.request.post("/api/auth/register", {
      data: {
        name: "Draft Editor",
        email: `draft-${suffix}@example.test`,
        password: "ConnectDraft123!",
        companyName: `Draft Studio ${suffix}`,
      },
    })
  ).json();
  const draft = await (
    await context.request.post("/api/publications", {
      data: { kind: "article" },
    })
  ).json();
  const text =
    "This older draft contains a complete company announcement saved before the rich editor was available.";
  await context.request.patch("/api/publications/" + draft.id, {
    data: {
      kind: "article",
      title: "An older company announcement",
      body: text,
      document: null,
      status: "draft",
      version: draft.version,
    },
  });
  const page = await context.newPage();
  await page.goto("/company/" + owner.activeCompanyId);
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /An older company announcement/ })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Story content" }),
  ).toHaveText(text);
  await dialog
    .getByRole("group", { name: "Publication format" })
    .getByRole("button", { name: /^Post / })
    .click();
  await expect(dialog.getByText("Switch to a simple post?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep current format" }).click();
  await dialog.getByRole("button", { name: "Save & close" }).click();
  await expect(dialog).toHaveCount(0);
  const restored = await (
    await context.request.get("/api/posts/" + draft.id)
  ).json();
  expect(restored.body).toBe(text);
  expect(restored.document.content[0].content[0].text).toBe(text);
  expect(restored.kind).toBe("press_release");

  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await dialog
    .getByRole("button", { name: /An older company announcement/ })
    .click();
  let uploads = 0;
  await page.route("**/api/publications/*/media", async (route) => {
    if (route.request().method() === "POST" && ++uploads === 2)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The second photo could not upload. Try again.",
        }),
      });
    else await route.continue();
  });
  await dialog.getByRole("textbox", { name: "Story content" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  const picker = page.waitForEvent("filechooser");
  await dialog
    .getByRole("button", { name: "Insert photo", exact: true })
    .click();
  await (
    await picker
  ).setFiles([
    path.resolve("apps/web/public/assets/solar.jpg"),
    path.resolve("apps/web/public/assets/solar.jpg"),
  ]);
  await expect(dialog.getByRole("alert")).toContainText("second photo");
  const partial = await (
    await context.request.get("/api/posts/" + draft.id)
  ).json();
  expect(partial.body).toBe(text);
  expect(partial.media).toHaveLength(1);
  expect(
    partial.document.content.filter((n: any) => n.type === "image"),
  ).toHaveLength(1);
  await context.close();
});
