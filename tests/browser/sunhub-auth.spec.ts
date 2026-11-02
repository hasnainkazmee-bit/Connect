import {
  test,
  expect,
  type Page,
  type Locator,
  type BrowserContext,
} from "@playwright/test";

async function enabled(page: Page, value = true) {
  await page.route("**/api/auth/sunhub/config", (route) =>
    route.fulfill({ json: { enabled: value } }),
  );
}
async function destination(link: Locator) {
  return new URL((await link.getAttribute("href"))!, "http://localhost:4101");
}

async function popupProvider(context: BrowserContext) {
  await context.route("**/api/auth/sunhub/start?**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Sunhub sign-in fixture</title><h1>Sunhub</h1>",
    }),
  );
}
async function openPopup(page: Page, name = "Sign in with Sunhub") {
  const opened = page.waitForEvent("popup");
  await page.getByRole("link", { name, exact: true }).click();
  const popup = await opened;
  await popup.waitForLoadState();
  expect(new URL(popup.url()).searchParams.get("display")).toBe("popup");
  expect(new URL(popup.url()).searchParams.get("popup_id")).toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  );
  return popup;
}
async function complete(
  popup: Page,
  status: "success" | "error" = "success",
  error?: string,
) {
  await popup.evaluate(
    ({ status, error }) => {
      window.opener.postMessage(
        {
          type: "connect:sunhub:complete",
          popupId: new URL(location.href).searchParams.get("popup_id"),
          status,
          error,
          returnTo: "/",
        },
        location.origin,
      );
    },
    { status, error },
  );
  await expect.poll(() => popup.isClosed()).toBe(true);
}
const onboardingSession = () => ({
  user: {
    id: "sunhub-new-user",
    name: "Sunhub Owner",
    email: "owner@example.test",
    account_type: "company",
    email_verified_at: new Date().toISOString(),
    onboarding_completed_at: null,
    sunhubLinked: true,
    hasPassword: false,
  },
  companies: [],
  activeCompanyId: null,
  verificationRequired: true,
});

test("Connect email login and registration remain primary with optional Sunhub entry points", async ({
  page,
}) => {
  const suffix = Date.now(),
    email = `sunhub-local-${suffix}@example.test`,
    password = "SunhubOptional123!";
  const registered = await page.request.post("/api/auth/register", {
    data: {
      name: "Optional Login",
      email,
      password,
      companyName: `Optional Solar ${suffix}`,
    },
  });
  expect(registered.status()).toBe(201);
  const account = await registered.json();
  await page.request.post("/api/auth/logout");
  await enabled(page);
  await page.goto("/directory?source=welcome#companies");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const sunhub = dialog.getByRole("link", {
    name: "Sign in with Sunhub",
    exact: true,
  });
  await expect(sunhub).toBeVisible();
  const href = await destination(sunhub);
  expect(href.pathname).toBe("/api/auth/sunhub/start");
  expect(href.searchParams.get("intent")).toBe("login");
  expect(href.searchParams.get("returnTo")).toBe(
    "/directory?source=welcome#companies",
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const local = dialog.getByRole("button", { name: "Sign in", exact: true });
    expect((await local.boundingBox())!.y).toBeLessThan(
      (await sunhub.boundingBox())!.y,
    );
    expect((await sunhub.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/sunhub-optional-login-${width}.png`,
      fullPage: true,
    });
  }
  await dialog
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "An individual", exact: false })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Create account", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Your name", { exact: true })).toBeVisible();
  const signup = await destination(
    dialog.getByRole("link", { name: "Create a Sunhub account", exact: true }),
  );
  expect(signup.searchParams.get("intent")).toBe("signup");
  expect(signup.searchParams.get("accountType")).toBe("individual");
  expect(signup.searchParams.get("returnTo")).toBe(
    "/directory?source=welcome#companies",
  );
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const session = await (await page.request.get("/api/session")).json();
  expect(session.user.id).toBe(account.user.id);
});

test("Sunhub availability never blocks Connect and navigation preserves the requested destination", async ({
  page,
}) => {
  await enabled(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Sunhub", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.unroute("**/api/auth/sunhub/config");
  await enabled(page);
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  const sunhub = page.getByRole("link", {
    name: "Sign in with Sunhub",
    exact: true,
  });
  await expect(sunhub).toBeVisible();
  expect((await destination(sunhub)).searchParams.get("returnTo")).toBe(
    "/messages",
  );
});

test("Sunhub preserves company invitations and claims, and callback errors use fixed safe messages", async ({
  page,
  context,
}) => {
  await enabled(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of [
    "/join/cedar-solar?invite=welcome-team#details",
    "/invite/private-invite-token?from=email",
    "/claim/solar-listing?source=directory",
  ]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const sunhub = dialog.getByRole("link", {
      name: "Sign in with Sunhub",
      exact: true,
    });
    await expect(sunhub).toBeVisible();
    expect((await destination(sunhub)).searchParams.get("returnTo")).toBe(path);
    await dialog
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: /An individual/ }),
    ).toHaveCount(0);
    expect(
      (
        await destination(
          dialog.getByRole("link", {
            name: "Create a Sunhub account",
            exact: true,
          }),
        )
      ).searchParams.get("accountType"),
    ).toBe("company");
  }
  await popupProvider(context);
  const parentUrl = page.url();
  const popup = await openPopup(page);
  await complete(popup, "error", "cancelled");
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Sunhub sign-in was canceled. You can try again whenever you’re ready.",
  );
  await expect(page).toHaveURL(parentUrl);
  await page.goto("/directory?sso_error=__proto__&source=welcome");
  await expect(page.getByRole("alert")).toHaveText(
    "We couldn’t complete Sunhub sign-in. Please try again.",
  );
  await expect(page).toHaveURL(/\/directory\?source=welcome$/);
  await page.goto("/?sso_error=account_conflict");
  await expect(page.getByRole("alert")).toContainText(
    "Sign in with your Connect password, then link Sunhub in Account settings.",
  );
  expect(errors).toEqual([]);
});

test("popup accepts only its own origin, source and nonce before entering existing company onboarding", async ({
  page,
  context,
}) => {
  await enabled(page);
  await popupProvider(context);
  let signedIn = false,
    sessionReads = 0;
  await page.route("**/api/session", (route) => {
    sessionReads++;
    return route.fulfill({
      json: signedIn
        ? onboardingSession()
        : { user: null, companies: [], activeCompanyId: null },
    });
  });
  await page.goto("/directory?source=popup#companies");
  await page.evaluate(() => {
    (window as any).connectPageMarker = "preserved";
    const original = window.open;
    window.open = (...args) => {
      const popup = original.apply(window, args);
      (window as any).sunhubPopup = popup;
      return popup;
    };
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await openPopup(page);
  const startUrl = popup.url(),
    popupId = new URL(startUrl).searchParams.get("popup_id")!;
  const readsBefore = sessionReads;
  await page.evaluate(
    (popupId) =>
      window.postMessage(
        { type: "connect:sunhub:complete", popupId, status: "success" },
        location.origin,
      ),
    popupId,
  );
  await popup.evaluate(() =>
    window.opener.postMessage(
      {
        type: "connect:sunhub:complete",
        popupId: "wrong-popup-id",
        status: "success",
      },
      location.origin,
    ),
  );
  await page.evaluate((popupId) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: (window as any).sunhubPopup,
        origin: "https://untrusted.example",
        data: { type: "connect:sunhub:complete", popupId, status: "success" },
      }),
    );
  }, popupId);
  await expect(
    page.getByText("Continue in the Sunhub window.", { exact: true }),
  ).toBeVisible();
  expect(sessionReads).toBe(readsBefore);
  await expect(
    page.getByRole("link", { name: "Sign in with Sunhub", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show window", exact: true }).click();
  expect(context.pages()).toHaveLength(2);
  signedIn = true;
  await complete(popup);
  await expect(
    page.getByRole("heading", { name: "Introduce your company.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Check your inbox.", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/directory\?source=popup#companies$/);
  expect(await page.evaluate(() => (window as any).connectPageMarker)).toBe(
    "preserved",
  );
});

test("linking Sunhub is explicit in Account settings and success reflects the actual session", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const response = await page.request.post("/api/auth/register", {
    data: {
      name: "Linked Owner",
      email: `sunhub-link-${suffix}@example.test`,
      password: "SunhubLinking123!",
      companyName: `Linking Solar ${suffix}`,
    },
  });
  expect(response.status()).toBe(201);
  const session = await response.json();
  await enabled(page);
  await page.goto("/account");
  const link = page.getByRole("link", {
    name: "Link Sunhub account",
    exact: true,
  });
  await expect(link).toBeVisible();
  expect((await destination(link)).searchParams.get("intent")).toBe("link");
  expect((await destination(link)).searchParams.get("returnTo")).toBe(
    "/account",
  );
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        ...session,
        user: { ...session.user, sunhubLinked: true, hasPassword: false },
      },
    }),
  );
  await popupProvider(context);
  await page.evaluate(() => {
    (window as any).connectPageMarker = "account retained";
  });
  const popup = await openPopup(page, "Link Sunhub account");
  await complete(popup);
  expect(await page.evaluate(() => (window as any).connectPageMarker)).toBe(
    "account retained",
  );
  await expect(
    page.getByText("Linked to Sunhub", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Sunhub is linked.");
  await expect(link).toHaveCount(0);
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/To add a separate Connect password/),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/account?sso_error=email_unverified");
  await expect(page.getByRole("alert")).toHaveText(
    "Verify your email with Sunhub, then try again.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("blocked and canceled popups keep local login details and allow a fresh attempt", async ({
  page,
  context,
}) => {
  await enabled(page);
  await popupProvider(context);
  await page.addInitScript(() => {
    (window as any).realOpen = window.open;
    window.open = () => null;
  });
  await page.goto("/directory");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Work email", exact: true })
    .fill("kept@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("UnsavedLocalPassword123!");
  await page
    .getByRole("link", { name: "Sign in with Sunhub", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Allow pop-ups for Connect, then try Sunhub sign-in again.",
  );
  await page.evaluate(() => {
    window.open = (window as any).realOpen;
  });
  const popup = await openPopup(page);
  const firstId = new URL(popup.url()).searchParams.get("popup_id");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/sunhub-popup-waiting-${width}.png`,
      fullPage: false,
    });
  }
  await popup.close();
  await expect(page.getByRole("alert")).toContainText(
    "Sunhub sign-in was canceled.",
  );
  const retry = await openPopup(page, "Create a Sunhub account");
  expect(new URL(retry.url()).searchParams.get("intent")).toBe("signup");
  expect(new URL(retry.url()).searchParams.get("popup_id")).not.toBe(firstId);
  await page
    .getByRole("button", { name: "Cancel Sunhub sign-in", exact: true })
    .click();
  await expect.poll(() => retry.isClosed()).toBe(true);
  await expect(
    page.getByRole("textbox", { name: "Work email", exact: true }),
  ).toHaveValue("kept@example.test");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "UnsavedLocalPassword123!",
  );
  const closing = await openPopup(page);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect.poll(() => closing.isClosed()).toBe(true);
  await expect(page).toHaveURL(/\/directory$/);
});

test("same-origin BroadcastChannel completes when the opener is unavailable and the popup closes first", async ({
  page,
  context,
}) => {
  await enabled(page);
  await popupProvider(context);
  let signedIn = false;
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: signedIn
        ? onboardingSession()
        : { user: null, companies: [], activeCompanyId: null },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await openPopup(page);
  signedIn = true;
  await popup.evaluate(() => {
    window.opener = null;
    const popupId = new URL(location.href).searchParams.get("popup_id");
    const channel = new BroadcastChannel("connect-sunhub-" + popupId);
    channel.postMessage({
      type: "connect:sunhub:complete",
      popupId,
      status: "success",
      returnTo: "/",
    });
    channel.close();
    window.close();
  });
  await expect(
    page.getByRole("heading", { name: "Introduce your company.", exact: true }),
  ).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
});
