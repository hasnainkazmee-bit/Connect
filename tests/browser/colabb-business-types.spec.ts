import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { companyTypes } from "../../apps/api/src/shared/company-types";

const companyIds: string[] = [],
  userIds: string[] = [];
let db: pg.Pool;
test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.pathname).toMatch(/_test$/);
  db = new pg.Pool({ connectionString: url.href });
});
test.afterAll(async () => {
  if (companyIds.length)
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companyIds,
    ]);
  if (userIds.length)
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
  await db.end();
});

async function owner(request: APIRequestContext, page: Page, complete = false) {
  const suffix = randomUUID();
  const result = await request.post("/api/auth/register", {
    data: {
      name: "Business Type Owner",
      companyName: "Type choice " + suffix,
      email: suffix + "@example.test",
      password: "BusinessTypeTest123!",
      ...(complete ? { type: "Installer" } : {}),
    },
  });
  expect(result.status()).toBe(201);
  const session = await result.json();
  userIds.push(session.user.id);
  companyIds.push(session.activeCompanyId);
  await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    session.user.id,
  ]);
  if (complete)
    expect(
      (
        await request.post("/api/onboarding/complete", {
          data: { followIds: [] },
        })
      ).ok(),
    ).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  return session.activeCompanyId as string;
}
async function openReady(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
}

for (const width of [1440, 390]) {
  test(`Onboarding requires a deliberate business type at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const id = await owner(request, page);
    expect(
      (await db.query("SELECT type FROM companies WHERE id=$1", [id])).rows[0]
        .type,
    ).toBe("");
    await openReady(page, "/");
    await expect(
      page.getByRole("heading", { name: "Make your capabilities clear." }),
    ).toBeVisible();
    const field = page.getByRole("combobox", {
      name: "Business type",
      exact: true,
    });
    await expect(field).toHaveValue("");
    await expect(field.locator("option:checked")).toHaveText(
      "Choose business type",
    );
    await expect(field.locator("option")).toHaveCount(companyTypes.length + 1);
    await page.getByLabel("Based in", { exact: true }).fill("Cleveland, OH");
    let submissions = 0;
    page.on("request", (r) => {
      if (
        new URL(r.url()).pathname === "/api/onboarding/company" &&
        r.method() === "POST"
      )
        submissions++;
    });
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await expect(field).toBeFocused();
    expect(submissions).toBe(0);
    await field.selectOption("Technology provider");
    await expect(page.locator("#onboarding-type-help")).toContainText(
      "software, platforms or digital tools",
    );
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`business-type-onboarding-${width}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "What’s next for your company?" }),
    ).toBeVisible();
    expect(
      (await db.query("SELECT type FROM companies WHERE id=$1", [id])).rows[0]
        .type,
    ).toBe("Technology provider");
    expect(submissions).toBe(1);
  });
}

test("New company requires a type, editor keeps legacy values, and discovery uses the same catalog", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await owner(request, page, true);
  await openReady(page, "/jobs");
  await page.locator(".account-menu>summary").click();
  await page
    .getByRole("button", { name: "Create a company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create your company", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const field = page.getByRole("combobox", {
    name: "Business type",
    exact: true,
  });
  await expect(field).toHaveValue("");
  await page
    .getByLabel("Company name", { exact: true })
    .fill("Software company " + randomUUID());
  let submissions = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/companies" && r.method() === "POST")
      submissions++;
  });
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(field).toBeFocused();
  expect(submissions).toBe(0);
  await field.selectOption("Technology provider");
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByText("Your company profile is ready to complete.", {
      exact: true,
    }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const id = session.activeCompanyId;
  companyIds.push(id);
  expect(session.companies.find((c: { id: string }) => c.id === id).type).toBe(
    "Technology provider",
  );
  expect(submissions).toBe(1);

  await openReady(page, "/settings/profile/overview");
  await expect(field).toHaveValue("Technology provider");
  await db.query("UPDATE companies SET type='' WHERE id=$1", [id]);
  await openReady(page, "/settings/profile/overview");
  await expect(field).toHaveValue("");
  await expect(field.locator("option:checked")).toHaveText(
    "Choose business type",
  );
  await db.query(
    "UPDATE companies SET type='Legacy solar specialist' WHERE id=$1",
    [id],
  );
  await openReady(page, "/settings/profile/overview");
  await expect(field).toHaveValue("Legacy solar specialist");
  await expect(field.locator("option:checked")).toHaveText(
    "Legacy solar specialist (current)",
  );
  await page
    .getByLabel(/^Short introduction/)
    .fill("Specialist tools and services for solar companies.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Changes saved", { exact: true }),
  ).toBeVisible();
  expect(
    (await db.query("SELECT type FROM companies WHERE id=$1", [id])).rows[0]
      .type,
  ).toBe("Legacy solar specialist");

  await openReady(page, "/providers");
  const filters = page.getByRole("combobox", {
    name: "Company type",
    exact: true,
  });
  await expect(filters.locator("option")).toHaveCount(companyTypes.length + 1);
  await filters.selectOption("Technology provider");
  await expect(page).toHaveURL(
    /kind=Technology\+provider|kind=Technology%20provider/,
  );
});
