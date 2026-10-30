import { test, expect } from "@playwright/test";
test("company publishes photos and video, another follows and comments", async ({
  browser,
  request,
}) => {
  const id = Date.now(),
    password = "SocialBrowser123!";
  const owner = await (
    await request.post("/api/auth/register", {
      data: {
        name: "Maya Social",
        email: "maya-social-" + id + "@example.test",
        password,
        companyName: "Helio Social " + id,
      },
    })
  ).json();
  const follower = await (
    await request.post("/api/auth/register", {
      data: {
        name: "Amina Social",
        email: "amina-social-" + id + "@example.test",
        password,
        companyName: "Brightfield Social " + id,
      },
    })
  ).json();
  const context = await browser.newContext({
    baseURL: process.env.API_TEST_URL || "http://localhost:4101",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const login = async (email: string) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(owner.user.email);
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await page.getByLabel("Post text").fill("New installation milestone " + id);
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles("apps/web/public/assets/solar.jpg");
  await page.getByLabel("Image description 1").fill("Solar panels in sunlight");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Post", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const photoPost = page
    .locator(".feed-post")
    .filter({ hasText: "New installation milestone " + id });
  await expect(photoPost).toBeVisible();
  await expect(
    photoPost.getByRole("img", {
      name: "Solar panels in sunlight",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await page.getByLabel("Post text").fill("Video site update " + id);
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/clip.webm");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Post", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const videoPost = page
    .locator(".feed-post")
    .filter({ hasText: "Video site update " + id });
  await expect(videoPost).toBeVisible();
  const video = videoPost.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await page.getByLabel("Account and company menu").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(follower.user.email);
  await page.goto("/company/" + owner.activeCompanyId);
  await page
    .getByRole("button", {
      name: "Follow " + owner.companies[0].name,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Unfollow " + owner.companies[0].name,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("tab", { name: "Following", exact: true }).click();
  await expect(photoPost).toBeVisible();
  await photoPost.getByRole("button", { name: "Like", exact: true }).click();
  await expect(
    photoPost.getByRole("button", { name: "Liked", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await photoPost.getByRole("button", { name: "Comment", exact: true }).click();
  await photoPost
    .getByLabel("Write a comment")
    .fill("Great work — would love to hear more.");
  await photoPost.getByRole("button", { name: "Send comment" }).click();
  await expect(
    photoPost.getByText("Great work — would love to hear more.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/social-feed-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/social-feed-mobile.png" });
  await page.reload();
  await page.getByRole("tab", { name: "Following", exact: true }).click();
  await expect(photoPost).toBeVisible();
  await photoPost.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(
    photoPost.getByText("Great work — would love to hear more.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
