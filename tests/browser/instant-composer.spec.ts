import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const company = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Solar Studio",
    username: "solar-studio",
    role: "owner",
    type: "Installer",
    location: "Austin",
    services: [],
    service_areas: [],
  };
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let draftWrites = 0;
  const saved: any[] = [];
  await page.route(
    /\/(?:assets\/publishing-[^/]+\.js|src\/publishing\.tsx)(?:\?.*)?$/,
    async (route) => {
      await blocked;
      await route.continue();
    },
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: any = {};
    if (path === "/api/session")
      json = {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Editor",
          email: "editor@example.test",
          account_type: "company",
          email_verified_at: "2026-01-01",
          onboarding_completed_at: "2026-01-01",
        },
        companies: [company],
        activeCompanyId: company.id,
      };
    else if (path.endsWith("/events")) return route.abort();
    else if (path === "/api/feed") json = { posts: [], nextCursor: null };
    else if (path === "/api/network")
      json = {
        incoming: [],
        sent: [],
        connections: [],
        blocked: [],
        notifications: [],
      };
    else if (path === "/api/notifications")
      json = { notifications: [], unread: 0, nextCursor: null };
    else if (path === "/api/notifications/preferences")
      json = {
        messages: true,
        social: true,
        requests: true,
        team: true,
        updates: true,
        previews: false,
      };
    else if (path === "/api/companies")
      json = {
        companies: [company],
        total: 1,
        facets: { types: [], services: [], states: [] },
      };
    else if (path === "/api/social/suggestions") json = [];
    else if (
      path === "/api/publications" &&
      route.request().method() === "POST"
    ) {
      draftWrites++;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      json = {
        id: "33333333-3333-4333-8333-333333333333",
        version: 1,
        status: "draft",
      };
    } else if (path.startsWith("/api/publications/")) {
      draftWrites++;
      saved.push(route.request().postDataJSON());
      json = {
        id: "33333333-3333-4333-8333-333333333333",
        version: 2,
        status: "draft",
      };
    }
    await route.fulfill({ json });
  });
  return { release, writes: () => draftWrites, saved };
}
test("Create opens a writable box immediately while editor and draft network are delayed", async ({
  page,
}) => {
  const fixtureData = await fixture(page);
  const { release } = fixtureData;
  await page.goto("/");
  const launch = page.getByRole("button", {
    name: "What’s happening at your company?",
    exact: true,
  });
  await launch.waitFor();
  await page.evaluate(() => {
    const w = window as any;
    document.addEventListener(
      "click",
      () => {
        w.openedAt = performance.now();
      },
      { once: true, capture: true },
    );
    const observer = new MutationObserver(() => {
      if (document.querySelector(".publisher-instant-input")) {
        w.openDelay = performance.now() - w.openedAt;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await launch.click();
  const box = page.getByRole("textbox", { name: "Update content" });
  await expect(box).toBeEditable();
  expect(await page.evaluate(() => (window as any).openDelay)).toBeLessThan(
    100,
  );
  await box.fill(
    "Written before the tools arrive\nSecond paragraph stays intact.",
  );
  await page.waitForTimeout(1600);
  expect(fixtureData.writes()).toBe(0);
  await expect(box).toHaveValue(
    "Written before the tools arrive\nSecond paragraph stays intact.",
  );
  release();
  await expect(
    page.locator('.story-editor[contenteditable="true"]'),
  ).toBeVisible();
  await expect(page.locator(".story-editor")).toContainText(
    "Written before the tools arrive",
  );
  await expect(page.locator(".story-editor")).toContainText(
    "Second paragraph stays intact.",
  );
  await page.locator(".story-editor").press("End");
  await page.keyboard.type(" Still typing.");
  await expect(page.locator(".story-editor")).toContainText("Still typing.");
  await expect.poll(() => fixtureData.writes()).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/instant-composer.png" });
});

test("native navigation during the instant editor handoff saves text before leaving", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: navigator.userAgent + " ConnectWindows/0.1.1",
    });
    (window as any).chrome ||= {};
    (window as any).chrome.webview = { postMessage() {} };
  });
  const data = await fixture(page);
  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.type());
    void dialog.dismiss();
  });
  await page.goto("/network/connections");
  await expect(
    page.getByRole("heading", { name: "My Network", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("connect:windows-command", {
        detail: { type: "compose" },
      }),
    ),
  );
  const box = page.getByRole("textbox", { name: "Update content" });
  const text =
    "Keep this draft from the immediate editor.\nSecond paragraph too.";
  await box.fill(text);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("connect:windows-command", {
        detail: { type: "navigate", path: "/directory" },
      }),
    ),
  );
  await expect(box).not.toBeEditable();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/network\/connections$/);
  expect(data.writes()).toBe(0);
  expect(prompts).toEqual([]);
  data.release();
  await expect(page).toHaveURL(/\/directory$/, { timeout: 10000 });
  expect(data.saved).toHaveLength(1);
  expect(data.saved[0].body).toBe(text);
  expect(data.saved[0].status).toBe("draft");
  expect(prompts).toEqual([]);
});
