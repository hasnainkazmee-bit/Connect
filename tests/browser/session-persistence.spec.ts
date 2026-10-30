import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`session persistence, profile close, and recovery at ${viewport.width}px`, async ({
    browser,
  }) => {
    test.setTimeout(75000);
    const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
    let context = await browser.newContext({ baseURL, viewport });
    const suffix = Date.now() + "-" + viewport.width;
    const email = `persistence-${suffix}@example.test`,
      password = "ConnectSession123!";
    const registered = await context.request.post("/api/auth/register", {
      data: {
        name: "Session Owner",
        companyName: "Session Solar " + suffix,
        email,
        password,
      },
    });
    expect(registered.status()).toBe(201);
    const owner = await registered.json();
    // Reproduce a more-specific Sunhub cookie preceding the original Connect cookie.
    await context.clearCookies({ name: "connect_session" });
    await context.addCookies([
      {
        name: "sunhub_session",
        value: "a".repeat(64),
        domain: "localhost",
        path: "/api",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    let page = await context.newPage();
    await page.goto("/messages");
    await expect(
      page.getByRole("button", { name: "All companies", exact: true }),
    ).toBeVisible();
    const scoped = (await context.cookies()).find(
      (cookie) => cookie.name === "connect_session",
    );
    expect(scoped?.expires).toBeGreaterThan(Date.now() / 1000);
    expect(scoped?.httpOnly).toBe(true);
    const persisted = await context.storageState();
    await context.close();
    context = await browser.newContext({
      baseURL,
      viewport,
      storageState: persisted,
    });
    page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/company/" + owner.activeCompanyId);
    const edit = page.getByRole("button", {
      name: "Edit profile",
      exact: true,
    });
    await edit.click();
    const editor = page
      .locator("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Make a great introduction." }),
      });
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await edit.click();
    await editor
      .getByLabel("Headline", { exact: false })
      .fill("A profile worth keeping.");
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeInViewport();
    await expect(
      confirmation.getByRole("button", { name: "Keep editing" }),
    ).toBeFocused();
    await page.screenshot({
      path: `test-results/close-profile-${viewport.width}.png`,
    });
    await confirmation.getByRole("button", { name: "Keep editing" }).click();
    await expect(editor.getByLabel("Headline", { exact: false })).toHaveValue(
      "A profile worth keeping.",
    );
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await confirmation.getByRole("button", { name: "Discard changes" }).click();
    await expect(editor).toHaveCount(0);
    await edit.click();
    await expect(
      editor.getByLabel("Headline", { exact: false }),
    ).not.toHaveValue("A profile worth keeping.");
    await editor
      .getByLabel("Headline", { exact: false })
      .fill("This draft survives signing back in.");
    await context.request.post("/api/auth/logout");
    await editor
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const login = page
      .locator("dialog")
      .filter({ has: page.getByRole("heading", { name: "Welcome back." }) });
    await expect(login).toBeVisible();
    await login.getByLabel("Work email", { exact: true }).fill(email);
    await login.getByLabel("Password", { exact: true }).fill(password);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login).toHaveCount(0);
    await expect(editor.getByLabel("Headline", { exact: false })).toHaveValue(
      "This draft survives signing back in.",
    );
    await editor
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", { name: "Invite employee", exact: true })
      .click();
    const invite = page
      .locator("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Invite an employee" }),
      });
    const employee = `employee-${suffix}@example.test`;
    await invite.getByLabel("Employee’s work email").fill(employee);
    await context.request.post("/api/auth/logout");
    await invite.getByRole("button", { name: "Create invitation" }).click();
    await expect(login).toBeVisible();
    // Closing sign-in must not trigger the invitation's dirty-form guard.
    await login
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(login).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    await expect(invite.getByLabel("Employee’s work email")).toHaveValue(
      employee,
    );
    await invite.getByRole("button", { name: "Create invitation" }).click();
    await expect(login).toBeVisible();
    await login.getByLabel("Work email", { exact: true }).fill(email);
    await login.getByLabel("Password", { exact: true }).fill(password);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login).toHaveCount(0);
    await expect(invite.getByLabel("Employee’s work email")).toHaveValue(
      employee,
    );
    await invite.getByRole("button", { name: "Create invitation" }).click();
    await expect(
      page.getByRole("heading", { name: "Your invitation is ready." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.goto("/messages");
    await expect(
      page.getByRole("button", { name: "All companies", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "All companies", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
}
