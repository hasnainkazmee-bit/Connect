import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.describe("Colabb access and interface selection", () => {
  test.beforeAll(async ({ baseURL }) => {
    // These tests create accounts through the API and belong to the local test
    // database runner, never a production smoke run.
    expect(baseURL).toBeTruthy();
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
  });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    test(`marketing job access returns from full-page sign-in at ${viewport.width}px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      const suffix = randomUUID();
      const email = `colabb-access-${suffix}@example.test`;
      const password = "ColabbAccessTest123!";
      const registered = await request.post("/api/auth/register", {
        data: {
          name: "Colabb Access Owner",
          companyName: "Colabb Access Solar " + suffix,
          email,
          password,
        },
      });
      expect(registered.status()).toBe(201);
      const owner = await registered.json();
      const completed = await request.post("/api/onboarding/complete", {
        data: { followIds: [] },
      });
      expect(completed.ok()).toBeTruthy();

      // The request fixture has its own cookie jar; the browser remains public.
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /No one builds/ }),
      ).toBeVisible();
      if (viewport.width < 900) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        await page
          .getByRole("navigation", { name: "Mobile navigation" })
          .getByRole("link", { name: "Post a job", exact: true })
          .click();
      } else {
        await page
          .getByRole("banner")
          .getByRole("link", { name: "Post a job", exact: true })
          .click();
      }
      const gate = page.getByRole("heading", {
        name: "Good help starts here.",
        exact: true,
      });
      await expect(page).toHaveURL(/\/jobs\/new$/);
      await expect(gate).toBeVisible();
      await page
        .getByRole("button", { name: "Sign in to post a job", exact: true })
        .click();
      const welcome = page.getByRole("heading", {
        name: "Welcome back.",
        exact: true,
      });
      await expect(welcome).toBeVisible();
      await expect(page).toHaveURL(/\/actions\/[a-f0-9-]+$/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(gate).not.toBeVisible();

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/jobs\/new$/);
      await expect(gate).toBeVisible();
      await expect(welcome).not.toBeVisible();

      await page
        .getByRole("button", { name: "Sign in to post a job", exact: true })
        .click();
      await expect(welcome).toBeVisible();
      await page.getByLabel("Email address", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page
        .locator("form")
        .filter({ has: page.getByLabel("Email address", { exact: true }) })
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(page).toHaveURL(/\/jobs\/new$/);
      await expect(
        page.getByRole("heading", { name: "Post a job", exact: true }),
      ).toBeVisible();
      await expect(welcome).not.toBeVisible();
      const session = await (await page.request.get("/api/session")).json();
      expect(session.user.id).toBe(owner.user.id);
      expect(session.activeCompanyId).toBe(owner.activeCompanyId);
      expect(errors).toEqual([]);
    });
  }

  test("company posts stay in Connect and are absent from Colabb profiles", async ({
    page,
    request,
  }) => {
    await request.get("/_interface/connect");
    const suffix = randomUUID();
    const companyName = "Historical Update Solar " + suffix;
    const registered = await request.post("/api/auth/register", {
      data: {
        name: "Historical Update Owner",
        companyName,
        email: `colabb-update-${suffix}@example.test`,
        password: "ColabbUpdateTest123!",
      },
    });
    expect(registered.status()).toBe(201);
    const owner = await registered.json();
    const profileResponse = await request.get("/api/companies/" + owner.activeCompanyId);
    expect(profileResponse.ok()).toBeTruthy();
    const { company } = await profileResponse.json();
    const profilePath = "/" + (company.username || company.slug);
    const body = "Preserved company announcement for the independent frontend boundary test " + suffix;
    const published = await request.post("/api/posts", { multipart: { body } });
    expect(published.status()).toBe(201);

    await page.goto("/_interface/connect");
    await expect(page.getByRole("link", { name: "Connect by Sunhub home", exact: true })).toBeVisible();
    await page.goto(profilePath);
    await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
    await expect(page.getByText(body, { exact: true })).toBeVisible();

    await page.goto("/_interface/colabb");
    await expect(page.getByRole("link", { name: "Colabb home", exact: true })).toBeVisible();
    const socialRequests: string[] = [];
    page.on("request", (sent) => {
      if (/^\/api\/(feed|posts|publications|social)(\/|\?|$)/.test(new URL(sent.url()).pathname + new URL(sent.url()).search)) {
        socialRequests.push(sent.url());
      }
    });
    await page.goto(profilePath);
    await expect(page.getByRole("heading", { name: companyName, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Latest updates.", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Updates", exact: true })).toHaveCount(0);
    await expect(page.getByText(body, { exact: true })).toHaveCount(0);
    expect(socialRequests).toEqual([]);
    // The normal profile data still loads after retiring its social feed.
    expect((await page.request.get("/api/jobs/providers/" + company.id)).ok()).toBeTruthy();
  });

  test("interface switches wait for hydration and persist after reload", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/_interface/connect");
    const connectHome = page.getByRole("link", {
      name: "Connect by Sunhub home",
      exact: true,
    });
    // The session-loading screen temporarily replaces server-rendered branding.
    // A web-first assertion waits through that transition instead of counting
    // image elements immediately after DOMContentLoaded.
    await expect(connectHome).toBeVisible();
    await expect(
      connectHome.getByRole("img", { name: "Connect", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(connectHome).toBeVisible();

    await page.goto("/_interface/colabb");
    const colabbHome = page.getByRole("link", {
      name: "Colabb home",
      exact: true,
    });
    await expect(colabbHome).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(connectHome).toHaveCount(0);
    await expect(
      colabbHome.getByRole("img", { name: "Colabb", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(colabbHome).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
