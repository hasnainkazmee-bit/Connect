import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import vm from "node:vm";
import pg from "pg";
import { chromium, expect } from "@playwright/test";

const base = process.env.MARKETPLACE_TEST_URL || "http://localhost:5173";
const database = new URL(process.env.DATABASE_URL);
if (
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base) ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.includes("test")
)
  throw new Error("Inbox UI tests require an isolated local database and app.");
const password = process.env.MARKETPLACE_DEMO_PASSWORD;
if (!password) throw new Error("Provide the isolated demo account password.");
const out =
  process.env.MARKETPLACE_SCREENSHOTS || "/private/tmp/connect-inbox-qa";
await fs.mkdir(out, { recursive: true });
const db = new pg.Client({ connectionString: database.href });
await db.connect();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  args: ["--disable-quic"],
});
const jobs = [],
  errors = [];
const suffix = randomUUID().slice(0, 8);
async function context(email) {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const r = await c.request.post(base + "/api/auth/login", {
    data: { email, password },
    headers: { Origin: base },
  });
  assert.equal(r.status(), 200);
  const session = await (await c.request.get(base + "/api/session")).json();
  return { c, company: session.activeCompanyId, user: session.user.id };
}
async function api(actor, path, body) {
  const r = body
    ? await actor.c.request.post(base + "/api" + path, {
        data: body,
        headers: { Origin: base },
      })
    : await actor.c.request.get(base + "/api" + path);
  assert.ok(r.ok(), `${path}: ${r.status()} ${await r.text()}`);
  return r.json();
}
try {
  const hirer = await context("demo01@connect.example"),
    provider = await context("demo11@connect.example");
  const h = await hirer.c.newPage(),
    p = await provider.c.newPage();
  for (const page of [h, p])
    page.on("pageerror", (e) => errors.push(e.message));
  for (const title of [
    "Commercial rooftop installation",
    "Electrical inspection and commissioning",
  ])
    jobs.push(
      (
        await api(hirer, "/jobs", {
          title: `${title} ${suffix}`,
          description:
            "Install and commission the commercial rooftop array. Coordinate crew access and inspection, and share progress photographs.",
          location: "Austin, TX",
          trade: "installation",
          budgetCents: 15000000,
          startWindow: "January 15, 2027",
        })
      ).id,
    );
  const send = (actor, job, body) =>
    api(actor, `/jobs/${job}/messages`, {
      body,
      providerId: provider.company,
      clientId: randomUUID(),
    });
  await send(
    provider,
    jobs[0],
    "Hi, we reviewed the plans. Our crew is available for the January start. Is site access confirmed?",
  );
  await send(
    hirer,
    jobs[0],
    "Yes, the site coordinator will meet your crew at 8 am. Please bring the updated installation schedule.",
  );
  await send(
    provider,
    jobs[0],
    "Great. We’ll share the crew list and schedule tomorrow. We can also handle the final inspection.",
  );
  await send(
    provider,
    jobs[1],
    "We can help with inspection and commissioning. Can you share the electrical plans?",
  );
  await db.query(
    "INSERT INTO job_messages(job_id,provider_company_id,sender_company_id,author_id,body,created_at) SELECT $1,$2,$2,$3,'Earlier schedule discussion '||n,now()-interval '2 days'+n*interval '1 minute' FROM generate_series(1,55) n",
    [jobs[0], provider.company, provider.user],
  );
  const uploaded = await hirer.c.request.post(
    base + `/api/jobs/${jobs[0]}/files?name=rooftop-photo.jpg`,
    {
      data: await fs.readFile("apps/web/public/assets/solar.jpg"),
      headers: { Origin: base, "Content-Type": "image/jpeg" },
    },
  );
  assert.equal(uploaded.status(), 201);
  const inbox = (job) => `/jobs/inbox?job=${job}&provider=${provider.company}`;
  const unread = async () =>
    (await api(hirer, `/jobs/inbox?q=${suffix}`)).threads.find(
      (t) => t.job_id === jobs[0],
    ).unread_count;
  await h.goto(base + "/jobs/inbox");
  await h.bringToFront();
  await h.getByLabel("Search conversations").fill(suffix);
  await expect(h.locator(".workspace-inbox-thread")).toHaveCount(2);
  await expect(h.locator(".inbox-unread-count").first()).toBeVisible();
  await h
    .locator(".workspace-inbox-thread")
    .filter({ hasText: "Commercial rooftop" })
    .click();
  await expect(h.getByLabel("Job message", { exact: true })).toBeVisible();
  await expect.poll(unread).toBe(0);
  assert.equal(new URL(h.url()).pathname, "/jobs/inbox");
  await h.screenshot({ path: out + "/desktop-chat.png" });

  await h
    .getByLabel("Job message", { exact: true })
    .fill("A saved draft for the installation crew.");
  await h.getByRole("button", { name: "Back to conversations" }).click();
  await h
    .locator(".workspace-inbox-thread")
    .filter({ hasText: "Electrical inspection" })
    .click();
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue("");
  await h
    .getByLabel("Job message", { exact: true })
    .fill("Separate inspection draft.");
  await h.getByRole("button", { name: "Back to conversations" }).click();
  await h
    .locator(".workspace-inbox-thread")
    .filter({ hasText: "Commercial rooftop" })
    .click();
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue(
    "A saved draft for the installation crew.",
  );
  await h.reload();
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue(
    "A saved draft for the installation crew.",
  );
  await h.getByLabel("Job message", { exact: true }).fill("First line");
  await h.getByLabel("Job message", { exact: true }).press("Shift+Enter");
  await h
    .getByLabel("Job message", { exact: true })
    .pressSequentially("Second line");
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue(
    "First line\nSecond line",
  );
  await h.getByLabel("Job message", { exact: true }).press("Enter");
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue("");
  await expect(
    h.locator(".inbox-message-body").filter({ hasText: "First line" }),
  ).toHaveCount(1);

  // Simulate a lost response after the real server commits the message.
  let sends = 0;
  const sendIds = [];
  const sendUrl = base + `/api/jobs/${jobs[0]}/messages`;
  await h.route(sendUrl, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sends++;
    sendIds.push(route.request().postDataJSON().clientId);
    const response = await route.fetch();
    if (sends === 1)
      await route.fulfill({
        status: 503,
        json: { error: "The response was interrupted." },
      });
    else await route.fulfill({ response });
  });
  await h
    .getByLabel("Job message", { exact: true })
    .fill("Please confirm the crew arrival time.");
  await h.getByRole("button", { name: "Send", exact: true }).click();
  await expect(h.locator(".inbox-send-error")).toBeVisible();
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue(
    "Please confirm the crew arrival time.",
  );
  await h.getByRole("button", { name: "Send", exact: true }).click();
  await expect(h.locator(".inbox-send-error")).toHaveCount(0);
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue("");
  assert.equal(sendIds[0], sendIds[1]);
  assert.equal(
    (
      await api(
        hirer,
        `/jobs/${jobs[0]}/messages?providerId=${provider.company}`,
      )
    ).messages.filter((m) => m.body === "Please confirm the crew arrival time.")
      .length,
    1,
  );
  await h.unroute(sendUrl);

  if (
    !(await h.getByRole("complementary", { name: "Job activity" }).isVisible())
  )
    await h.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    h.getByRole("complementary", { name: "Job activity" }),
  ).toBeVisible();
  await h.screenshot({ path: out + "/desktop-job-activity.png" });
  await h
    .getByRole("button", { name: "Files for this conversation", exact: true })
    .click();
  await h
    .getByRole("button", { name: "Preview rooftop-photo.jpg", exact: true })
    .click();
  await expect(h.locator(".job-file-viewer img")).toBeVisible();
  await h.getByRole("button", { name: "Close preview", exact: true }).click();
  await h
    .getByRole("button", { name: "Back to messages", exact: true })
    .click();
  await h.getByRole("button", { name: "Close activity" }).focus();
  await h.keyboard.press("Escape");
  await expect(
    h.getByRole("button", { name: "Activity", exact: true }),
  ).toBeFocused();

  await h.locator(".inbox-message-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await h.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(h.locator("[data-message-id]")).toHaveCount(60);
  await h.locator(".inbox-message-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await send(
    provider,
    jobs[0],
    "New arrival information while you are reading earlier messages.",
  );
  await expect(
    h.getByRole("button", { name: "New messages", exact: true }),
  ).toBeVisible({ timeout: 12000 });
  assert.equal(await unread(), 1, "Offscreen new messages remain unread");
  assert.equal(
    await h.locator(".inbox-message-scroll").evaluate((el) => el.scrollTop),
    0,
    "Incoming messages do not pull the reader away from history",
  );
  await h.getByRole("button", { name: "New messages", exact: true }).click();
  await expect.poll(unread).toBe(0);

  await p.goto(base + inbox(jobs[0]));
  await p.bringToFront();
  await expect(p.getByLabel("Job message", { exact: true })).toBeVisible();
  await send(
    provider,
    jobs[0],
    "This should remain unread while another tab has focus.",
  );
  await expect.poll(unread).toBe(1);
  await h.bringToFront();
  await expect.poll(unread, { timeout: 12000 }).toBe(0);

  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await h.setViewportSize({ width, height: width < 700 ? 740 : 900 });
    await h.waitForTimeout(100);
    const bounds = await h.evaluate(() => {
      const layout = document
          .querySelector(".inbox-layout")
          .getBoundingClientRect(),
        composer = document
          .querySelector(".inbox-composer")
          .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
        layoutBottom: layout.bottom,
        composerBottom: composer.bottom,
        height: innerHeight,
      };
    });
    assert.equal(bounds.overflow, false, `Horizontal overflow at ${width}`);
    assert.equal(
      bounds.pageScroll,
      false,
      `Page scrolling at ${width}: ${JSON.stringify(bounds)}`,
    );
    assert.ok(
      bounds.composerBottom <= bounds.height,
      `Composer visible at ${width}`,
    );
    await h.getByRole("button", { name: "Activity", exact: true }).click();
    assert.equal(
      await h.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    if (width === 390)
      await h.screenshot({ path: out + "/mobile-job-activity.png" });
    await h.getByRole("button", { name: "Close activity" }).click();
    if (width === 390) await h.screenshot({ path: out + "/mobile-chat.png" });
  }
  await h.setViewportSize({ width: 390, height: 740 });
  await h.getByRole("button", { name: "Back to conversations" }).click();
  await expect(h.locator(".inbox-sidebar")).toBeVisible();
  await h.getByLabel("Search conversations").fill(suffix);
  await expect(h.locator(".workspace-inbox-thread")).toHaveCount(2);
  await h.screenshot({ path: out + "/mobile-conversations.png" });
  await h
    .locator(".workspace-inbox-thread")
    .filter({ hasText: "Electrical inspection" })
    .click();
  await expect(h.getByLabel("Job message", { exact: true })).toHaveValue(
    "Separate inspection draft.",
  );
  await h.goBack();
  await expect(h.locator(".inbox-sidebar")).toBeVisible();

  // Notification routing preserves exactly the validated job/thread context.
  const destination = await h.evaluate(
    async ({ job, provider, company }) => {
      const { notificationDestination } = await import("/src/web-push.ts");
      return [
        notificationDestination(
          `/jobs/inbox?job=${job}&provider=${provider}&unsafe=drop`,
          company,
        ),
        notificationDestination(
          `https://other.example/jobs/inbox?job=${job}&provider=${provider}`,
        ),
        notificationDestination(`/jobs/inbox?job=bad&provider=${provider}`),
      ];
    },
    { job: jobs[0], provider: provider.company, company: hirer.company },
  );
  assert.equal(destination[0].path, inbox(jobs[0]));
  assert.equal(destination[0].companyId, hirer.company);
  assert.equal(destination[1], null);
  assert.equal(destination[2].path, "/jobs/inbox");
  const sw = vm.createContext({
    URL,
    self: { location: { origin: base }, addEventListener() {} },
  });
  vm.runInContext(await fs.readFile("apps/web/public/push-sw.js", "utf8"), sw);
  const swUrl = new URL(
    vm.runInContext(
      `safeDestination(${JSON.stringify(inbox(jobs[0]))},${JSON.stringify(hirer.company)})`,
      sw,
    ),
  );
  assert.equal(swUrl.searchParams.get("job"), jobs[0]);
  assert.equal(swUrl.searchParams.get("provider"), provider.company);
  assert.equal(swUrl.searchParams.get("notificationCompany"), hirer.company);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      flow: "in-place replies, per-chat drafts across navigation and reload, multiline entry, lost-response retry, photo preview, Escape focus, unread-on-visibility, history scroll, mobile back and notification links",
      responsiveWidths: [320, 390, 768, 1024, 1440, 1920],
      screenshots: out,
    }),
  );
} finally {
  await browser.close();
  await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
  await db.end();
}
