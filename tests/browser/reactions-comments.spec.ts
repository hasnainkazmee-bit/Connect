import { test, expect } from "@playwright/test";

test("full emoji reactions, who reacted, and threaded comments persist with clear permissions", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
  const owner = await browser.newContext({ baseURL });
  const partner = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 740 },
  });
  const individual = await browser.newContext({ baseURL });
  const suffix = Date.now();
  const register = async (
    context: typeof owner,
    name: string,
    accountType = "company",
  ) => {
    const response = await context.request.post("/api/auth/register", {
      data: {
        name,
        email: `${name.replaceAll(" ", "-")}-${suffix}@example.test`,
        password: "ConnectReactions123!",
        accountType,
        ...(accountType === "company"
          ? { companyName: name + " Solar " + suffix }
          : {}),
      },
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const ownerAccount = await register(owner, "Project Owner");
  const partnerAccount = await register(partner, "Project Partner");
  await register(individual, "Local Customer", "individual");
  const published = await owner.request.post("/api/posts", {
    multipart: { body: "A new community solar project " + suffix },
  });
  expect(published.status()).toBe(201);
  const item = await published.json();
  await owner.request.post(`/api/posts/${item.id}/reactions`, {
    data: { emoji: "🚀", reacted: true },
  });
  const parentResponse = await owner.request.post(
    `/api/posts/${item.id}/comments`,
    { data: { body: "What would you like to know about the project?" } },
  );
  const parentComment = (await parentResponse.json()).created_comment;
  const page = await partner.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/posts/${item.id}`);
  const card = page.locator(".feed-post");
  await card.getByRole("button", { name: "React", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a reaction" });
  await expect(picker.getByRole("searchbox")).toBeFocused();
  await picker.getByRole("searchbox").fill("rocket");
  await expect(
    picker.getByRole("button", { name: "🚀", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/emoji-picker-phone.png" });
  expect(
    await picker.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await picker.getByRole("button", { name: "🚀", exact: true }).click();
  await expect(picker).toHaveCount(0);
  const rocket = card.getByRole("button", {
    name: /Remove 🚀 reaction; 2 companies/,
  });
  await expect(rocket).toHaveAttribute("aria-pressed", "true");
  await page.route(`**/api/posts/${item.id}/reactions`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Reaction temporarily unavailable. Please retry.",
        }),
      });
    else await route.continue();
  });
  await rocket.click();
  await expect(card.getByRole("alert")).toContainText(
    "Reaction temporarily unavailable",
  );
  await expect(rocket).toHaveAttribute("aria-pressed", "true");
  await page.unroute(`**/api/posts/${item.id}/reactions`);
  await rocket.click();
  await expect(
    card.getByRole("button", { name: /Add 🚀 reaction; 1 company/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await card
    .getByRole("button", { name: /Add 🚀 reaction; 1 company/ })
    .click();
  await expect(rocket).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Choose another reaction" }).click();
  await picker.getByRole("searchbox").fill("sunflower");
  await picker.getByRole("button", { name: "🌻", exact: true }).click();
  await expect(
    card.getByRole("button", { name: /Remove 🌻 reaction/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "View 3 reactions" }).click();
  const who = page.getByRole("dialog");
  await expect(
    who.getByRole("heading", { name: "Reactions", exact: true }),
  ).toBeVisible();
  await who.getByRole("button", { name: "Show 🚀 reactions" }).click();
  await expect(who.locator(".reaction-person")).toHaveCount(2);
  await expect(who.getByText("Project Owner", { exact: true })).toBeVisible();
  await expect(who.getByText("Project Partner", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/who-reacted-phone.png" });
  await who.getByRole("button", { name: "Close dialog" }).click();
  await card.getByRole("button", { name: "Comment", exact: true }).click();
  const comments = card.getByRole("region", { name: "Comments" });
  const root = comments.locator(".conversation-comment").filter({
    has: page.getByText("What would you like to know about the project?", {
      exact: true,
    }),
  });
  await expect(root).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Comment options" }),
  ).toHaveCount(0);
  await comments
    .getByLabel("Write a comment")
    .fill("Keep my unfinished main comment");
  await root.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(comments.getByLabel("Write a reply")).toBeFocused();
  await comments
    .getByLabel("Write a reply")
    .fill("Can you share the installation capacity?");
  await comments.getByRole("button", { name: "Cancel reply" }).click();
  await expect(comments.getByLabel("Write a comment")).toHaveValue(
    "Keep my unfinished main comment",
  );
  await root.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(comments.getByLabel("Write a reply")).toHaveValue(
    "Can you share the installation capacity?",
  );
  await page.route(`**/api/posts/${item.id}/comments`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Couldn’t send your reply. Try again." }),
      });
    else await route.continue();
  });
  await comments.getByRole("button", { name: "Send reply" }).click();
  await expect(comments.getByRole("alert")).toContainText(
    "Couldn’t send your reply",
  );
  await expect(comments.getByLabel("Write a reply")).toHaveValue(
    "Can you share the installation capacity?",
  );
  await page.unroute(`**/api/posts/${item.id}/comments`);
  await comments.getByRole("button", { name: "Send reply" }).click();
  const reply = comments.locator(".conversation-comment").filter({
    has: page.getByText("Can you share the installation capacity?", {
      exact: true,
    }),
  });
  await expect(reply).toBeVisible();
  await expect(comments.getByLabel("Write a comment")).toHaveValue(
    "Keep my unfinished main comment",
  );
  await comments.getByRole("button", { name: "Hide comments" }).click();
  await card.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(reply).toBeVisible();
  await expect(comments.getByLabel("Write a comment")).toHaveValue(
    "Keep my unfinished main comment",
  );
  await reply.getByRole("button", { name: "Reply", exact: true }).click();
  await comments
    .getByLabel("Write a reply")
    .fill("And is storage part of this installation?");
  await comments.getByLabel("Write a reply").press("ControlOrMeta+Enter");
  await expect(
    comments.getByText("And is storage part of this installation?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/threaded-comments-phone.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  // Deliver an older reaction snapshot after a comment has already arrived.
  let releaseReaction!: () => void;
  let reactionCaptured!: () => void;
  const holdReaction = new Promise<void>((resolve) => {
    releaseReaction = resolve;
  });
  const capturedReaction = new Promise<void>((resolve) => {
    reactionCaptured = resolve;
  });
  await page.route(`**/api/posts/${item.id}/reactions`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    reactionCaptured();
    await holdReaction;
    await route.fulfill({ response });
  });
  await rocket.click();
  await capturedReaction;
  await comments
    .getByLabel("Write a comment")
    .fill("A comment sent while a reaction is finishing.");
  await comments.getByRole("button", { name: "Send comment" }).click();
  await expect(
    card.getByRole("button", { name: "4 comments", exact: true }),
  ).toBeVisible();
  releaseReaction();
  const unselectedRocket = card.getByRole("button", {
    name: /Add 🚀 reaction; 1 company/,
  });
  await expect(unselectedRocket).toHaveAttribute("aria-pressed", "false");
  await expect(
    card.getByRole("button", { name: "4 comments", exact: true }),
  ).toBeVisible();
  await page.unroute(`**/api/posts/${item.id}/reactions`);
  await unselectedRocket.click();
  await expect(rocket).toHaveAttribute("aria-pressed", "true");

  // Deliver an older comment snapshot after a reaction has already changed.
  let releaseComment!: () => void;
  let commentCaptured!: () => void;
  const holdComment = new Promise<void>((resolve) => {
    releaseComment = resolve;
  });
  const capturedComment = new Promise<void>((resolve) => {
    commentCaptured = resolve;
  });
  await page.route(`**/api/posts/${item.id}/comments`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    commentCaptured();
    await holdComment;
    await route.fulfill({ response });
  });
  await comments
    .getByLabel("Write a comment")
    .fill("Another update with a delayed response.");
  await comments.getByRole("button", { name: "Send comment" }).click();
  await capturedComment;
  await rocket.click();
  await expect(unselectedRocket).toHaveAttribute("aria-pressed", "false");
  releaseComment();
  await expect(
    card.getByRole("button", { name: "5 comments", exact: true }),
  ).toBeVisible();
  await expect(unselectedRocket).toHaveAttribute("aria-pressed", "false");
  await page.unroute(`**/api/posts/${item.id}/comments`);
  await unselectedRocket.click();
  await expect(rocket).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(rocket).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Comment", exact: true }).click();
  await comments
    .getByRole("button", { name: "2 replies", exact: true })
    .click();
  await expect(reply).toBeVisible();
  await expect(
    comments.getByText("Replying to Project Partner", { exact: true }),
  ).toBeVisible();
  await owner.request.delete(
    `/api/posts/${item.id}/comments/${parentComment.id}`,
  );
  await page.reload();
  await card.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(
    comments.getByText("This comment was deleted.", { exact: true }),
  ).toBeVisible();
  await comments
    .getByRole("button", { name: "2 replies", exact: true })
    .click();
  await expect(reply).toBeVisible();
  const personalPage = await individual.newPage();
  await personalPage.goto(`/posts/${item.id}`);
  await expect(
    personalPage.getByRole("button", { name: "React", exact: true }),
  ).toBeDisabled();
  await personalPage
    .getByRole("button", { name: "Comment", exact: true })
    .click();
  await expect(personalPage.getByLabel("Write a comment")).toHaveCount(0);
  await expect(
    personalPage.getByText("Comments and reactions are shared by companies.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), partner.close(), individual.close()]);
});
