import { test, expect } from "@playwright/test";
for (const size of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
])
  test(
    "profile, invitation, and rich publishing on " + size.name,
    async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: process.env.API_TEST_URL || "http://localhost:4101",
        viewport: size,
      });
      const page = await context.newPage(),
        suffix = Date.now() + "-" + size.name,
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const owner = await (
        await context.request.post("/api/auth/register", {
          data: {
            name: "Company Owner",
            email: suffix + "@example.test",
            password: "ConnectManagement123!",
            companyName: "Cedar Studio " + suffix,
          },
        })
      ).json();
      await page.goto("/company/" + owner.activeCompanyId);
      await page
        .getByRole("button", { name: "Edit profile", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Company username", { exact: false })
        .fill("cedar-" + suffix);
      await dialog
        .getByLabel("Headline", { exact: false })
        .fill("Thoughtful energy for growing communities.");
      await dialog
        .getByLabel("About", { exact: true })
        .fill("We design and deliver commercial solar projects with care.");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText("@cedar-" + suffix, { exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp("/cedar-" + suffix + "$"));
      await page.reload();
      await page
        .getByRole("button", { name: "Invite employee", exact: true })
        .click();
      await expect(
        dialog.getByText(
          "Separate logins. One company profile. You can remove access anytime.",
        ),
      ).toBeVisible();
      await dialog
        .getByLabel("Employee’s work email")
        .fill("employee-" + suffix + "@example.test");
      await dialog.getByRole("radio", { name: /Administrator/ }).check();
      await dialog.getByRole("button", { name: "Create invitation" }).click();
      await expect(
        dialog.getByRole("heading", { name: "Your invitation is ready." }),
      ).toBeVisible();
      await expect(dialog.getByLabel("Invitation link")).toHaveValue(
        new RegExp("/join/cedar-" + suffix + "$"),
      );
      await page.screenshot({
        path: "test-results/employee-invite-" + size.name + ".png",
      });
      const employeeContext = await browser.newContext({
        baseURL: process.env.API_TEST_URL || "http://localhost:4101",
        viewport: size,
      });
      const employeePage = await employeeContext.newPage();
      await employeePage.goto("/join/cedar-" + suffix);
      await expect(
        employeePage.getByRole("button", {
          name: "Sign in or create an account",
        }),
      ).toBeVisible();
      await employeeContext.request.post("/api/auth/register", {
        data: {
          name: "Cedar Employee",
          email: "employee-" + suffix + "@example.test",
          password: "ConnectManagement123!",
          accountType: "company",
        },
      });
      await employeePage.reload();
      await expect(
        employeePage.getByText("Administrator access", { exact: true }),
      ).toBeVisible();
      await employeePage.screenshot({
        path: "test-results/company-welcome-" + size.name + ".png",
      });
      await employeePage
        .getByRole("button", {
          name: "Join Cedar Studio " + suffix,
          exact: true,
        })
        .click();
      await expect(employeePage).toHaveURL(
        new RegExp("/cedar-" + suffix + "$"),
      );
      await expect(
        employeePage.getByRole("button", { name: "Edit profile", exact: true }),
      ).toBeVisible();
      expect(
        await employeePage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await employeeContext.close();
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await page
        .getByRole("region", { name: "Create a post" })
        .getByRole("button", { name: "Article", exact: true })
        .click();
      await dialog
        .getByLabel("Story title")
        .fill("How we built a better rooftop");
      await dialog
        .getByLabel("Story subtitle")
        .fill("A practical story from our latest installation.");
      await dialog
        .getByRole("textbox", { name: "Story content" })
        .fill(
          "A good project begins with the people doing the work. Our team learned three important lessons.",
        );
      await dialog.getByRole("button", { name: "Save & close" }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "Drafts", exact: true }).click();
      await dialog
        .getByRole("button", { name: /How we built a better rooftop/ })
        .click();
      await expect(dialog.getByLabel("Story title")).toHaveValue(
        "How we built a better rooftop",
      );
      await dialog
        .getByRole("button", { name: "Preview", exact: true })
        .click();
      await expect(
        dialog.getByRole("heading", { name: "How we built a better rooftop" }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/publishing-preview-" + size.name + ".png",
      });
      await dialog
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("link", {
          name: "How we built a better rooftop",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Portfolio", exact: false })
        .click();
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      await dialog.getByLabel("Project name").fill("Community rooftop");
      await dialog
        .getByLabel("The story")
        .fill("A 200 kW rooftop installation for a local business.");
      await dialog.getByRole("button", { name: "Save project" }).click();
      await expect(
        page.getByRole("heading", { name: "Community rooftop" }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/profile-portfolio-" + size.name + ".png",
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      await context.close();
    },
  );
