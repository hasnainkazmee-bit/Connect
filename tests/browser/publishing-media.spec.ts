import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

for (const width of [1440, 390]) {
  test(`one-box photos preserve their appearance and pending descriptions at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: process.env.API_TEST_URL || "http://localhost:4101",
      viewport: { width, height: 960 },
    });
    const page = await context.newPage(),
      errors: string[] = [];
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
      .getByRole("button", { name: "What’s happening at your company?" })
      .click();
    const dialog = page.getByRole("dialog"),
      editor = dialog.getByRole("textbox", { name: "Update content" });
    await editor.fill(
      "Solar storage arrives at the community centre\nOur team completed a solar and storage installation. Built for reliable local energy.",
    );
    await editor.press("ControlOrMeta+End");
    const chooser = page.waitForEvent("filechooser");
    await dialog
      .getByRole("button", { name: "Add photo", exact: true })
      .click();
    await (
      await chooser
    ).setFiles(path.resolve("apps/web/public/assets/solar.jpg"));
    const adjustment = page.getByRole("dialog", {
      name: "Adjust photo",
      exact: true,
    });
    await expect(adjustment).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(adjustment).toHaveCount(0);
    await expect(editor.locator("img")).toHaveCount(0);
    await expect(editor).toContainText("Solar storage arrives");
    await expect(editor).toHaveAttribute("contenteditable", "true");
    const bytes = [...(await readFile("apps/web/public/assets/solar.jpg"))];
    await editor.evaluate(
      (element, data) => {
        const bounds = element.getBoundingClientRect();
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(data.bytes)], "solar.jpg", {
            type: "image/jpeg",
          }),
        );
        element.dispatchEvent(
          data.paste
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
                clientX: bounds.left + 20,
                clientY: bounds.top + 20,
              }),
        );
      },
      { bytes, paste: width === 1440 },
    );
    await expect(adjustment).toBeVisible();
    if (width === 1440) {
      await adjustment
        .getByRole("button", { name: "Square 1:1", exact: true })
        .click();
      await page.screenshot({
        path: "test-results/post-photo-adjust-square.png",
      });
      await adjustment
        .getByRole("button", { name: "Use photo", exact: true })
        .click();
    } else
      await adjustment
        .getByRole("button", { name: "Use original", exact: true })
        .click();
    await expect(editor.locator("img")).toHaveCount(1);
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
    const naturalRatio = await editor
      .locator("img")
      .evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight);
    if (width === 1440) expect(naturalRatio).toBeCloseTo(1, 2);
    const editRatio = await editor
      .locator("img")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().width / el.getBoundingClientRect().height,
      );
    expect(editRatio).toBeCloseTo(naturalRatio, 2);
    await dialog.getByRole("button", { name: /Photos & files/ }).click();
    await dialog
      .getByLabel("Image description")
      .fill("Solar panels on the community centre roof");
    await dialog
      .getByRole("button", { name: "Save & close", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Drafts", exact: true }).click();
    await dialog.getByRole("button", { name: /Solar storage arrives/ }).click();
    await expect(editor.locator("img")).toHaveAttribute(
      "alt",
      "Solar panels on the community centre roof",
    );
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.locator(".publisher-preview img")).toHaveCount(1);
    const previewRatio = await dialog
      .locator(".publisher-preview img")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().width / el.getBoundingClientRect().height,
      );
    expect(previewRatio).toBeCloseTo(editRatio, 2);
    await page.screenshot({
      path: `test-results/one-box-preview-${width}.png`,
    });
    await dialog.getByRole("button", { name: "Edit", exact: true }).click();
    const mediaToggle = dialog.getByRole("button", { name: /Photos & files/ });
    if ((await mediaToggle.getAttribute("aria-expanded")) !== "true")
      await mediaToggle.click();
    // Force the final Publish action to wait for a pending accessibility description.
    let releaseAlt: (() => void) | undefined;
    const pendingAlt = new Promise<void>((resolve) => {
      releaseAlt = resolve;
    });
    await page.route("**/api/publications/*/media/*", async (route) => {
      if (route.request().method() === "PATCH") await pendingAlt;
      await route.continue();
    });
    await dialog
      .getByLabel("Image description")
      .fill("The final accessible photo description");
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await dialog.getByRole("button", { name: "Update", exact: true }).click();
    releaseAlt!();
    await expect(dialog).toHaveCount(0);
    const feed = await (
      await context.request.get("/api/feed?companyId=" + owner.activeCompanyId)
    ).json();
    const publication = feed.posts[0];
    expect(publication.kind).toBe("post");
    expect(publication.title).toBe("");
    expect(publication.media).toHaveLength(1);
    expect(
      publication.document.content.find((node: any) => node.type === "image")
        .attrs.alt,
    ).toBe("The final accessible photo description");
    await page.goto("/posts/" + publication.id);
    const publishedImage = page.locator(".feed-post .story-prose img");
    await expect(publishedImage).toHaveCount(1);
    await expect(page.locator(".feed-post .photo-gallery")).toHaveCount(0);
    // The reader image is lazy-loaded and sizes itself from its intrinsic
    // dimensions. Being in the DOM does not mean those dimensions exist yet.
    await publishedImage.scrollIntoViewIfNeeded();
    await expect(publishedImage).toBeVisible();
    await expect
      .poll(() =>
        publishedImage.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        ),
      )
      .toBe(true);
    const publishedRatio = await publishedImage.evaluate(
      (el) =>
        el.getBoundingClientRect().width / el.getBoundingClientRect().height,
    );
    expect(publishedRatio).toBeCloseTo(editRatio, 2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("legacy title, subtitle, rich structure and partial uploads survive normalization", async ({
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
      data: { kind: "press_release" },
    })
  ).json();
  const text =
    "An older announcement saved before the continuous editor was available.";
  await context.request.patch("/api/publications/" + draft.id, {
    data: {
      kind: "press_release",
      title: "An older company announcement",
      subtitle: "A summary worth preserving.",
      body: text,
      document: null,
      status: "draft",
      version: draft.version,
    },
  });
  const page = await context.newPage();
  await page.goto("/company/" + owner.activeCompanyId);
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    editor = dialog.getByRole("textbox", { name: "Update content" });
  await dialog
    .getByRole("button", { name: /An older company announcement/ })
    .click();
  await expect(editor).toContainText("An older company announcement");
  await expect(editor).toContainText("A summary worth preserving.");
  await expect(editor).toContainText(text);
  await editor.locator("h2").fill("A revised announcement");
  await dialog
    .getByRole("button", { name: "Save & close", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const restored = await (
    await context.request.get("/api/posts/" + draft.id)
  ).json();
  expect(restored.title).toBe("");
  expect(restored.subtitle).toBe("");
  expect(restored.body).toContain("A revised announcement");
  expect(restored.body).toContain("A summary worth preserving.");
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await dialog.getByRole("button", { name: /A revised announcement/ }).click();
  await expect(editor.locator("h2")).toHaveText("A revised announcement");
  await expect(editor).not.toContainText("An older company announcement");
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
  await editor.click();
  await editor.press("ControlOrMeta+End");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Add photo", exact: true }).click();
  await (
    await chooser
  ).setFiles([
    path.resolve("apps/web/public/assets/solar.jpg"),
    path.resolve("apps/web/public/assets/solar.jpg"),
  ]);
  for (const number of [1, 2]) {
    await page
      .getByRole("dialog", { name: `Adjust photo ${number} of 2`, exact: true })
      .getByRole("button", { name: "Use original", exact: true })
      .click();
  }
  await expect(dialog.getByRole("alert")).toContainText("second photo");
  const partial = await (
    await context.request.get("/api/posts/" + draft.id)
  ).json();
  expect(partial.body).toContain(text);
  expect(partial.media).toHaveLength(1);
  expect(
    partial.document.content.filter((node: any) => node.type === "image"),
  ).toHaveLength(1);
  await context.close();
});

test("changing account aborts a pending upload and stops the remaining photo queue", async ({
  browser,
}) => {
  const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
  const context = await browser.newContext({ baseURL });
  const other = await browser.newContext({ baseURL });
  const suffix = Date.now(),
    password = "ConnectUpload123!",
    otherEmail = `next-upload-${suffix}@example.test`;
  for (const [client, name, email] of [
    [context, "Original", `first-upload-${suffix}@example.test`],
    [other, "Replacement", otherEmail],
  ] as const) {
    const result = await client.request.post("/api/auth/register", {
      data: {
        name,
        email,
        password,
        companyName: `${name} Upload Solar ${suffix}`,
      },
    });
    expect(result.status()).toBe(201);
  }
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "What’s happening at your company?",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Update content" })
    .fill("A draft owned by the original company.");
  let release!: () => void,
    started!: () => void,
    uploads = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/publications/*/media", async (route) => {
    if (route.request().method() === "POST") {
      uploads++;
      started();
      await pending;
      await route
        .fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Old upload response" }),
        })
        .catch(() => {});
    } else await route.continue();
  });
  try {
    await page
      .locator(".publisher input[type=file]")
      .setInputFiles([
        path.resolve("apps/web/public/assets/solar.jpg"),
        path.resolve("apps/web/public/assets/solar.jpg"),
      ]);
    await page
      .getByRole("dialog", { name: "Adjust photo 1 of 2", exact: true })
      .getByRole("button", { name: "Use original", exact: true })
      .click();
    await requested;
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (request) =>
        request.url().includes("/media") && request.method() === "POST",
    });
    await context.request.post("/api/auth/logout");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("connect:session-expired")),
    );
    const login = page
      .locator("dialog")
      .filter({ has: page.getByRole("heading", { name: "Welcome back." }) });
    await login.getByLabel("Work email", { exact: true }).fill(otherEmail);
    await login.getByLabel("Password", { exact: true }).fill(password);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".publisher")).toHaveCount(0);
    await aborted;
    release();
    await expect(
      page.getByRole("dialog", { name: "Adjust photo 2 of 2", exact: true }),
    ).toHaveCount(0);
    expect(uploads).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    release();
    await context.close();
    await other.close();
  }
});
