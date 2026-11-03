import { test, expect } from "@playwright/test";

test("direct Publish supersedes a slow preview save", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
    viewport: { width: 390, height: 844 },
  });
  const suffix = Date.now();
  const registered = await context.request.post("/api/auth/register", {
    data: {
      name: "Preview Editor",
      email: `preview-${suffix}@example.test`,
      password: "ConnectPreview123!",
      companyName: `Preview Studio ${suffix}`,
    },
  });
  expect(registered.status()).toBe(201);
  const owner = await registered.json();
  const created = await context.request.post("/api/publications", {
    data: { kind: "press_release" },
  });
  expect(created.status()).toBe(201);
  const draft = await created.json();
  const headline = "A new community rooftop is ready";
  const saved = await context.request.patch(`/api/publications/${draft.id}`, {
    data: {
      kind: "press_release",
      title: "",
      subtitle: "",
      status: "draft",
      version: draft.version,
      document: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: headline }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Our team completed the installation for the local community.",
              },
            ],
          },
        ],
      },
    },
  });
  expect(saved.status()).toBe(200);
  const page = await context.newPage();
  await page.goto(`/company/${owner.activeCompanyId}`);
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(headline) }).click();
  await expect(
    dialog.getByRole("textbox", { name: "Update content" }),
  ).toContainText(headline);

  let releaseSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    saveStarted = resolve;
  });
  await page.route(`**/api/publications/${draft.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      saveStarted();
      await pendingSave;
    }
    await route.continue();
  });
  try {
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await started;
    // Publish is a newer user intent while Preview's save is still pending.
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Publishing…", exact: false }),
    ).toBeDisabled();
    releaseSave();
    await expect(dialog).toHaveCount(0);
    const published = await (
      await context.request.get(`/api/posts/${draft.id}`)
    ).json();
    expect(published.status).toBe("published");
    expect(published.kind).toBe("press_release");
    expect(published.title).toBe(headline);
  } finally {
    releaseSave();
    await context.close();
  }
});
