import { test, expect } from "@playwright/test";

test("one writing canvas formats the current paragraph and preserves a selected link", async ({
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
    .getByRole("button", { name: "Press release", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Story content" });
  await expect(editor).toHaveCount(1);
  await expect(dialog.getByLabel("Story subtitle")).toHaveCount(0);
  await expect(
    dialog.getByRole("toolbar", { name: "Text formatting" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/writing-empty-320.png" });
  await dialog.getByLabel("Story title").fill("A new chapter for local solar");
  await editor.click();
  await editor.pressSequentially("A new installation");
  await editor.press("Enter");
  await editor.pressSequentially("Built with local partners");
  await editor.press("Enter");
  await editor.pressSequentially(
    "Our team completed the community solar installation.",
  );
  await editor.press("Enter");
  await editor.pressSequentially("Read more");
  await expect(editor.locator("p")).toHaveCount(4);
  await editor.locator("p").nth(0).click();
  await dialog.getByRole("button", { name: "Heading", exact: true }).click();
  await expect(editor.locator("h2")).toHaveText("A new installation");
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
  await expect(editor.locator("h2")).toHaveText("A new installation");
  await expect(editor.locator("h3")).toHaveText("Built with local partners");
  await expect(editor.locator("a")).toHaveText("Read more");
  await page.screenshot({ path: "test-results/writing-formatted-320.png" });
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
      .filter((n: any) => n.type === "heading")
      .map((n: any) => n.attrs.level),
  ).toEqual([2, 3]);
  expect(JSON.stringify(release.document)).toContain(
    "https://example.com/project",
  );
  // Optional tools keep keyboard focus predictable; even a summary-only draft
  // must survive an immediate Close before the autosave timer can run.
  await page
    .getByRole("region", { name: "Create a post" })
    .getByRole("button", { name: "Press release", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Link", exact: true }).click();
  await expect(dialog.getByLabel("Link address")).toBeFocused();
  await dialog
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await expect(dialog.getByLabel("Link address")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Bold", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Add summary", exact: true })
    .click();
  await expect(dialog.getByLabel("Story subtitle")).toBeFocused();
  await dialog
    .getByLabel("Story subtitle")
    .fill("A summary saved before the headline is written.");
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const drafts = await (await context.request.get("/api/publications")).json();
  expect(
    drafts.some(
      (draft: any) =>
        draft.subtitle === "A summary saved before the headline is written.",
    ),
  ).toBe(true);
  await context.close();
});
