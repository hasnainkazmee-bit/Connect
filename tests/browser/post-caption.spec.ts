import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const width of [1440, 390]) {
  test(`legacy Post images stay separate from every caption block at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: process.env.API_TEST_URL || "http://localhost:4101",
      viewport: { width, height: 960 },
    });
    const owner = await (
      await context.request.post("/api/auth/register", {
        data: {
          name: "Caption Editor",
          email: `caption-${Date.now()}-${width}@example.test`,
          password: "ConnectCaption123!",
          companyName: `Caption Studio ${width} ${Date.now()}`,
        },
      })
    ).json();
    const draft = await (
      await context.request.post("/api/publications", {
        data: { kind: "post" },
      })
    ).json();
    const page = await context.newPage();
    const portrait = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 640;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#edf4fa";
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#ff6b0b";
      ctx.fillRect(48, 48, 264, 544);
      ctx.fillStyle = "#203342";
      ctx.font = "24px sans-serif";
      ctx.fillText("Portrait fixture", 90, 320);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const media = [];
    for (const file of [
      {
        name: "landscape.jpg",
        mimeType: "image/jpeg",
        buffer: await readFile("apps/web/public/assets/solar.jpg"),
      },
      {
        name: "portrait.png",
        mimeType: "image/png",
        buffer: Buffer.from(portrait, "base64"),
      },
    ]) {
      const uploaded = await context.request.post(
        `/api/publications/${draft.id}/media`,
        { multipart: { file } },
      );
      expect(uploaded.status()).toBe(201);
      media.push(await uploaded.json());
    }
    const caption = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Solar project progress: every caption stays above the photos.",
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "A quoted detail worth keeping.",
                  marks: [{ type: "bold" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "The final line belongs to the caption too.",
            },
          ],
        },
      ],
    };
    const saved = await context.request.patch(`/api/publications/${draft.id}`, {
      data: {
        kind: "post",
        status: "draft",
        version: draft.version,
        document: caption,
      },
    });
    expect(saved.status()).toBe(200);
    // Simulate an older saved Post using real owned media. The current API no longer writes this layout.
    const legacy = {
      type: "doc",
      content: [
        caption.content[0],
        {
          type: "image",
          attrs: {
            src: media[0].url,
            alt: "Landscape project",
            title: "The original photo caption also survives.",
          },
        },
        caption.content[1],
        {
          type: "image",
          attrs: { src: media[1].url, alt: "Portrait project" },
        },
        caption.content[2],
      ],
    };
    await page.route(`**/api/posts/${draft.id}`, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, document: legacy } });
    });
    await page.goto(`/company/${owner.activeCompanyId}`);
    await page.getByRole("button", { name: "Drafts", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: /Solar project progress/ })
      .click();
    const editor = dialog.getByRole("textbox", { name: "Update content" });
    await expect(
      dialog.getByRole("button", { name: "Post", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator("img")).toHaveCount(0);
    await expect(editor).toContainText(
      "The original photo caption also survives.",
    );
    await expect(editor).toContainText(
      "The final line belongs to the caption too.",
    );
    await expect(editor.locator("blockquote strong")).toHaveText(
      "A quoted detail worth keeping.",
    );
    await expect(
      dialog.locator(".publisher-canvas .photo-track img"),
    ).toHaveCount(2);
    await dialog
      .getByRole("button", { name: "Press release", exact: true })
      .click();
    await expect(editor.locator("img")).toHaveCount(2);
    await expect(editor.locator("img").first()).toHaveAttribute(
      "title",
      "The original photo caption also survives.",
    );
    await dialog.getByRole("button", { name: "Post", exact: true }).click();
    await expect(editor.locator("img")).toHaveCount(0);
    await editor.press("ControlOrMeta+End");
    await editor.press("Enter");
    await editor.pressSequentially("Caption edits survive switching formats.");
    await dialog
      .getByRole("button", { name: "Press release", exact: true })
      .click();
    await expect(editor).toContainText(
      "Caption edits survive switching formats.",
    );
    await expect(editor.locator("img")).toHaveCount(2);
    expect(
      (await editor.innerText()).split(
        "The original photo caption also survives.",
      ).length - 1,
    ).toBe(1);
    await expect(editor.locator("img").first()).not.toHaveAttribute("title");
    await dialog.getByRole("button", { name: "Post", exact: true }).click();
    await page.screenshot({
      path: `test-results/post-legacy-composer-${width}.png`,
    });
    await dialog
      .getByRole("button", { name: "Save & close", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.unroute(`**/api/posts/${draft.id}`);
    const normalized = await (
      await context.request.get(`/api/posts/${draft.id}`)
    ).json();
    expect(JSON.stringify(normalized.document)).not.toContain('"type":"image"');
    expect(normalized.body).toContain(
      "Caption edits survive switching formats.",
    );
    expect(normalized.media).toHaveLength(2);
    expect(
      normalized.body.split("The original photo caption also survives.")
        .length - 1,
    ).toBe(1);
    await page.getByRole("button", { name: "Drafts", exact: true }).click();
    await dialog
      .getByRole("button", { name: /Solar project progress/ })
      .click();
    await expect(editor.locator("img")).toHaveCount(0);
    await expect(dialog.locator(".photo-track img")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.goto(`/posts/${draft.id}`);
    const post = page.locator(".feed-post"),
      frame = post.locator(".photo-track");
    await expect(post.locator(".story-prose img")).toHaveCount(0);
    for (const index of [0, 1]) {
      if (index)
        await post
          .getByRole("button", { name: "Next photo", exact: true })
          .click();
      await expect(post.locator(".photo-pagination [role=status]")).toHaveText(
        `${index + 1} / 2`,
      );
      await expect
        .poll(() =>
          frame.evaluate(
            (el, selected) =>
              Math.abs(el.scrollLeft - selected * el.clientWidth),
            index,
          ),
        )
        .toBeLessThan(1);
      const selectedImage = frame.locator("img").nth(index);
      await selectedImage.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          selectedImage.evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const bounds = await frame.boundingBox();
      expect(bounds!.width / bounds!.height).toBeCloseTo(1, 2);
      expect(
        await frame
          .locator("img")
          .nth(index)
          .evaluate((el) => getComputedStyle(el).objectFit),
      ).toBe("contain");
      const order = await post.evaluate(
        (el) =>
          el.querySelector(".post-body")!.getBoundingClientRect().bottom <=
          el.querySelector(".post-media")!.getBoundingClientRect().top + 1,
      );
      expect(order).toBe(true);
      await post.screenshot({
        path: `test-results/post-square-${index ? "portrait" : "landscape"}-${width}.png`,
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await context.close();
  });
}
