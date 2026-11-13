import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import { chromium, expect } from "@playwright/test";

// This suite creates and removes its own local fixtures. No production accounts,
// saved browser sessions, mail delivery, or notification devices are used.
const base = process.env.MARKETPLACE_TEST_URL || "http://localhost:4210";
const requestOrigin = process.env.MARKETPLACE_TEST_ORIGIN || base;
const database = new URL(process.env.DATABASE_URL);
if (
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base) ||
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(requestOrigin) ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.endsWith("_test")
)
  throw new Error(
    "Chat workspace tests require an isolated local app and test database.",
  );
const output =
  process.env.MARKETPLACE_SCREENSHOTS ||
  "/private/tmp/connect-chat-workspace-qa";
await fs.mkdir(output, { recursive: true });
const db = new pg.Client({ connectionString: database.href });
await db.connect();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  args: ["--disable-quic"],
});
const users = [],
  companies = [],
  jobs = [],
  errors = [];
const suffix = randomUUID().slice(0, 8);
const activityReadOnly = process.env.CHAT_ACTIVITY_READ_ONLY === "1";
let inspectedPage;
const reads = [];
async function account(name, sharedCompany) {
  const user = randomUUID(),
    company = sharedCompany || randomUUID();
  users.push(user);
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,$3,'isolated-fixture-no-login',now(),now())",
    [user, `workspace-${user}@example.test`, name],
  );
  if (!sharedCompany) {
    companies.push(company);
    await db.query(
      "INSERT INTO companies(id,slug,username,name,listing_status) VALUES($1,$2,$2,$3,'managed')",
      [company, `workspace-${company.slice(0, 8)}`, name],
    );
  }
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
    [user, company],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), user, company],
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  if (requestOrigin !== base)
    await context.route("**/api/**", async (route) => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method()))
        return route.continue();
      const response = await route.fetch({
        headers: { ...route.request().headers(), origin: requestOrigin },
      });
      return route.fulfill({ response });
    });
  await context.addCookies([
    {
      name: "connect_session",
      value: token,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return { user, company, context };
}
async function call(actor, path, body) {
  const response =
    body === undefined
      ? await actor.context.request.get(base + "/api" + path)
      : await actor.context.request.post(base + "/api" + path, {
          data: body,
          headers: { Origin: requestOrigin },
        });
  assert.ok(
    response.ok(),
    `${path}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
}
async function bounds(page, width) {
  const result = await page.evaluate(() => {
    const composer = document
      .querySelector(".inbox-composer")
      ?.getBoundingClientRect();
    const feed = document
      .querySelector(".inbox-message-scroll")
      ?.getBoundingClientRect();
    return {
      horizontal: document.documentElement.scrollWidth > innerWidth + 1,
      vertical: document.documentElement.scrollHeight > innerHeight + 1,
      composerBottom: composer?.bottom,
      feedHeight: feed?.height,
      height: innerHeight,
    };
  });
  assert.equal(
    result.horizontal,
    false,
    `Horizontal overflow at ${width}: ${JSON.stringify(result)}`,
  );
  assert.equal(
    result.vertical,
    false,
    `Page overflow at ${width}: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.composerBottom <= result.height + 1,
    `Composer is visible at ${width}`,
  );
  assert.ok(
    result.feedHeight > result.height * 0.5,
    `Messages retain most of the viewport at ${width}: ${JSON.stringify(result)}`,
  );
}
try {
  const hirer = await account(`Sunhub QA ${suffix}`);
  const secondReader = activityReadOnly
    ? await account("Second hiring company reviewer", hirer.company)
    : null;
  const provider = await account(`Summit QA ${suffix}`);
  const teammate = await account("Maya at Summit", provider.company);
  const tasks = [
    { id: randomUUID(), title: "Site layout" },
    { id: randomUUID(), title: "Electrical checks" },
  ];
  const created = await call(hirer, "/jobs", {
    title: `250 kW rooftop installation ${suffix}`,
    description:
      "LOCAL TEST ONLY: Install rooftop modules and complete electrical checks. Share photos and testing documents for each task.",
    trade: "installation",
    location: "Cleveland, OH",
    budgetCents: 15000000,
    workChecklist: tasks,
  });
  const job = created.id;
  jobs.push(job);
  const quote = await call(provider, `/jobs/${job}/quote`, {
    amountCents: 14500000,
    note: "Our crew will install the system and submit proof for each task.",
    startWindow: "January 15, 2027",
    duration: "4 weeks",
  });
  await call(hirer, `/jobs/${job}/choose`, {
    quoteId: quote.id,
    version: quote.version,
  });
  await call(provider, `/jobs/${job}/confirm`, {
    decision: "accept",
    quoteId: quote.id,
    version: quote.version,
  });
  async function proof(item) {
    const detail = await call(provider, `/jobs/${job}`);
    const prepared = await call(
      provider,
      `/jobs/${job}/checklist/${item.id}/submissions`,
      {
        version: detail.job.checklist_version,
        clientId: randomUUID(),
        attachmentCount: 1,
        note: `${item.title} is ready for review. Photo evidence is attached.${activityReadOnly && item.id === tasks[1].id ? "\n" + "Electrical test measurements and site observations are included in the evidence. ".repeat(28) : ""}`,
      },
    );
    const upload = await provider.context.request.post(
      base +
        `/api/jobs/${job}/files?updateId=${prepared.updateId}&uploadId=${randomUUID()}&name=${encodeURIComponent(item.title + ".jpg")}`,
      {
        data: await fs.readFile("apps/web/public/assets/solar.jpg"),
        headers: { Origin: requestOrigin, "Content-Type": "image/jpeg" },
      },
    );
    assert.equal(upload.status(), 201, await upload.text());
    await call(
      provider,
      `/jobs/${job}/updates/${prepared.updateId}/publish`,
      {},
    );
    return prepared;
  }
  const firstProof = await proof(tasks[0]);
  const detail = await call(hirer, `/jobs/${job}`);
  await call(hirer, `/jobs/${job}/checklist/${tasks[0].id}/review`, {
    version: detail.job.checklist_version,
    submissionId: firstProof.submissionId,
    decision: "approve",
  });
  await proof(tasks[1]);
  const send = (actor, body) =>
    call(actor, `/jobs/${job}/messages`, {
      providerId: provider.company,
      clientId: randomUUID(),
      body,
    });
  const firstMessage = await send(
    provider,
    "The revised roof layout is ready.",
  );
  const groupedMessage = await send(
    provider,
    "Please keep the east access route clear.",
  );
  const staffMessage = await send(
    teammate,
    "I have marked the route on the new drawing.",
  );
  await send(hirer, "Thanks. Can your crew start at 8 tomorrow?");
  await send(provider, "Yes, we will be there at 8.");
  await db.query(
    "INSERT INTO job_messages(job_id,provider_company_id,sender_company_id,author_id,body,created_at) SELECT $1,$2,$2,$3,'Earlier schedule discussion '||n,now()-interval '2 days'+n*interval '1 minute' FROM generate_series(1,55) n",
    [job, provider.company, provider.user],
  );
  if (activityReadOnly) {
    const event = (
      await db.query(
        "SELECT id::text FROM job_conversation_events WHERE job_id=$1 AND provider_company_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [job, provider.company],
      )
    ).rows[0];
    const unreadEvent = async (actor) => {
      const result = await db.query(
        "SELECT read_at FROM user_notifications WHERE user_id=$1 AND event_key=$2",
        [actor.user, `job-event:${event.id}`],
      );
      assert.equal(result.rows.length, 1);
      return result.rows[0].read_at === null;
    };
    const path = `/jobs/inbox?job=${job}&provider=${provider.company}`;
    const mobile = await hirer.context.newPage();
    inspectedPage = mobile;
    await mobile.setViewportSize({ width: 390, height: 740 });
    await mobile.goto(base + path);
    await mobile.bringToFront();
    await expect(
      mobile.getByLabel("Job message", { exact: true }),
    ).toBeVisible();
    assert.equal(
      await unreadEvent(hirer),
      true,
      "Hidden Activity does not mark workflow events read",
    );
    await mobile.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(mobile.locator(".project-activity-proof")).toBeVisible();
    const size = await mobile
      .locator(".project-activity-proof")
      .evaluate((node) => ({
        card: node.getBoundingClientRect().height,
        viewport: node
          .closest(".project-activity-scroll")
          .getBoundingClientRect().height,
      }));
    assert.ok(
      size.card > size.viewport,
      "Proof card is deliberately taller than its viewport",
    );
    await expect.poll(() => unreadEvent(hirer), { timeout: 12000 }).toBe(false);
    await mobile.screenshot({ path: output + "/mobile-tall-proof-read.png" });
    await mobile.close();
    const all = await secondReader.context.newPage();
    inspectedPage = all;
    let blockInitialRead = true;
    await all.route(base + `/api/jobs/${job}/events/read`, async (route) => {
      if (blockInitialRead)
        return route.fulfill({
          status: 503,
          json: {
            error: "Isolated test: defer read until All updates is visible.",
          },
        });
      const response = await route.fetch({
        headers: { ...route.request().headers(), origin: requestOrigin },
      });
      return route.fulfill({ response });
    });
    await all.goto(base + path);
    await all.bringToFront();
    await expect(
      all.getByRole("complementary", { name: "Job activity" }),
    ).toBeVisible();
    assert.equal(await unreadEvent(secondReader), true);
    blockInitialRead = false;
    await all.getByRole("button", { name: "All updates", exact: true }).click();
    await expect(
      all.locator(`.project-activity-history [data-event-id="${event.id}"]`),
    ).toBeVisible();
    assert.ok(
      (await all.locator(`[data-event-id="${event.id}"]`).count()) >= 2,
      "Hidden Needs review card and visible history row refer to the same event",
    );
    await expect
      .poll(() => unreadEvent(secondReader), { timeout: 12000 })
      .toBe(false);
    await all.screenshot({ path: output + "/desktop-all-updates-read.png" });
    console.log(
      JSON.stringify({
        status: "passed",
        checks:
          "tall proof heading marks read; hidden Activity stays unread; visible All updates duplicate marks read independently per employee",
      }),
    );
  } else {
    const page = await hirer.context.newPage();
    inspectedPage = page;
    page.on("response", (response) => {
      if (/\/messages\/read|\/events\/read/.test(response.url()))
        reads.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const path = `/jobs/inbox?job=${job}&provider=${provider.company}`;
    const unreadMessage = async (messageId) => {
      const result = await db.query(
        "SELECT read_at FROM user_notifications WHERE user_id=$1 AND event_key=$2",
        [hirer.user, `job-message:${messageId}`],
      );
      assert.equal(
        result.rows.length,
        1,
        "The incoming message has one recipient notification",
      );
      return result.rows[0].read_at === null;
    };
    await page.goto(base + path);
    await page.bringToFront();
    await expect(page.getByLabel("Job message", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Job activity" }),
    ).toBeVisible();
    await expect(page.locator(".inbox-sidebar")).toBeHidden();
    await expect(
      page.locator(".inbox-conversation .project-system-event"),
    ).toHaveCount(0);
    const activity = page.getByRole("complementary", { name: "Job activity" });
    await activity
      .getByRole("button", { name: "All updates", exact: true })
      .click();
    await expect(activity.locator(".project-activity-history")).toContainText(
      "Site layout",
    );
    await expect(activity.locator(".project-activity-history")).toContainText(
      "Task approved",
    );
    await activity.getByRole("button", { name: /^Needs review/ }).click();
    await expect(
      page.locator(`[data-message-id="${groupedMessage.id}"]`),
    ).toHaveClass(/is-grouped/);
    await expect(
      page.locator(`[data-message-id="${firstMessage.id}"]`),
    ).not.toHaveClass(/is-grouped/);
    await expect(
      page.locator(`[data-message-id="${staffMessage.id}"]`),
    ).not.toHaveClass(/is-grouped/);
    await expect(
      page.getByRole("link", { name: /Review proof/ }).first(),
    ).toHaveAttribute("href", new RegExp(`/jobs/${job}.*#work-checklist`));
    await bounds(page, 1440);
    await page.screenshot({ path: output + "/desktop-activity.png" });
    await page
      .getByRole("link", { name: /Review proof/ })
      .first()
      .click();
    await expect(page.locator("#work-checklist-selected-detail h3")).toHaveText(
      "Electrical checks",
    );
    await expect(
      page.getByRole("button", { name: "Approve task", exact: true }),
    ).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get("task"), tasks[1].id);
    await page.goBack();
    await expect(page.getByLabel("Job message", { exact: true })).toBeVisible();

    const withActivity = await page
      .locator(".inbox-message-scroll")
      .evaluate((node) => node.clientWidth);
    await page
      .getByRole("button", { name: "Close activity", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Job activity" }),
    ).toBeHidden();
    assert.ok(
      (await page
        .locator(".inbox-message-scroll")
        .evaluate((node) => node.clientWidth)) >
        withActivity + 200,
    );
    await expect(
      page.getByRole("button", { name: "Activity", exact: true }),
    ).toBeFocused();
    await page.screenshot({ path: output + "/desktop-focus.png" });
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page
      .getByRole("button", { name: "Search this conversation", exact: true })
      .click();
    await page
      .getByLabel("Search messages in this job", { exact: true })
      .fill("east access");
    await expect(page.locator(".inbox-message-body")).toHaveCount(1);
    await expect(page.locator(".inbox-message-body")).toContainText(
      "east access route",
    );
    await page
      .getByRole("button", { name: "Close message search", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Files for this conversation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Files for this job" }),
    ).toBeVisible();
    await page
      .locator(".project-files-view")
      .getByRole("button", {
        name: "Preview Electrical checks.jpg",
        exact: true,
      })
      .click();
    await expect(page.locator(".job-file-viewer img")).toBeVisible();
    await page
      .locator(".job-file-viewer")
      .getByRole("button", { name: /Close|Back/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Back to messages", exact: true })
      .click();

    const composer = page.getByLabel("Job message", { exact: true });
    await composer.fill("Crew arrival confirmed.");
    await composer.press("Shift+Enter");
    await composer.pressSequentially("Please use the east access route.");
    await page.getByRole("button", { name: "Add emoji", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Choose an emoji" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close emoji picker", exact: true })
      .click();
    await expect(composer).toHaveValue(
      "Crew arrival confirmed.\nPlease use the east access route.",
    );
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(
      page
        .locator(".project-message-text")
        .filter({ hasText: "Crew arrival confirmed." }),
    ).toHaveCount(1);

    // A lost response must not turn the new compact send control into a duplicate send.
    const sendUrl = base + `/api/jobs/${job}/messages`;
    const sendIds = [];
    await page.route(sendUrl, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sendIds.push(route.request().postDataJSON().clientId);
      const response = await route.fetch({
        headers: { ...route.request().headers(), origin: requestOrigin },
      });
      return sendIds.length === 1
        ? route.fulfill({
            status: 503,
            json: { error: "Local test interrupted the response." },
          })
        : route.fulfill({ response });
    });
    await composer.fill("Please confirm the delivery truck arrival.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".inbox-send-error")).toBeVisible();
    await expect(composer).toHaveValue(
      "Please confirm the delivery truck arrival.",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(composer).toHaveValue("");
    assert.equal(sendIds[0], sendIds[1], "Retry retains its message identity");
    const delivered = await call(
      hirer,
      `/jobs/${job}/messages?providerId=${provider.company}`,
    );
    assert.equal(
      delivered.messages.filter(
        (message) =>
          message.body === "Please confirm the delivery truck arrival.",
      ).length,
      1,
    );
    await page.unroute(sendUrl);

    // New activity does not drag the reader out of earlier messages.
    await page.locator(".inbox-message-scroll").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.getByRole("button", { name: "Load earlier messages" }).click();
    await expect(page.locator("[data-message-id]")).toHaveCount(62);
    await page.locator(".inbox-message-scroll").evaluate((node) => {
      node.scrollTop = 0;
    });
    const historyArrival = await send(
      provider,
      "Fresh arrival information while you read older messages.",
    );
    await expect(
      page.getByRole("button", { name: "New messages", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    assert.equal(await unreadMessage(historyArrival.id), true);
    assert.equal(
      await page
        .locator(".inbox-message-scroll")
        .evaluate((node) => node.scrollTop),
      0,
    );
    await page
      .getByRole("button", { name: "New messages", exact: true })
      .click();
    await expect
      .poll(() => unreadMessage(historyArrival.id), { timeout: 12000 })
      .toBe(false);

    // The same conversation stays usable at narrow and wide viewport widths.
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 700 ? 740 : 900 });
      if (
        width <= 900 &&
        (await page
          .getByRole("button", { name: "Close activity", exact: true })
          .isVisible())
      )
        await page
          .getByRole("button", { name: "Close activity", exact: true })
          .click();
      await bounds(page, width);
      if (width === 390)
        await page.screenshot({ path: output + "/mobile-chat.png" });
    }
    await page.setViewportSize({ width: 390, height: 740 });
    await page.locator(".inbox-message-scroll").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page
      .getByLabel("Job message", { exact: true })
      .fill("A draft survives reviewing task proof.");
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Job activity" }),
    ).toBeVisible();
    await page.screenshot({ path: output + "/mobile-activity.png" });
    const coveredArrival = await send(
      provider,
      "This must stay unread while the activity page covers the conversation.",
    );
    await expect
      .poll(() => unreadMessage(coveredArrival.id), { timeout: 12000 })
      .toBe(true);
    await page.waitForTimeout(1300);
    assert.equal(
      await unreadMessage(coveredArrival.id),
      true,
      "Covered messages stay unread",
    );
    await page
      .getByRole("button", { name: "Close activity", exact: true })
      .click();
    await expect(page.getByLabel("Job message", { exact: true })).toHaveValue(
      "A draft survives reviewing task proof.",
    );
    await expect
      .poll(() => unreadMessage(coveredArrival.id), { timeout: 12000 })
      .toBe(false);
    await page
      .getByRole("button", { name: "Back to conversations", exact: true })
      .click();
    await expect(page.locator(".inbox-sidebar")).toBeVisible();
    await page.getByLabel("Search conversations").fill(suffix);
    await expect(page.locator(".workspace-inbox-thread")).toHaveCount(1);
    await page.locator(".workspace-inbox-thread").click();
    await expect(page.getByLabel("Job message", { exact: true })).toHaveValue(
      "A draft survives reviewing task proof.",
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        checks:
          "activity/focus layouts, message grouping, search, files/full-screen preview, proof link, history scroll, unread visibility, responsive viewport, preserved drafts",
        screenshots: output,
      }),
    );
  }
} catch (error) {
  if (inspectedPage && !inspectedPage.isClosed()) {
    await inspectedPage.screenshot({ path: output + "/failure.png" });
    const state = await inspectedPage.evaluate(() => {
      const root = document.querySelector(".inbox-message-scroll"),
        last = root?.querySelector("[data-message-id]:last-of-type");
      return {
        focus: document.hasFocus(),
        visibility: document.visibilityState,
        viewport: [innerWidth, innerHeight],
        root: root?.getBoundingClientRect().toJSON(),
        last: last?.getBoundingClientRect().toJSON(),
        scroll: root && [root.scrollTop, root.scrollHeight, root.clientHeight],
        dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
      };
    });
    console.error(JSON.stringify({ reads, state }));
  }
  throw error;
} finally {
  await browser.close();
  await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
  await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [companies]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await db.end();
}
