import { test, expect } from "@playwright/test";
import {
  editableDocument,
  publicationPresentation,
  writingHeadline,
  writingText,
} from "../../apps/web/src/publication-writing";

test("release presentation preserves rich headline marks and hard-break body text", () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Solar milestones",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "https://example.com" } },
            ],
          },
          { type: "hardBreak" },
          {
            type: "text",
            text: "The full project details stay here.",
            marks: [{ type: "italic" }],
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(document);
  const shown = publicationPresentation(document, "Solar milestones");
  expect(shown.headline.content[0].content[0].marks).toEqual(
    document.content[0].content[0].marks,
  );
  expect(shown.excerpt).toBe("The full project details stay here.");
  expect(shown.document.content[0].content[0].marks).toEqual([
    { type: "italic" },
  ]);
  expect(JSON.stringify(document)).toBe(before);
  expect(editableDocument(document, "", "Solar milestones", "")).toEqual(
    document,
  );
  expect(
    writingText(
      editableDocument(document, "", "Solar milestones", "A legacy summary."),
    ),
  ).toBe(
    "Solar milestones\nA legacy summary.\nThe full project details stay here.",
  );
});

test("headline truncation never splits an emoji and complex first blocks stay intact", () => {
  const long = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "a".repeat(179) + "🌞 project" }],
      },
    ],
  };
  expect(writingHeadline(long)).toBe("a".repeat(179));
  const code = {
    type: "doc",
    content: [
      {
        type: "codeBlock",
        content: [
          { type: "text", text: "Solar milestones\nTechnical details" },
        ],
      },
    ],
  };
  expect(publicationPresentation(code, "Solar milestones").document).toEqual(
    code,
  );
});

test("one canvas preserves writing through drafts, format changes and a failed publish", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
    viewport: { width: 320, height: 740 },
  });
  const suffix = Date.now();
  const response = await context.request.post("/api/auth/register", {
    data: {
      name: "Company Editor",
      email: `writing-${suffix}@example.test`,
      password: "ConnectWriting123!",
      companyName: `Fieldwork Solar ${suffix}`,
    },
  });
  expect(response.status()).toBe(201);
  const owner = await response.json();
  const page = await context.newPage();
  await page.goto("/");
  await page
    .getByRole("region", { name: "Create a post" })
    .getByRole("button", { name: "What’s happening at your company?" })
    .click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Update content" });
  await expect(editor).toHaveCount(1);
  await expect(dialog.getByLabel("Story title")).toHaveCount(0);
  await expect(dialog.getByLabel("Story subtitle")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Post", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog
    .getByRole("button", { name: "Press release", exact: true })
    .click();
  await page.screenshot({ path: "test-results/writing-empty-320.png" });
  await editor.fill(
    "A new chapter for local solar\nBuilt with local partners\nOur team completed the community solar installation.\nRead more",
  );
  await editor.locator("p").nth(0).click();
  await dialog.getByRole("button", { name: "Heading", exact: true }).click();
  await expect(editor.locator("h2")).toHaveText(
    "A new chapter for local solar",
  );
  await editor.locator("p").nth(0).click();
  await dialog.getByRole("button", { name: "Subheading", exact: true }).click();
  await expect(editor.locator("h3")).toHaveText("Built with local partners");
  await editor.locator("p").last().click();
  for (let i = 0; i < "Read more".length; i++) await editor.press("ArrowRight");
  for (let i = 0; i < "Read more".length; i++)
    await editor.press("Shift+ArrowLeft");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "Read more",
  );
  await dialog.getByRole("button", { name: "Link", exact: true }).click();
  await dialog.getByLabel("Link address").fill("https://example.com/project");
  await dialog.getByRole("button", { name: "Apply link", exact: true }).click();
  await expect(editor.locator("a")).toHaveText("Read more");
  await expect(editor.locator("a")).toHaveAttribute(
    "href",
    "https://example.com/project",
  );
  expect(await editor.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
    "none",
  );
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await dialog
    .getByRole("button", { name: "Save & close", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Drafts", exact: true })
    .first()
    .click();
  await dialog
    .getByRole("button", { name: /A new chapter for local solar/ })
    .click();
  await expect(editor.locator("h2")).toHaveText(
    "A new chapter for local solar",
  );
  await expect(editor.locator("h3")).toHaveText("Built with local partners");
  await expect(editor.locator("a")).toHaveText("Read more");
  const writing = await editor.textContent();
  await expect(
    dialog.getByRole("button", { name: "Press release", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(editor).toHaveText(writing!);
  await dialog
    .getByRole("button", { name: "Press release", exact: true })
    .click();
  await expect(editor).toHaveText(writing!);
  let fail = true;
  await page.route("**/api/publications/*", async (route) => {
    if (
      route.request().method() === "PATCH" &&
      route.request().postDataJSON().status === "published" &&
      fail
    ) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Could not publish. Your draft is safe.",
        }),
      });
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your draft is safe");
  await expect(editor).toHaveText(writing!);
  await page.screenshot({ path: "test-results/writing-choice-320.png" });
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const feed = await (
    await context.request.get(
      `/api/feed?companyId=${owner.activeCompanyId}&kind=press_release`,
    )
  ).json();
  const release = feed.posts.find(
    (p: any) => p.title === "A new chapter for local solar",
  );
  expect(
    release.document.content
      .filter((node: any) => node.type === "heading")
      .map((node: any) => node.attrs.level),
  ).toEqual([2, 3]);
  expect(JSON.stringify(release.document)).toContain(
    "https://example.com/project",
  );
  await page.goto(`/posts/${release.id}`);
  await expect(
    page
      .locator(".publication-card h2")
      .filter({ hasText: "A new chapter for local solar" }),
  ).toHaveCount(1);
  await expect(page.locator(".story-prose h3")).toHaveText(
    "Built with local partners",
  );
  await context.close();
});

test("explicit and guarded close lock the last draft snapshot while it saves", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
  });
  const suffix = Date.now();
  await context.request.post("/api/auth/register", {
    data: {
      name: "Careful Writer",
      email: `close-writing-${suffix}@example.test`,
      password: "ConnectWriting123!",
      companyName: `Careful Solar ${suffix}`,
    },
  });
  const page = await context.newPage();
  await page.goto("/");
  for (const method of ["Save & close", "Close dialog"]) {
    await page
      .getByRole("button", {
        name: "What’s happening at your company?",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    const editor = dialog.getByRole("textbox", { name: "Update content" });
    const writing = `A draft saved with ${method}. Every word here must survive.`;
    let release!: () => void, started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.route("**/api/publications/*", async (route) => {
      if (route.request().method() === "PATCH") {
        started();
        await pending;
      }
      await route.continue().catch(() => {});
    });
    try {
      await editor.fill(writing);
      await dialog.getByRole("button", { name: method, exact: true }).click();
      await requested;
      await expect(editor).toHaveAttribute("contenteditable", "false");
      await expect(
        dialog.getByRole("button", { name: "Save & close", exact: true }),
      ).toBeDisabled();
      await page.keyboard.type("This should not enter a closing draft");
      await expect(editor).toHaveText(writing);
      release();
      await expect(dialog).toHaveCount(0);
      const drafts = await (
        await context.request.get("/api/publications")
      ).json();
      expect(drafts.some((draft: any) => draft.body === writing)).toBe(true);
    } finally {
      release();
      await page.unroute("**/api/publications/*");
    }
  }
  await context.close();
});
