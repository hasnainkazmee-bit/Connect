import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type CompanyAccount = {
  context: BrowserContext;
  page: Page;
  userId: string;
  email: string;
  companyId: string;
  companyName: string;
  username: string;
};

const companyIds: string[] = [];
const userIds: string[] = [];
const contexts: BrowserContext[] = [];
let db: pg.Pool;

test.beforeAll(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.pathname).toMatch(/_test$/);
  db = new pg.Pool({ connectionString: url.href });
});

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

test.afterAll(async () => {
  if (companyIds.length) {
    const connectionWhere =
      "SELECT id FROM connections WHERE company_a=ANY($1::uuid[]) OR company_b=ANY($1::uuid[])";
    await db.query(
      `DELETE FROM messages WHERE connection_id IN (${connectionWhere})`,
      [companyIds],
    );
    await db.query(
      `DELETE FROM conversation_reads WHERE connection_id IN (${connectionWhere})`,
      [companyIds],
    );
    await db.query(
      "DELETE FROM connections WHERE company_a=ANY($1::uuid[]) OR company_b=ANY($1::uuid[])",
      [companyIds],
    );
    await db.query(
      "DELETE FROM connection_requests WHERE from_id=ANY($1::uuid[]) OR to_id=ANY($1::uuid[])",
      [companyIds],
    );
    await db.query(
      "DELETE FROM notifications WHERE company_id=ANY($1::uuid[]) OR related_company_id=ANY($1::uuid[])",
      [companyIds],
    );
    await db.query(
      "DELETE FROM team_invites WHERE company_id=ANY($1::uuid[])",
      [companyIds],
    );
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companyIds,
    ]);
  }
  if (userIds.length)
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
  await db.end();
});

async function company(
  browser: Browser,
  baseURL: string,
  name: string,
  width = 1440,
  withCompany = true,
): Promise<CompanyAccount> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: width === 390 ? 844 : 1000 },
  });
  contexts.push(context);
  const suffix = randomUUID();
  const email = `${suffix}@example.test`;
  const response = await context.request.post("/api/auth/register", {
    data: {
      name,
      email,
      password: "CompanyInboxTest123!",
      ...(withCompany
        ? {
            companyName: `${name} Solar ${suffix.slice(0, 8)}`,
            type: "Installer",
          }
        : {}),
    },
  });
  expect(response.status()).toBe(201);
  const session = await response.json();
  userIds.push(session.user.id);
  if (session.activeCompanyId) companyIds.push(session.activeCompanyId);
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
  const active = session.companies.find(
    (c: { id: string }) => c.id === session.activeCompanyId,
  );
  return {
    context,
    page: await context.newPage(),
    userId: session.user.id,
    email,
    companyId: session.activeCompanyId || "",
    companyName: active?.name || "",
    username: active?.username || active?.slug || "",
  };
}

async function openReady(page: Page, path: string) {
  await page.bringToFront();
  await page.goto(path);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
}

function conversationPath(companyId?: string) {
  return "/inbox/companies" + (companyId ? `?company=${companyId}` : "");
}

async function network(account: CompanyAccount) {
  const response = await account.context.request.get("/api/network");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function sendRequest(
  account: CompanyAccount,
  recipient: CompanyAccount,
  note: string,
) {
  await openReady(account.page, conversationPath(recipient.companyId));
  await account.page.getByLabel("Message request", { exact: true }).fill(note);
  const sent = account.page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/requests" &&
      r.request().method() === "POST",
  );
  await account.page
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  expect((await sent).status()).toBe(201);
  await expect(
    account.page.getByRole("button", { name: "Withdraw request", exact: true }),
  ).toBeVisible();
  await expect(account.page.getByLabel("Message", { exact: true })).toHaveCount(
    0,
  );
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [1440, 390]) {
  test(`Company message requests become readable conversations with attachments at ${width}px`, async ({
    browser,
    baseURL,
  }, info) => {
    const sender = await company(browser, baseURL!, "Amina", width);
    const recipient = await company(browser, baseURL!, "Maya", width);
    const errors: string[] = [];
    sender.page.on("pageerror", (error) => errors.push(error.message));
    recipient.page.on("pageerror", (error) => errors.push(error.message));
    await openReady(sender.page, "/" + recipient.username);
    await sender.page
      .getByRole("link", {
        name: `Message ${recipient.companyName}`,
        exact: true,
      })
      .click();
    await expect(sender.page).toHaveURL(
      new RegExp(`/inbox/companies\\?company=${recipient.companyId}$`),
    );
    const intro =
      "Could we discuss electrical support for a commercial rooftop installation?";
    await sender.page
      .getByLabel("Message request", { exact: true })
      .fill(intro);
    const sent = sender.page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/requests" &&
        r.request().method() === "POST",
    );
    await sender.page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    expect((await sent).status()).toBe(201);
    await expect(
      sender.page.getByRole("button", {
        name: "Withdraw request",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      sender.page.getByLabel("Message", { exact: true }),
    ).toHaveCount(0);
    expect((await network(sender)).connections).toHaveLength(0);
    await noOverflow(sender.page);

    await openReady(recipient.page, "/inbox/companies?filter=requests");
    await recipient.page
      .getByRole("complementary", { name: "Company conversations" })
      .getByRole("link")
      .filter({ hasText: sender.companyName })
      .click();
    await expect(
      recipient.page
        .locator(".cmi-request-message")
        .getByText(intro, { exact: true }),
    ).toBeVisible();
    await expect(
      recipient.page.getByLabel("Message", { exact: true }),
    ).toHaveCount(0);
    await noOverflow(recipient.page);
    await recipient.page.screenshot({
      path: info.outputPath(`request-review-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await recipient.page
      .getByRole("button", { name: "Accept request", exact: true })
      .click();
    await expect(
      recipient.page.getByLabel("Message", { exact: true }),
    ).toBeVisible();
    const log = recipient.page.getByRole("log", { name: "Company messages" });
    await expect(log.getByText(intro, { exact: true })).toHaveCount(1);
    const connections = (await network(recipient)).connections;
    expect(connections).toHaveLength(1);
    const connectionId = connections[0].id;
    const initialMessages = await (
      await recipient.context.request.get(
        `/api/conversations/${connectionId}/messages`,
      )
    ).json();
    expect(
      initialMessages.messages.filter(
        (m: { body: string }) => m.body === intro,
      ),
    ).toHaveLength(1);

    if (width === 390) {
      await recipient.page
        .getByRole("link", { name: "Back to company inbox", exact: true })
        .click();
      await expect(
        recipient.page.getByLabel("Search company conversations", {
          exact: true,
        }),
      ).toBeVisible();
      await recipient.page
        .locator(".cmi-thread")
        .filter({ hasText: sender.companyName })
        .click();
      await expect(
        recipient.page.getByLabel("Message", { exact: true }),
      ).toBeVisible();
    }
    // Leave the sender on the list so the reply stays unread until they open it.
    await openReady(sender.page, conversationPath());
    await recipient.page.bringToFront();
    const replyText =
      "Yes. Here is a photo of a recent installation we can discuss.";
    await recipient.page.getByLabel("Message", { exact: true }).fill(replyText);
    await recipient.page
      .locator(".cmi-composer input[type=file]")
      .setInputFiles("apps/colabb/public/assets/solar.jpg");
    await recipient.page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Companies", exact: true })
      .click();
    await expect(
      recipient.page.getByRole("heading", {
        name: "You have unsaved changes.",
        exact: true,
      }),
    ).toBeVisible();
    await recipient.page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(
      recipient.page.getByLabel("Message", { exact: true }),
    ).toHaveValue(replyText);
    await expect(
      recipient.page.locator(".cmi-pending-files").getByRole("button", {
        name: "solar.jpg",
        exact: true,
      }),
    ).toBeVisible();
    await recipient.page
      .locator(".cmi-pending-files")
      .getByRole("button", { name: "solar.jpg", exact: true })
      .click();
    const preview = recipient.page.getByRole("region", {
      name: "Attachment preview",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "solar.jpg", exact: true }),
    ).toBeVisible();
    await recipient.page
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await expect(
      recipient.page.getByLabel("Message", { exact: true }),
    ).toHaveValue(replyText);
    const posted = recipient.page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          `/api/conversations/${connectionId}/messages` &&
        r.request().method() === "POST",
    );
    await recipient.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    expect((await posted).status()).toBe(201);
    await expect(log.getByText(replyText, { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await network(sender)).connections.find(
            (c: { id: string }) => c.id === connectionId,
          )?.unread,
      )
      .toBe(1);
    await openReady(sender.page, conversationPath());
    const row = sender.page
      .locator(".cmi-thread")
      .filter({ hasText: recipient.companyName });
    await expect(
      row.getByLabel("1 unread messages", { exact: true }),
    ).toBeVisible();
    await row.click();
    await expect(
      sender.page
        .getByRole("log", { name: "Company messages" })
        .getByText(replyText, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await network(sender)).connections.find(
            (c: { id: string }) => c.id === connectionId,
          )?.unread,
      )
      .toBe(0);
    await sender.page
      .getByRole("button", { name: "Preview solar.jpg", exact: true })
      .click();
    await expect(
      sender.page.getByRole("region", {
        name: "Attachment preview",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        sender.page
          .getByRole("region", { name: "Attachment preview", exact: true })
          .getByRole("img", { name: "solar.jpg", exact: true })
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    if (width === 1440) {
      // A full-screen file must not silently read incoming messages behind it.
      const reads: string[] = [];
      const observeReads = (request: import("@playwright/test").Request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname ===
            `/api/conversations/${connectionId}/messages`
        )
          reads.push(request.url());
      };
      sender.page.on("request", observeReads);
      const whileViewing = await recipient.context.request.post(
        `/api/conversations/${connectionId}/messages`,
        {
          multipart: {
            body: "Please review the roof access route in that photo.",
            clientId: randomUUID(),
          },
        },
      );
      expect(whileViewing.status()).toBe(201);
      // Cover one complete six-second inbox polling interval.
      await sender.page.waitForTimeout(6500);
      expect(reads).toEqual([]);
      expect(
        (await network(sender)).connections.find(
          (c: { id: string }) => c.id === connectionId,
        )?.unread,
      ).toBe(1);
      sender.page.off("request", observeReads);
    }
    await sender.page
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await sender.page.reload();
    await expect(sender.page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(
      sender.page
        .getByRole("log", { name: "Company messages" })
        .getByText(intro, { exact: true }),
    ).toHaveCount(1);
    await expect(
      sender.page.getByRole("button", {
        name: "Preview solar.jpg",
        exact: true,
      }),
    ).toBeVisible();
    await noOverflow(sender.page);
    await noOverflow(recipient.page);
    await sender.page.screenshot({
      path: info.outputPath(`company-conversation-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}

test("Declined and withdrawn introductions can be retried without opening a conversation", async ({
  browser,
  baseURL,
}) => {
  const sender = await company(browser, baseURL!, "Amina");
  const recipient = await company(browser, baseURL!, "Maya");
  await sendRequest(
    sender,
    recipient,
    "Could we discuss a possible installation partnership?",
  );
  await openReady(recipient.page, conversationPath(sender.companyId));
  await recipient.page
    .getByRole("button", { name: "Decline", exact: true })
    .click();
  await expect
    .poll(async () => (await network(recipient)).incoming.length)
    .toBe(0);
  expect((await network(recipient)).connections).toHaveLength(0);

  await sendRequest(
    sender,
    recipient,
    "We have a different project to discuss this time.",
  );
  await sender.page
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  await expect.poll(async () => (await network(sender)).sent.length).toBe(0);
  expect((await network(recipient)).incoming).toHaveLength(0);
  expect((await network(sender)).connections).toHaveLength(0);
  await sendRequest(
    sender,
    recipient,
    "Please let us know if you would like to talk next month.",
  );
  expect((await network(sender)).sent).toHaveLength(1);
  expect((await network(recipient)).incoming).toHaveLength(1);
  await noOverflow(sender.page);
});

test("Request drafts persist across reload and stay private to the acting company", async ({
  browser,
  baseURL,
}) => {
  const sender = await company(browser, baseURL!, "Draft Owner");
  const recipient = await company(browser, baseURL!, "Draft Recipient");
  await openReady(sender.page, conversationPath(recipient.companyId));
  const request = sender.page.getByLabel("Message request", { exact: true });
  await request.fill("A draft for our installation company.");
  await sender.page.reload();
  await expect(request).toHaveValue("A draft for our installation company.");

  const created = await sender.context.request.post("/api/companies", {
    data: {
      name: "Equipment Partner " + randomUUID(),
      type: "Equipment supplier",
    },
  });
  expect(created.status()).toBe(201);
  const companyResult = await created.json();
  const secondId = companyResult.id;
  expect(secondId).toBeTruthy();
  companyIds.push(secondId);
  expect(
    (
      await sender.context.request.post("/api/session/company", {
        data: { companyId: secondId },
      })
    ).ok(),
  ).toBeTruthy();
  await openReady(sender.page, conversationPath(recipient.companyId));
  await expect(request).toHaveValue("");
  await request.fill("A separate draft for our equipment company.");
  await sender.page.reload();
  await expect(request).toHaveValue(
    "A separate draft for our equipment company.",
  );
  expect(
    (
      await sender.context.request.post("/api/session/company", {
        data: { companyId: sender.companyId },
      })
    ).ok(),
  ).toBeTruthy();
  await openReady(sender.page, conversationPath(recipient.companyId));
  await expect(request).toHaveValue("A draft for our installation company.");
  expect((await network(sender)).sent).toHaveLength(0);
});

test("Members can reply after consent but cannot initiate or accept requests; own and unclaimed profiles stay protected", async ({
  browser,
  baseURL,
}) => {
  const sender = await company(browser, baseURL!, "Alex");
  const owner = await company(browser, baseURL!, "Morgan");
  const member = await company(browser, baseURL!, "Team Member", 390, false);
  const invitation = await owner.context.request.post("/api/team/invites", {
    data: {
      email: member.email,
      role: "member",
      jobTitle: "Project coordinator",
    },
  });
  expect(invitation.status()).toBe(201);
  const inviteSlug = (await invitation.json()).url.split("/").at(-1);
  expect(
    (
      await member.context.request.post(`/api/join/${inviteSlug}/accept`, {
        data: {},
      })
    ).ok(),
  ).toBeTruthy();
  member.companyId = owner.companyId;

  await openReady(member.page, conversationPath(sender.companyId));
  await expect(
    member.page.getByLabel("Message request", { exact: true }),
  ).toHaveCount(0);
  await expect(
    member.page.getByRole("button", { name: "Send request", exact: true }),
  ).toHaveCount(0);
  await sendRequest(
    sender,
    owner,
    "Can your team help with the electrical installation?",
  );
  await openReady(member.page, conversationPath(sender.companyId));
  await expect(
    member.page.getByRole("button", { name: "Accept request", exact: true }),
  ).toHaveCount(0);
  await expect(
    member.page.getByRole("button", { name: "Decline", exact: true }),
  ).toHaveCount(0);
  await expect(member.page.getByLabel("Message", { exact: true })).toHaveCount(
    0,
  );
  const pending = (await network(owner)).incoming[0];
  expect(
    (
      await owner.context.request.post(`/api/requests/${pending.id}/respond`, {
        data: { action: "accept" },
      })
    ).ok(),
  ).toBeTruthy();
  await openReady(member.page, conversationPath(sender.companyId));
  await member.page
    .getByLabel("Message", { exact: true })
    .fill("Our coordinator can help schedule the work.");
  const reply = member.page.waitForResponse(
    (r) =>
      /\/api\/conversations\/[^/]+\/messages$/.test(
        new URL(r.url()).pathname,
      ) && r.request().method() === "POST",
  );
  await member.page
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  expect((await reply).status()).toBe(201);
  await noOverflow(member.page);
  await openReady(owner.page, conversationPath(sender.companyId));
  await expect(
    owner.page
      .locator(".cmi-message")
      .filter({ hasText: "Our coordinator can help schedule the work." })
      .locator(".cmi-message-by"),
  ).toContainText("Team Member");

  await openReady(owner.page, "/" + owner.username);
  await expect(
    owner.page.getByRole("link", {
      name: `Message ${owner.companyName}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    owner.page.getByRole("button", {
      name: `Message ${owner.companyName}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await openReady(owner.page, conversationPath(owner.companyId));
  await expect(
    owner.page.getByLabel("Message request", { exact: true }),
  ).toHaveCount(0);
  const slug = "unclaimed-inbox-" + randomUUID().slice(0, 8);
  const unclaimed = (
    await db.query(
      "INSERT INTO companies(name,slug,username,type,listing_status,website) VALUES($1,$2,$2,'Installer','unclaimed','https://official.example.test') RETURNING id",
      ["Unclaimed Partner", slug],
    )
  ).rows[0];
  companyIds.push(unclaimed.id);
  await openReady(owner.page, conversationPath(unclaimed.id));
  await expect(
    owner.page.getByLabel("Message request", { exact: true }),
  ).toHaveCount(0);
  await expect(
    owner.page.getByRole("heading", {
      name: "This company isn’t ready to receive messages.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    owner.page.getByRole("link", { name: "View company profile", exact: true }),
  ).toHaveAttribute("href", "/" + slug);
  await noOverflow(owner.page);
});

test("Earlier messages remain after the latest page advances, and new replies stay in view", async ({
  browser,
  baseURL,
}) => {
  const sender = await company(browser, baseURL!, "History Sender");
  const recipient = await company(browser, baseURL!, "History Recipient");
  const introduction =
    "The original project introduction stays in this conversation.";
  const request = await sender.context.request.post("/api/requests", {
    data: {
      companyId: recipient.companyId,
      kind: "message",
      note: introduction,
    },
  });
  expect(request.status()).toBe(201);
  const pending = (await network(recipient)).incoming[0];
  const accepted = await recipient.context.request.post(
    `/api/requests/${pending.id}/respond`,
    { data: { action: "accept" } },
  );
  expect(accepted.ok()).toBeTruthy();
  const connectionId = (await accepted.json()).connectionId;
  // This is deliberately test-only history; consent and all new messages use
  // the normal API. Enough rows exercise the real 100-message rolling page.
  await db.query(
    `INSERT INTO messages(connection_id,sender_company_id,author_id,body)
     SELECT $1,$2,$3,'Historical project note ' || n
     FROM generate_series(1,110) n ORDER BY n`,
    [connectionId, recipient.companyId, recipient.userId],
  );
  await openReady(sender.page, conversationPath(recipient.companyId));
  const history = sender.page.getByRole("log", { name: "Company messages" });
  await expect(history.locator(".cmi-message")).toHaveCount(100);
  await sender.page
    .getByRole("button", { name: "Load earlier messages", exact: true })
    .click();
  await expect(history.locator(".cmi-message")).toHaveCount(111);
  await expect(history.getByText(introduction, { exact: true })).toHaveCount(1);
  await expect(
    sender.page.getByRole("button", {
      name: "Load earlier messages",
      exact: true,
    }),
  ).toHaveCount(0);
  await history.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const reply =
    "Thanks. We have reviewed all the earlier project notes.\nThe scope is clear.";
  const composer = sender.page.getByLabel("Message", { exact: true });
  await composer.fill(
    "Thanks. We have reviewed all the earlier project notes.",
  );
  await composer.press("Shift+Enter");
  await composer.pressSequentially("The scope is clear.");
  await expect(composer).toHaveValue(reply);
  await expect(history.locator(".cmi-message")).toHaveCount(111);
  await composer.press("Enter");
  await expect(history.locator(".cmi-message")).toHaveCount(112);
  await expect(history.getByText(introduction, { exact: true })).toHaveCount(1);
  await expect(history.getByText(reply, { exact: true })).toBeInViewport();
  const ownReplyBounds = await history
    .locator(".cmi-message")
    .last()
    .boundingBox();
  const firstHistoryBounds = await history.boundingBox();
  expect(ownReplyBounds!.y + ownReplyBounds!.height).toBeLessThanOrEqual(
    firstHistoryBounds!.y + firstHistoryBounds!.height,
  );

  const lastReply = "Confirmed. The crew is scheduled for Monday morning.";
  const incoming = await recipient.context.request.post(
    `/api/conversations/${connectionId}/messages`,
    { multipart: { body: lastReply, clientId: randomUUID() } },
  );
  expect(incoming.status()).toBe(201);
  await expect(history.getByText(lastReply, { exact: true })).toBeInViewport({
    timeout: 15000,
  });
  await expect(history.locator(".cmi-message")).toHaveCount(113);
  await expect(history.getByText(introduction, { exact: true })).toHaveCount(1);
  const lastBounds = await history.locator(".cmi-message").last().boundingBox();
  const historyBounds = await history.boundingBox();
  expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(
    historyBounds!.y + historyBounds!.height,
  );
  await expect
    .poll(
      async () =>
        (await network(sender)).connections.find(
          (c: { id: string }) => c.id === connectionId,
        )?.unread,
    )
    .toBe(0);

  // Polling can load a new reply while the reader is reviewing older messages.
  // That reply must remain unread until it actually enters the visible history.
  await history.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const unseenReply =
    "One more detail: the site contact will meet the crew at the gate.";
  const unseen = await recipient.context.request.post(
    `/api/conversations/${connectionId}/messages`,
    { multipart: { body: unseenReply, clientId: randomUUID() } },
  );
  expect(unseen.status()).toBe(201);
  await expect(history.getByText(unseenReply, { exact: true })).toHaveCount(1, {
    timeout: 15000,
  });
  await expect(
    history.getByText(unseenReply, { exact: true }),
  ).not.toBeInViewport();
  expect(
    (await network(sender)).connections.find(
      (c: { id: string }) => c.id === connectionId,
    )?.unread,
  ).toBe(1);
  await expect(
    history.getByText(introduction, { exact: true }),
  ).toBeInViewport();
  await history.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(
    history.getByText(unseenReply, { exact: true }),
  ).toBeInViewport();
  await expect
    .poll(
      async () =>
        (await network(sender)).connections.find(
          (c: { id: string }) => c.id === connectionId,
        )?.unread,
      { timeout: 10000 },
    )
    .toBe(0);
  const otherTab = await sender.context.newPage();
  await otherTab.goto("about:blank");
  // Playwright keeps every Chromium page artificially focused by default.
  // Disable that emulation while checking native background-tab behavior.
  const focusSession = await sender.context.newCDPSession(sender.page);
  await focusSession.send("Emulation.setFocusEmulationEnabled", {
    enabled: false,
  });
  await otherTab.bringToFront();
  await expect
    .poll(() => sender.page.evaluate(() => document.hasFocus()))
    .toBe(false);
  const whileUnfocused = await recipient.context.request.post(
    `/api/conversations/${connectionId}/messages`,
    {
      multipart: {
        body: "The access plan is ready whenever you return.",
        clientId: randomUUID(),
      },
    },
  );
  expect(whileUnfocused.status()).toBe(201);
  await otherTab.waitForTimeout(6500);
  expect(
    (await network(sender)).connections.find(
      (c: { id: string }) => c.id === connectionId,
    )?.unread,
  ).toBe(1);
  await focusSession.send("Emulation.setFocusEmulationEnabled", {
    enabled: true,
  });
  await sender.page.bringToFront();
  await expect
    .poll(
      async () =>
        (await network(sender)).connections.find(
          (c: { id: string }) => c.id === connectionId,
        )?.unread,
      { timeout: 10000 },
    )
    .toBe(0);
  await focusSession.detach();
  await otherTab.close();
  await noOverflow(sender.page);
});
