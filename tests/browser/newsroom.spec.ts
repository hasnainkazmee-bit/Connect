import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("newsroom reflows, filters publications and keeps gallery photos uncropped", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = Date.now();
  const register = await context.request.post("/api/auth/register", {
    data: {
      name: "Newsroom Editor",
      email: `newsroom-${suffix}@example.test`,
      password: "NewsroomTest123!",
      companyName: `Daylight Energy ${suffix}`,
    },
  });
  expect(register.status()).toBe(201);
  const form = new FormData();
  form.set("body", `A new chapter for community energy ${suffix}`);
  const bytes = await fs.readFile("apps/web/public/assets/solar.jpg");
  form.append(
    "files",
    new Blob([bytes], { type: "image/jpeg" }),
    "rooftop.jpg",
  );
  form.append(
    "files",
    new Blob([bytes], { type: "image/jpeg" }),
    "installation.jpg",
  );
  form.set(
    "alts",
    JSON.stringify([
      "Community rooftop panels",
      "Completed solar installation",
    ]),
  );
  // Multipart serialization retains repeated files, unlike a JS object.
  const request = new Request("http://localhost/", {
    method: "POST",
    body: form,
  });
  const photoResponse = await context.request.post("/api/posts", {
    data: Buffer.from(await request.arrayBuffer()),
    headers: { "Content-Type": request.headers.get("content-type")! },
  });
  expect(photoResponse.status()).toBe(201);
  const photoPost = await photoResponse.json();
  const draft = await (
    await context.request.post("/api/publications", {
      data: { kind: "press_release" },
    })
  ).json();
  const releaseResponse = await context.request.patch(
    `/api/publications/${draft.id}`,
    {
      data: {
        kind: "press_release",
        title: `Daylight announces a community solar milestone ${suffix}`,
        subtitle: "Local partnerships. Lasting progress.",
        body: "Our installation team has completed a new rooftop solar project for the community.",
        document: null,
        status: "published",
        version: draft.version,
        coverMediaId: null,
      },
    },
  );
  expect(releaseResponse.status()).toBe(200);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The industry, in motion." }),
  ).toBeVisible();
  const post = page.locator(`#post-${photoPost.id}`);
  await expect(post).toBeVisible();
  const filters = page.getByLabel("Feed publication type");
  await filters
    .getByRole("button", { name: "Press releases", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: `Daylight announces a community solar milestone ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(post).toHaveCount(0);
  await filters.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(post).toBeVisible();
  await expect(page.locator(`#post-${draft.id}`)).toHaveCount(0);
  await expect(
    post.getByRole("img", { name: "Community rooftop panels" }),
  ).toHaveCSS("object-fit", "contain");
  await post.getByRole("button", { name: "Next photo" }).click();
  await expect(post.getByRole("status")).toHaveText("2 / 2");
  await post.getByRole("button", { name: "Previous photo" }).click();
  await expect(post.getByRole("status")).toHaveText("1 / 2");
  const first = post.getByRole("button", {
    name: "View Community rooftop panels",
  });
  await first.focus();
  await first.press("ArrowRight");
  await expect(post.getByRole("status")).toHaveText("2 / 2");
  await post
    .getByRole("button", { name: "View Completed solar installation" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("img", { name: "Completed solar installation", exact: true }),
  ).toHaveAttribute("alt", "Completed solar installation");
  await page.keyboard.press("Escape");
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `overflow at ${width}`,
    ).toBe(true);
    const stream = await page
      .getByRole("region", { name: "Company feed" })
      .boundingBox();
    expect(stream!.width).toBeLessThanOrEqual(721);
    for (const control of await post.locator(".post-actions button").all()) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `test-results/newsroom-${width}.png` });
  }
  expect(errors).toEqual([]);
  await context.close();
});
