import { test, expect, type Locator, type Page } from "@playwright/test";

async function fixture(page: Page, width: number, height: number) {
  const data = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ee2200";
      context.fillRect(0, 20, width / 2, height - 20);
      context.fillStyle = "#0033ff";
      context.fillRect(width / 2, 20, width / 2, height - 20);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height },
  );
  return {
    name: "company-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}

async function pixels(image: Locator) {
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  return image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      center: Array.from(
        context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data,
      ),
      corner: Array.from(context.getImageData(0, 0, 1, 1).data),
    };
  });
}

for (const width of [320, 390, 1440]) {
  test(`company photos preserve crop, transparency, and canceled changes at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: process.env.API_TEST_URL || "http://localhost:4101",
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const registration = await context.request.post("/api/auth/register", {
      data: {
        name: "Photo Owner",
        email: `photo-${width}-${Date.now()}@example.test`,
        password: "PhotoBrowser123!",
        companyName: `Solar Studio ${width} ${Date.now()}`,
      },
    });
    expect(registration.status()).toBe(201);
    const account = await registration.json();
    await page.goto("/company/" + account.activeCompanyId);
    const photo = await fixture(page, 800, 400);
    await page
      .getByRole("button", { name: "Edit company logo", exact: true })
      .click();
    const editor = page.locator(".modal:has(.brand-photo-editor)");
    await editor.locator("input[type=file]").setInputFiles(photo);
    const adjuster = page.getByRole("dialog", {
      name: "Adjust company logo",
      exact: true,
    });
    await expect(
      adjuster.getByRole("button", { name: "Use photo", exact: true }),
    ).toBeEnabled();
    await expect(
      adjuster.getByRole("slider", { name: "Photo zoom" }),
    ).toHaveValue("1");
    await adjuster.getByRole("slider", { name: "Photo zoom" }).focus();
    await page.keyboard.press("End");
    await expect(
      adjuster.getByRole("slider", { name: "Photo zoom" }),
    ).toHaveValue("3");
    await adjuster.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(
      adjuster.getByRole("button", { name: "Use photo", exact: true }),
    ).toBeEnabled();
    await expect(
      adjuster.getByRole("slider", { name: "Photo zoom" }),
    ).toHaveValue("1");
    const position = adjuster.getByRole("group", {
      name: "Photo position",
      exact: true,
    });
    await position.focus();
    for (let step = 0; step < 35; step++)
      await page.keyboard.press("ArrowLeft");
    expect(
      await adjuster.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/photo-adjustment-${width}.png`,
    });
    await adjuster
      .getByRole("button", { name: "Use photo", exact: true })
      .click();
    await expect(adjuster).toHaveCount(0);
    await expect(editor).toBeVisible();
    const preview = editor.getByRole("img", { name: "Logo preview" });
    const output = await pixels(preview);
    expect(output.width).toBe(400);
    expect(output.height).toBe(400);
    expect(output.center).toEqual([0, 51, 255, 255]);
    expect(output.corner[3]).toBe(0);
    const previous = await preview.getAttribute("src");
    await editor.locator("input[type=file]").setInputFiles(photo);
    await expect(adjuster).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(adjuster).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(preview).toHaveAttribute("src", previous!);
    await editor
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", { name: "Edit company logo", exact: true })
      .click();
    expect(await pixels(preview)).toEqual(output);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: "Edit cover", exact: true }).click();
    await editor
      .locator("input[type=file]")
      .setInputFiles(await fixture(page, 2400, 3000));
    const coverAdjuster = page.getByRole("dialog", {
      name: "Adjust cover photo",
      exact: true,
    });
    await expect(
      coverAdjuster.getByRole("button", { name: "Portrait 4:5", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await coverAdjuster
      .getByRole("button", { name: "Square 1:1", exact: true })
      .click();
    await coverAdjuster
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    await expect(
      coverAdjuster.getByRole("button", { name: "Portrait 4:5", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await coverAdjuster
      .getByRole("button", { name: "Use photo", exact: true })
      .click();
    const cover = await pixels(
      editor.getByRole("img", { name: "Cover preview" }),
    );
    expect(cover.width).toBe(1638);
    expect(cover.height).toBe(2048);
    await editor
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    const coverImage = page.locator(".presence-showcase.has-image > img");
    const saved = await pixels(coverImage);
    expect(saved.width).toBe(1638);
    expect(saved.height).toBe(2048);
    const bounds = await page
      .locator(".presence-showcase.has-image")
      .boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(0.8, 2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const stage of ["upload", "branding", "session"] as const) {
  test(`changing account cancels company photo ${stage} without touching the new editor`, async ({
    browser,
  }) => {
    const baseURL = process.env.API_TEST_URL || "http://localhost:4101";
    const context = await browser.newContext({ baseURL });
    const other = await browser.newContext({ baseURL });
    const suffix = `${Date.now()}-${stage}`,
      password = "PhotoOwnership123!";
    const otherEmail = `next-photo-${suffix}@example.test`;
    let owner: any;
    for (const [client, name, email] of [
      [context, "Original", `first-photo-${suffix}@example.test`],
      [other, "Replacement", otherEmail],
    ] as const) {
      const response = await client.request.post("/api/auth/register", {
        data: {
          name,
          email,
          password,
          companyName: `${name} Photo Solar ${suffix}`,
        },
      });
      expect(response.status()).toBe(201);
      if (client === context) owner = await response.json();
    }
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/company/" + owner.activeCompanyId);
    await page
      .getByRole("button", { name: "Edit company logo", exact: true })
      .click();
    const editor = page.locator(".brand-photo-editor");
    await editor
      .locator("input[type=file]")
      .setInputFiles(await fixture(page, 400, 400));
    await page
      .getByRole("dialog", { name: "Adjust company logo", exact: true })
      .getByRole("button", { name: "Use photo", exact: true })
      .click();
    const endpoint =
      stage === "upload"
        ? "/api/companies/current/assets"
        : stage === "branding"
          ? "/api/companies/current/branding"
          : "/api/session";
    let release!: () => void,
      started!: () => void,
      held = false;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.route(`**${endpoint}`, async (route) => {
      if (held) return route.continue();
      held = true;
      const response = await route.fetch();
      started();
      await pending;
      await route.fulfill({ response }).catch(() => {});
    });
    let brandingRequests = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/companies/current/branding") &&
        request.method() === "PUT"
      )
        brandingRequests++;
    });
    try {
      await editor
        .getByRole("button", { name: "Save photo", exact: true })
        .click();
      await requested;
      await expect(editor.locator(".branding-preview")).toBeDisabled();
      await expect(editor.locator("input[type=file]")).toBeDisabled();
      const aborted = page.waitForEvent("requestfailed", {
        predicate: (request) => request.url().endsWith(endpoint),
      });
      await context.request.post("/api/auth/logout");
      await page.evaluate(() =>
        window.dispatchEvent(new Event("connect:session-expired")),
      );
      const login = page
        .locator("dialog")
        .filter({ has: page.getByRole("heading", { name: "Welcome back." }) });
      await login.getByLabel("Work email", { exact: true }).fill(otherEmail);
      await login.getByLabel("Password", { exact: true }).fill(password);
      await login.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await aborted;
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await page
        .getByRole("button", {
          name: "What’s happening at your company?",
          exact: true,
        })
        .click();
      const writing = page.getByRole("textbox", { name: "Update content" });
      await writing.fill("Writing as the replacement company.");
      release();
      await expect(writing).toHaveText("Writing as the replacement company.");
      await expect(page.locator(".publisher-identity")).toContainText(
        `Replacement Photo Solar ${suffix}`,
      );
      expect(brandingRequests).toBe(stage === "upload" ? 0 : 1);
      expect(errors).toEqual([]);
    } finally {
      release();
      await context.close();
      await other.close();
    }
  });
}
