import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const password = "MessageEntryTest123!";
const contexts: BrowserContext[] = [];
const companies: string[] = [];
const users: string[] = [];
let db: pg.Pool;

test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  const database = new URL(process.env.DATABASE_URL!);
  expect(database.pathname).toMatch(/_test$/);
  db = new pg.Pool({ connectionString: database.href });
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});
test.afterAll(async () => {
  if (companies.length)
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companies,
    ]);
  if (users.length)
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await db.end();
});

async function account(browser: Browser, baseURL: string, label: string) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(context);
  const suffix = randomUUID(),
    email = `${suffix}@example.test`;
  const registered = await context.request.post("/api/auth/register", {
    data: {
      name: label,
      email,
      password,
      companyName: `${label} Solar ${suffix.slice(0, 8)}`,
      type: "Installer",
    },
  });
  expect(registered.status()).toBe(201);
  const session = await registered.json();
  companies.push(session.activeCompanyId);
  users.push(session.user.id);
  await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    session.user.id,
  ]);
  expect(
    (
      await context.request.post("/api/onboarding/complete", {
        data: { followIds: [] },
      })
    ).ok(),
  ).toBeTruthy();
  const company = session.companies.find(
    (c: { id: string }) => c.id === session.activeCompanyId,
  );
  return { context, page: await context.newPage(), company, email };
}

async function ready(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#colabb-startup")).toBeHidden();
}
const inbox = (id: string) => `/inbox/companies?company=${id}`;

test("A guest can sign in from Message company and return to that company", async ({
  browser,
  baseURL,
}) => {
  const sender = await account(browser, baseURL!, "Entry Sender");
  const recipient = await account(browser, baseURL!, "Entry Recipient");
  for (const entry of ["profile", "direct"]) {
    const guest = await browser.newContext({ baseURL });
    contexts.push(guest);
    const page = await guest.newPage();
    await ready(
      page,
      entry === "profile"
        ? `/${recipient.company.username || recipient.company.slug}`
        : inbox(recipient.company.id),
    );
    await page
      .getByRole("button", {
        name:
          entry === "profile"
            ? `Message ${recipient.company.name}`
            : "Sign in to message",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await page.getByLabel("Email address", { exact: true }).fill(sender.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .locator(".account-authentication")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/inbox/companies\\?company=${recipient.company.id}$`),
    );
    await expect(
      page.getByLabel("Message request", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Inbox", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      (await (await guest.request.get("/api/network")).json()).sent,
    ).toHaveLength(0);
  }
});

test("Old company message and request URLs retain their destination in the new inbox", async ({
  browser,
  baseURL,
}) => {
  const sender = await account(browser, baseURL!, "Legacy Sender");
  const recipient = await account(browser, baseURL!, "Legacy Recipient");
  for (const path of [
    `/messages/company/${recipient.company.id}`,
    `/messages?company=${recipient.company.id}`,
  ]) {
    await ready(sender.page, path);
    await expect(sender.page).toHaveURL(
      new RegExp(`/inbox/companies\\?company=${recipient.company.id}$`),
    );
    await expect(
      sender.page.getByLabel("Message request", { exact: true }),
    ).toBeVisible();
  }
  await ready(sender.page, inbox(recipient.company.id) + "&filter=unread");
  await expect(sender.page).toHaveURL(
    new RegExp(
      `/inbox/companies\\?company=${recipient.company.id}&filter=unread$`,
    ),
  );
  await expect(
    sender.page.getByRole("button", { name: "Unread", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const oldConversation = randomUUID();
  await ready(sender.page, `/messages/${oldConversation}`);
  await expect(sender.page).toHaveURL(
    new RegExp(`/inbox/companies\\?conversation=${oldConversation}$`),
  );
  await expect(
    sender.page.getByRole("heading", { name: "Conversation unavailable" }),
  ).toBeVisible();
  await ready(sender.page, "/requests");
  await expect(sender.page).toHaveURL(/\/inbox\/companies\?filter=requests$/);
  await expect(
    sender.page.getByRole("button", { name: "Requests", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await ready(sender.page, "/messages");
  await expect(sender.page).toHaveURL(/\/inbox\/companies$/);
});

test("Directory and maintained company pages expose the same message destination without crowding their actions", async ({
  browser,
  baseURL,
}, testInfo) => {
  const sender = await account(browser, baseURL!, "Directory Sender");
  const recipient = await account(browser, baseURL!, "Directory Recipient");
  const page = sender.page;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await ready(
      page,
      `/providers?q=${encodeURIComponent(recipient.company.name)}`,
    );
    const card = page.locator(".cd-company").filter({
      has: page.getByRole("heading", {
        name: recipient.company.name,
        exact: true,
      }),
    });
    const directoryMessage = card.getByRole("link", {
      name: `Message ${recipient.company.name}`,
      exact: true,
    });
    await expect(directoryMessage).toHaveAttribute(
      "href",
      inbox(recipient.company.id),
    );
    await directoryMessage.scrollIntoViewIfNeeded();
    await expect(directoryMessage).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await card.screenshot({
      path: testInfo.outputPath(`directory-entry-${width}.png`),
    });
    await ready(page, `/network/companies/${recipient.company.id}`);
    const header = page.locator(".nw-company-header");
    await expect(
      header.getByRole("link", {
        name: `Message ${recipient.company.name}`,
        exact: true,
      }),
    ).toHaveAttribute("href", inbox(recipient.company.id));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await header.screenshot({
      path: testInfo.outputPath(`network-entry-${width}.png`),
    });
  }
});
