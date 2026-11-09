import { test, expect } from "@playwright/test";

const windows = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1221, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 844, height: 390 },
];

for (const viewport of windows) {
  test(`directory controls remain usable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/directory");
    await expect(page.getByLabel("Search directory")).toBeVisible();
    await expect(page.locator(".discovery-card").first()).toBeVisible();

    const layout = await page.evaluate(() => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const controls = Array.from(
        document.querySelectorAll(
          ".header-actions .button, .primary-nav > a, .discovery-search .button, .discovery-categories button, .discovery-selects select, .discovery-certification-trigger",
        ),
      )
        .filter(visible)
        .map((element) => ({
          name:
            element.getAttribute("aria-label") || element.textContent?.trim(),
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        }));
      const signIn = document.querySelector(".header-actions .button.primary");
      const search = document.querySelector(
        ".discovery-search .button.primary",
      );
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        controls,
        primaryColors: [signIn, search].map((element) =>
          element ? getComputedStyle(element).backgroundColor : null,
        ),
        nav: document
          .querySelector(".primary-nav")!
          .getBoundingClientRect()
          .toJSON(),
        header: document
          .querySelector(".header-inner")!
          .getBoundingClientRect()
          .toJSON(),
        main: document
          .querySelector(".app-main")!
          .getBoundingClientRect()
          .toJSON(),
        discovery: document
          .querySelector(".discovery")!
          .getBoundingClientRect()
          .toJSON(),
      };
    });

    expect(layout.overflow).toBeLessThanOrEqual(1);
    for (const control of layout.controls) {
      expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(
        44,
      );
      expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
    }
    expect(layout.primaryColors[0]).toEqual("rgb(255, 107, 11)");
    expect(layout.primaryColors[1]).toEqual(layout.primaryColors[0]);
    if (viewport.width > 720) {
      for (const frame of [layout.header, layout.main, layout.discovery]) {
        expect(frame.width).toBeCloseTo(viewport.width * 0.8, 0);
        expect(frame.left).toBeCloseTo(viewport.width * 0.1, 0);
      }
    } else {
      expect(layout.header.left).toBeCloseTo(16, 0);
      expect(layout.main.left).toBeCloseTo(16, 0);
    }
    if (viewport.width <= 720) {
      expect(Math.round(layout.nav.bottom)).toEqual(viewport.height);
      const companyType = layout.controls.find(
        (control) => control.name === "Company type",
      );
      const certification = layout.controls.find(
        (control) => control.name === "Certifications and qualifications",
      );
      expect(certification?.width).toBeCloseTo(companyType!.width, 0);
    }

    await page
      .locator(".header-actions")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Work email")).toBeVisible();
    await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
    await dialog
      .getByLabel("Password", { exact: true })
      .fill("Temporary value");
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue(
      "Temporary value",
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
      "The account dialog must not clip fields horizontally",
    ).toBeLessThanOrEqual(1);
    const submit = dialog.getByRole("button", { name: "Sign in", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}
