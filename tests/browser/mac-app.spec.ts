import {
  test,
  expect,
  type Browser,
  type Page,
  type Locator,
} from "@playwright/test";
import fs from "node:fs/promises";

const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
const macUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 ConnectMac/0.1.0";
async function contextFor(
  browser: Browser,
  bridge = true,
  mac = true,
  width = 1180,
) {
  const context = await browser.newContext({
    baseURL,
    userAgent: mac ? macUA : undefined,
    viewport: { width, height: 850 },
  });
  if (bridge)
    await context.addInitScript(() => {
      const host = window as any;
      host.macStates = [];
      host.webkit = {
        messageHandlers: {
          connectMac: {
            postMessage(value: unknown) {
              host.macStates.push(value);
            },
          },
        },
      };
    });
  return context;
}
async function command(page: Page, value: object) {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent("connect:mac-command", { detail })),
    value,
  );
}
async function capture(page: Page, path: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({ path, animations: "disabled" });
}

for (const setup of [
  { bridge: false, mac: true },
  { bridge: true, mac: false },
]) {
  test(`Mac mode requires both host signals: bridge=${setup.bridge}, UA=${setup.mac}`, async ({
    browser,
  }) => {
    const context = await contextFor(browser, setup.bridge, setup.mac);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/directory");
    await expect(page.locator(".site-header")).toBeVisible();
    await expect(page.locator(".discovery-card").first()).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(page.locator(".app-main")).not.toHaveClass(/mac-app/);
    await command(page, { type: "compose" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".account-wordmark")).toBeVisible();
    await context.close();
  });
}

test("authentication popup fallback retains web chrome despite inherited Mac signals", async ({
  browser,
}) => {
  const context = await contextFor(browser);
  await context.addInitScript(() => {
    (window as any).opener = {};
  });
  const page = await context.newPage();
  await page.goto("/directory");
  await expect(page.locator(".site-header")).toBeVisible();
  await expect(page.locator(".app-main")).not.toHaveClass(/mac-app/);
  await context.close();
});

test("native guest actions keep the real authentication flow and strict route allowlist", async ({
  browser,
}) => {
  const context = await contextFor(browser);
  const page = await context.newPage();
  await page.goto("/directory");
  await expect(page.locator(".app-main.mac-app")).toBeVisible();
  await expect(page.locator(".site-header, .site-footer")).toHaveCount(0);
  await command(page, { type: "navigate", path: "https://example.com/" });
  await command(page, { type: "navigate", path: "/account" });
  await expect(page).toHaveURL(/\/directory$/);
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page.getByRole("dialog").getByLabel("Work email")).toBeVisible();
  await expect(page).toHaveURL(/\/messages$/);
  await command(page, { type: "navigate", path: "/network" });
  await expect(page).toHaveURL(/\/network$/);
  await expect(page.getByRole("dialog").getByLabel("Work email")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page).toHaveURL(/\/network$/);
  await expect(
    page.getByRole("button", { name: "Sign in to continue", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/messages$/);
  await command(page, { type: "account" });
  await expect(
    page.getByRole("dialog").getByLabel("Password", { exact: true }),
  ).toBeVisible();
  await command(page, { type: "state" });
  const state = await page.evaluate(() => (window as any).macStates.at(-1));
  expect(state.signedIn).toBe(false);
  expect(state.path).toBe("/messages");
  expect(state.canPublish).toBe(false);
  expect(Object.keys(state).sort()).toEqual(
    [
      "type",
      "ready",
      "path",
      "signedIn",
      "accountType",
      "userName",
      "companyName",
      "canPublish",
      "unreadCount",
    ].sort(),
  );
  await context.close();
});

test("native company workspace reuses publishing guards, account switching and notifications", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await contextFor(browser);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const companyName = `Mac Solar ${suffix}`;
  const email = `mac-${suffix}@example.test`;
  const registration = await context.request.post("/api/auth/register", {
    data: {
      name: "Mac Owner",
      email,
      password: "ConnectMacOwner123!",
      companyName,
    },
  });
  expect(registration.status()).toBe(201);
  const owner = await registration.json();
  const added = await context.request.post("/api/companies", {
    data: { name: `Mac Projects ${suffix}` },
  });
  expect(added.ok()).toBe(true);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".mac-app .newsroom")).toBeVisible();
  await expect(
    page.locator(".newsroom-heading, .feed-composer").first(),
  ).toBeHidden();
  await page.evaluate(() => {
    (window as any).navigationMarker = "same-react-app";
  });
  await command(page, { type: "account" });
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: companyName, exact: true })
    .click();
  await expect(page).toHaveURL(/\/network\/connections$/);
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).macStates.at(-1)?.companyName),
    )
    .toBe(companyName);
  await command(page, { type: "compose" });
  const editor = page.getByRole("textbox", { name: "Update content" });
  await expect(editor).toBeVisible();
  const writing = `Native draft ${suffix}: project progress stays saved.`;
  await editor.fill(writing);
  await command(page, { type: "navigate", path: "/directory" });
  await expect(page).toHaveURL(/\/directory$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const drafts = await (await context.request.get("/api/publications")).json();
  expect(drafts.some((draft: any) => draft.body.includes(writing))).toBe(true);
  expect(await page.evaluate(() => (window as any).navigationMarker)).toBe(
    "same-react-app",
  );

  await command(page, { type: "profile" });
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const profileURL = page.url();
  await page
    .getByRole("dialog")
    .getByLabel("Headline", { exact: false })
    .fill("Keep this unsaved company introduction");
  await command(page, { type: "navigate", path: "/directory" });
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(profileURL);
  await expect(
    page.getByRole("dialog").getByLabel("Headline", { exact: false }),
  ).toHaveValue("Keep this unsaved company introduction");
  await command(page, { type: "navigate", path: "/directory" });
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(/\/directory$/);

  await command(page, { type: "notifications" });
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Connection requests" })
    .click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const width of [1440, 760, 620]) {
    await page.setViewportSize({ width, height: 850 });
    await command(page, { type: "navigate", path: "/messages" });
    await expect(
      page.getByRole("button", { name: "All companies", exact: true }),
    ).toBeVisible();
    const bounds = await page
      .locator(".messaging-panel")
      .evaluate((element) => ({
        bottom: element.getBoundingClientRect().bottom,
        top: element.getBoundingClientRect().top,
        width: element.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth - innerWidth,
        bodyPadding: getComputedStyle(document.body).paddingBottom,
      }));
    expect(bounds.bottom).toBeLessThanOrEqual(851);
    expect(bounds.bottom).toBeGreaterThanOrEqual(845);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    expect(bounds.bodyPadding).toBe("0px");
    await expect(page.locator(".mac-app")).toHaveCount(1);
    await expect(page.locator(".messaging-panel")).toHaveCount(1);
    await capture(page, `test-results/mac-messages-${width}.png`);
  }
  await page.setViewportSize({ width: 1180, height: 850 });
  await command(page, { type: "navigate", path: "/" });
  await capture(page, "test-results/mac-feed-1180.png");
  await command(page, { type: "account" });
  await capture(page, "test-results/mac-account.png");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).macStates.at(-1)?.signedIn),
    )
    .toBe(false);
  const snapshots = await page.evaluate(() => (window as any).macStates);
  expect(JSON.stringify(snapshots)).not.toContain(email);
  expect(JSON.stringify(snapshots)).not.toContain(owner.activeCompanyId);
  expect(JSON.stringify(snapshots)).not.toMatch(/session|token|password/i);
  expect(errors).toEqual([]);
  await context.close();
});

test("native individual account can message but cannot open a publisher", async ({
  browser,
}) => {
  const context = await contextFor(browser, true, true, 760);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const registration = await context.request.post("/api/auth/register", {
    data: {
      name: "Mac Individual",
      email: `mac-person-${suffix}@example.test`,
      password: "ConnectMacPerson123!",
      accountType: "individual",
    },
  });
  expect(registration.status()).toBe(201);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".mac-app")).toBeVisible();
  await command(page, { type: "compose" });
  await expect(
    page.getByRole("textbox", { name: "Update content" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Publishing is for company accounts." }),
  ).toBeVisible();
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page.locator(".people-inbox")).toBeVisible();
  await command(page, { type: "navigate", path: "/network" });
  await expect(page).toHaveURL(/\/messages$/);
  expect(
    await page
      .locator(".people-inbox")
      .evaluate((element) => element.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(851);
  await command(page, { type: "state" });
  expect(
    await page.evaluate(() => (window as any).macStates.at(-1)?.canPublish),
  ).toBe(false);
  expect(
    await page.evaluate(() => (window as any).macStates.at(-1)?.accountType),
  ).toBe("individual");
  await context.close();
});

async function expectReadable(locator: Locator, minimum = 4.5) {
  const contrast = await locator.evaluate((element) => {
    // Canvas resolves CSS color-mix()/color() to pixels in Chromium and WebKit.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const layers: number[][] = [];
    for (let node: Element | null = element; node; node = node.parentElement)
      layers.unshift(rgba(getComputedStyle(node).backgroundColor));
    let background = [255, 255, 255];
    for (const layer of layers)
      background = background.map(
        (value, i) =>
          layer[i] * (layer[3] / 255) + value * (1 - layer[3] / 255),
      );
    const ink = rgba(getComputedStyle(element).color);
    const foreground = background.map(
      (value, i) => ink[i] * (ink[3] / 255) + value * (1 - ink[3] / 255),
    );
    const luminance = (rgb: number[]) =>
      rgb
        .map((value) => {
          const srgb = value / 255;
          return srgb <= 0.04045
            ? srgb / 12.92
            : ((srgb + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (total, value, i) => total + value * [0.2126, 0.7152, 0.0722][i],
          0,
        );
    const a = luminance(foreground),
      b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast, `Readable text for ${locator}`).toBeGreaterThanOrEqual(
    minimum,
  );
}

test("Mac appearance follows live system changes across content, editing and company chat", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await contextFor(browser);
  const partner = await browser.newContext({ baseURL });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const register = async (client: typeof context, name: string) => {
    const response = await client.request.post("/api/auth/register", {
      data: {
        name,
        email: `${name.replaceAll(" ", "-")}-${suffix}@example.test`,
        password: "ConnectMacDark123!",
        companyName: `${name} Solar ${suffix}`,
      },
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  await register(context, "Mac Appearance");
  const companyB = await register(partner, "Daylight Partner");
  const connectionRequest = await context.request.post("/api/requests", {
    data: {
      companyId: companyB.activeCompanyId,
      note: "Plan our next installation.",
    },
  });
  expect(connectionRequest.status()).toBe(201);
  const accepted = await partner.request.post(
    `/api/requests/${(await connectionRequest.json()).id}/respond`,
    {
      data: { action: "accept" },
    },
  );
  expect(accepted.ok()).toBe(true);
  const { connectionId } = await accepted.json();
  for (const [client, body] of [
    [partner, "The installation is ready for your review."],
    [context, "Thanks. I’ll share the final photos today."],
  ] as const) {
    expect(
      (
        await client.request.post(
          `/api/conversations/${connectionId}/messages`,
          {
            multipart: { body },
          },
        )
      ).status(),
    ).toBe(201);
  }
  const photo = await context.request.post("/api/posts", {
    multipart: {
      body: `A brighter day for our community. Project progress ${suffix}`,
      files: {
        name: "solar-rooftop.jpg",
        mimeType: "image/jpeg",
        buffer: await fs.readFile("apps/web/public/assets/solar.jpg"),
      },
      alts: JSON.stringify(["Our completed rooftop installation"]),
    },
  });
  expect(photo.status()).toBe(201);
  const post = await photo.json();
  expect(
    (
      await partner.request.post(`/api/posts/${post.id}/comments`, {
        data: { body: "A great milestone for the whole team." },
      })
    ).status(),
  ).toBe(201);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const card = page.locator(`#post-${post.id}`);
  await expect(card).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(242, 247, 252)",
  );
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.evaluate(() => {
    (window as any).appearanceSessionMarker = "same-page";
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(28, 45, 58)",
  );
  await expect(card).toHaveCSS("background-color", "rgb(32, 51, 66)");
  await expectReadable(card.locator(".post-body"));
  const image = card.getByRole("img", {
    name: "Our completed rooftop installation",
  });
  await expect(image).toHaveCSS("filter", "none");
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await capture(page, "test-results/mac-dark-feed.png");
  await card.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(
    card.getByText("A great milestone for the whole team.", { exact: true }),
  ).toBeVisible();
  await expectReadable(
    card.locator(".conversation-comment-content > p").first(),
  );
  await capture(page, "test-results/mac-dark-comments.png");

  await command(page, { type: "account" });
  await expect(page.locator(".mac-action-panel")).toBeVisible();
  await expectReadable(page.locator(".mac-action-panel h2"));
  await capture(page, "test-results/mac-dark-account.png");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await command(page, { type: "compose" });
  const editor = page.getByRole("textbox", { name: "Update content" });
  await editor.fill(
    "Project progress, in every light.\nOur team has completed another community rooftop installation.",
  );
  await expectReadable(editor);
  await expectReadable(
    page.getByRole("button", { name: "Publish", exact: true }),
  );
  await capture(page, "test-results/mac-dark-publisher.png");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".publisher")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(editor).toContainText("Project progress, in every light.");
  expect(
    await page.evaluate(() => (window as any).appearanceSessionMarker),
  ).toBe("same-page");
  await page.emulateMedia({ colorScheme: "dark" });
  await command(page, { type: "navigate", path: "/messages" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search companies" })
    .fill(companyB.companies[0].name);
  await page
    .locator(".conversation-link")
    .filter({ hasText: companyB.companies[0].name })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expectReadable(page.locator(".message-bubble").first());
  await expectReadable(page.locator(".message.own .message-bubble").first());
  await expectReadable(page.locator(".conversation-preview").first());
  await expect(page.locator(".message-history")).toHaveCSS(
    "background-color",
    "rgb(28, 45, 58)",
  );
  await capture(page, "test-results/mac-dark-messages.png");
  await command(page, { type: "navigate", path: "/directory" });
  await expect(page.locator(".discovery-card").first()).toHaveCSS(
    "background-color",
    "rgb(32, 51, 66)",
  );
  await expectReadable(page.locator(".discovery-card h2").first());
  await expectReadable(page.locator(".discovery-facts").first());
  await expectReadable(
    page.locator('.discovery-categories button[aria-pressed="false"]').first(),
  );
  await capture(page, "test-results/mac-dark-directory.png");
  await command(page, { type: "profile" });
  await expect(
    page.getByRole("button", { name: "Edit profile", exact: true }),
  ).toBeVisible();
  await capture(page, "test-results/mac-dark-profile.png");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page.locator(".manage-dialog")).toHaveCSS(
    "background-color",
    "rgb(32, 51, 66)",
  );
  await expectReadable(
    page.getByRole("dialog").getByLabel("Headline", { exact: false }),
  );
  await capture(page, "test-results/mac-dark-profile-editor.png");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await command(page, { type: "account" });
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Account & security" })
    .click();
  await expect(page.locator(".security-grid")).toBeVisible();
  await expectReadable(page.locator(".security-grid p").first());
  await expect(page.getByLabel("Current password", { exact: true })).toHaveCSS(
    "background-color",
    "rgb(32, 51, 66)",
  );
  await page
    .getByLabel("Current password", { exact: true })
    .fill("preview-only");
  await expectReadable(page.getByLabel("Current password", { exact: true }));
  await expectReadable(
    page.getByRole("button", { name: "Update password", exact: true }),
  );
  await capture(page, "test-results/mac-dark-security.png");
  expect(errors).toEqual([]);
  await context.close();
  await partner.close();
});

test("Mac dark sign-in and individual inbox retain readable native surfaces", async ({
  browser,
}) => {
  const context = await contextFor(browser, true, true, 760);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/directory");
  await command(page, { type: "account" });
  const email = page.getByRole("dialog").getByLabel("Work email");
  await expect(email).toHaveCSS("background-color", "rgb(32, 51, 66)");
  await email.fill("local-preview@example.test");
  await expectReadable(email);
  await expectReadable(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true }),
  );
  await expect(page.locator(".account-wordmark")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".account-wordmark")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await capture(page, "test-results/mac-dark-sign-in.png");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const response = await context.request.post("/api/auth/register", {
    data: {
      name: "Mac Dark Customer",
      email: `dark-person-${Date.now()}@example.test`,
      password: "ConnectMacDark123!",
      accountType: "individual",
    },
  });
  expect(response.status()).toBe(201);
  await page.goto("/messages");
  await expect(page.locator(".people-inbox")).toBeVisible();
  await expect(page.locator(".people-inbox")).toHaveCSS(
    "background-color",
    "rgb(32, 51, 66)",
  );
  await expectReadable(page.locator(".people-chat-empty h2"));
  await capture(page, "test-results/mac-dark-people-inbox.png");
  const company = await browser.newContext({ baseURL });
  const companyResponse = await company.request.post("/api/auth/register", {
    data: {
      name: "Mac Customer Support",
      email: `dark-company-${Date.now()}@example.test`,
      password: "ConnectMacDark123!",
      companyName: `Mac Daylight Support ${Date.now()}`,
    },
  });
  expect(companyResponse.status()).toBe(201);
  const companyAccount = await companyResponse.json();
  const threadResponse = await context.request.post("/api/personal-inbox", {
    data: {
      companyId: companyAccount.activeCompanyId,
      body: "Can you help with our rooftop?",
      clientId: crypto.randomUUID(),
    },
  });
  expect(threadResponse.status()).toBe(201);
  const thread = await threadResponse.json();
  expect(
    (
      await company.request.post(`/api/personal-inbox/${thread.id}/respond`, {
        data: { accept: true },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await company.request.post(`/api/personal-inbox/${thread.id}/messages`, {
        data: {
          body: "Absolutely. Let’s talk about your project.",
          clientId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "My chats", exact: true }).click();
  await page
    .locator(".people-thread")
    .filter({ hasText: "Mac Daylight Support" })
    .click();
  await expect(
    page
      .locator(".people-message")
      .getByText("Absolutely. Let’s talk about your project.", {
        exact: true,
      }),
  ).toBeVisible();
  await expectReadable(page.locator(".people-message.mine > p").first());
  await expectReadable(page.locator(".people-message:not(.mine) > p").first());
  await capture(page, "test-results/mac-dark-people-chat.png");
  await company.close();
  await context.close();
});

for (const intent of ["compose", "notifications"] as const) {
  test(`early native ${intent} waits for session readiness and resumes after sign-in`, async ({
    browser,
  }) => {
    const account = await browser.newContext({ baseURL });
    const suffix = `${Date.now()}-${intent}`;
    const email = `mac-ready-${suffix}@example.test`;
    const registration = await account.request.post("/api/auth/register", {
      data: {
        name: "Mac Ready",
        email,
        password: "ConnectReady123!",
        companyName: `Mac Ready Solar ${suffix}`,
      },
    });
    expect(registration.status()).toBe(201);
    const context = await contextFor(browser);
    const page = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/session", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/directory");
    await expect
      .poll(() => page.evaluate(() => (window as any).macStates.at(-1)?.ready))
      .toBe(false);
    await command(page, { type: "account" });
    await command(page, { type: intent }); // Latest valid UI intent wins during startup.
    await command(page, { type: "navigate", path: "https://example.test/" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    release();
    await expect
      .poll(() => page.evaluate(() => (window as any).macStates.at(-1)?.ready))
      .toBe(true);
    await expect(
      page.getByRole("dialog").getByLabel("Work email"),
    ).toBeVisible();
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("ConnectReady123!");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    if (intent === "compose") {
      await expect(
        page.getByRole("textbox", { name: "Update content" }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "Notifications", exact: true }),
      ).toBeVisible();
    }
    await context.close();
    await account.close();
  });
}

test("Mac native filter menu preserves React selection, cancellation, accessibility and stale guards", async ({
  browser,
}) => {
  const context = await contextFor(browser);
  await context.addInitScript(() => {
    Object.defineProperty(window, "__connectMacCapabilities", {
      value: Object.freeze({ nativeSelect: true }),
    });
  });
  const page = await context.newPage();
  await page.goto("/directory");
  const control = page.getByRole("combobox", {
    name: "Company type",
    exact: true,
  });
  await expect(page.locator("html")).toHaveClass(/mac-native-selects/);
  await expect(control).toHaveCSS("appearance", "none");
  const bounds = (await control.boundingBox())!;
  expect(bounds.height).toBeGreaterThanOrEqual(36);
  expect(bounds.width).toBeGreaterThanOrEqual(156);
  const lastRequest = () =>
    page.evaluate(() =>
      (window as any).macStates
        .filter((value: any) => value.type === "select")
        .at(-1),
    );
  const result = (requestId: string, selectedIndex: number | null) =>
    page.evaluate(
      (detail) => {
        window.dispatchEvent(
          new CustomEvent("connect:mac-select-result", { detail }),
        );
      },
      { requestId, selectedIndex },
    );

  await control.click();
  await expect(control).toHaveAttribute("aria-expanded", "true");
  const first = await lastRequest();
  expect(first.label).toBe("Company type");
  expect(first.options.map((option: any) => option.title)).toContain(
    "Manufacturer",
  );
  expect(first.selectedIndex).toBe(0);
  expect(Object.keys(first).sort()).toEqual(
    ["type", "requestId", "label", "selectedIndex", "options", "anchor"].sort(),
  );
  expect(Object.keys(first.options[0]).sort()).toEqual(["disabled", "title"]);
  await result("mismatched-request", 2);
  await expect(control).toHaveValue("");
  await result(first.requestId, 2);
  await expect(control).toHaveValue("Manufacturer");
  await expect(page).toHaveURL(/type=Manufacturer/);
  await expect(control).toBeFocused();
  await expect(control).not.toHaveAttribute("aria-expanded", "true");

  await control.press("ArrowDown");
  const keyboard = await lastRequest();
  expect(keyboard.requestId).not.toBe(first.requestId);
  expect(keyboard.selectedIndex).toBe(2);
  await result(keyboard.requestId, null);
  await expect(control).toHaveValue("Manufacturer");
  await expect(control).toBeFocused();

  await control
    .locator("option")
    .nth(1)
    .evaluate((node) => {
      (node as HTMLOptionElement).disabled = true;
    });
  await control.press("Space");
  const disabled = await lastRequest();
  expect(disabled.options[1].disabled).toBe(true);
  await result(disabled.requestId, 1);
  await expect(control).toHaveValue("Manufacturer");
  await control
    .locator("option")
    .nth(1)
    .evaluate((node) => {
      (node as HTMLOptionElement).disabled = false;
    });

  await control.click();
  const stale = await lastRequest();
  await control
    .locator("option")
    .nth(1)
    .evaluate((node) => {
      node.textContent = "Changed while open";
    });
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as any).macStates.some(
            (value: any) =>
              value.type === "selectCancel" && value.requestId === id,
          ),
        stale.requestId,
      ),
    )
    .toBe(true);
  await result(stale.requestId, 1);
  await expect(control).toHaveValue("Manufacturer");
  await control
    .locator("option")
    .nth(1)
    .evaluate((node) => {
      node.textContent = "Installer";
    });

  await control.press("Enter");
  const escaped = await lastRequest();
  await control.press("Escape");
  await expect(control).not.toHaveAttribute("aria-expanded", "true");
  await result(escaped.requestId, 1);
  await expect(control).toHaveValue("Manufacturer");

  await control.click();
  const navigated = await lastRequest();
  await command(page, { type: "navigate", path: "/" });
  await expect(page).toHaveURL(`${baseURL}/`);
  await result(navigated.requestId, 1);
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as any).macStates.some(
            (value: any) =>
              value.type === "selectCancel" && value.requestId === id,
          ),
        navigated.requestId,
      ),
    )
    .toBe(true);
  await context.close();
});

test("old Mac hosts and ordinary browsers retain their working HTML directory selects", async ({
  browser,
}) => {
  for (const mac of [true, false]) {
    const context = await contextFor(browser, true, mac);
    if (!mac)
      await context.addInitScript(() => {
        (window as any).__connectMacCapabilities = { nativeSelect: true };
      });
    const page = await context.newPage();
    await page.goto("/directory");
    await expect(page.locator("html")).not.toHaveClass(/mac-native-selects/);
    const select = page.getByRole("combobox", {
      name: "Project type",
      exact: true,
    });
    await select.selectOption("Residential");
    await expect(page).toHaveURL(/audience=Residential/);
    await expect(select).toHaveValue("Residential");
    expect(
      await page.evaluate(() =>
        (window as any).macStates.filter(
          (value: any) => value.type === "select",
        ),
      ),
    ).toEqual([]);
    await context.close();
  }
});
