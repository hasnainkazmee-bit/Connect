import { test, expect, type Page } from "@playwright/test";
import vm from "node:vm";
import fs from "node:fs/promises";

const userId = "11111111-1111-4111-8111-111111111111";
const bindingId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const notificationId = "44444444-4444-4444-8444-444444444444";
const companyId = "55555555-5555-4555-8555-555555555555";
async function fixture(
  page: Page,
  permission: "default" | "denied" = "default",
) {
  const state = {
    user: {
      id: userId,
      name: "Individual Reader",
      email: "reader@example.test",
      account_type: "individual",
      email_verified_at: "2026-01-01",
      onboarding_completed_at: "2026-01-01",
    },
    companies: [],
    activeCompanyId: null,
  };
  let session: any = state;
  const prefs = {
    messages: true,
    social: true,
    requests: true,
    team: true,
    updates: true,
    previews: false,
  };
  const sent: any[] = [],
    reads: any[] = [],
    deleted: string[] = [];
  let notificationUrl = "/account/updates";
  let unread = 1;
  await page.addInitScript(
    ({ permission }) => {
      const w = window as any;
      let allowed = permission,
        subscription: any = null,
        registered = false;
      w.pushRequests = 0;
      w.pushUnsubscribed = 0;
      w.pushOwner = null;
      class Permission {
        static get permission() {
          return allowed;
        }
        static async requestPermission() {
          w.pushRequests++;
          allowed = "granted";
          return allowed;
        }
      }
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: Permission,
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: class {},
      });
      const worker = {
        scriptURL: location.origin + "/push-sw.js",
        postMessage(message: any, ports: MessagePort[]) {
          if (message.type === "connect:push-read") {
            (w.pushRead ||= []).push(message);
            return;
          }
          w.pushOwner = message.owner;
          ports?.[0]?.postMessage({ ok: true });
        },
      };
      const reg = {
        active: worker,
        pushManager: {
          async getSubscription() {
            return subscription;
          },
          async subscribe() {
            subscription = {
              toJSON: () => ({
                endpoint: "https://fcm.googleapis.com/fcm/send/test-browser",
                keys: { auth: "test-auth", p256dh: "test-public-key" },
              }),
              async unsubscribe() {
                w.pushUnsubscribed++;
                subscription = null;
                return true;
              },
            };
            return subscription;
          },
        },
      };
      const events = new EventTarget();
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          get ready() {
            return Promise.resolve(reg);
          },
          async getRegistration() {
            return registered ? reg : undefined;
          },
          async register() {
            registered = true;
            return reg;
          },
          addEventListener: events.addEventListener.bind(events),
          removeEventListener: events.removeEventListener.bind(events),
        },
      });
    },
    { permission },
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    let json: any = {};
    if (path === "/api/session") json = session;
    else if (path === "/api/auth/logout") {
      session = { user: null, companies: [], activeCompanyId: null };
      json = { ok: true };
    } else if (path === "/api/auth/sessions") json = { sessions: [] };
    else if (path === "/api/auth/sunhub/config") json = { enabled: false };
    else if (path === "/api/notifications/config")
      json = {
        webPush: {
          enabled: true,
          publicKey:
            "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        fcm: { enabled: false },
      };
    else if (path === "/api/notifications/preferences") {
      if (method === "PATCH")
        Object.assign(prefs, route.request().postDataJSON());
      json = prefs;
    } else if (path === "/api/notifications/devices" && method === "POST") {
      sent.push(route.request().postDataJSON());
      json = { id: deviceId };
    } else if (path.startsWith("/api/notifications/devices/")) {
      if (method === "DELETE") deleted.push(path);
      json = method === "GET" ? { active: true } : { ok: true };
    } else if (path.endsWith("/events")) return route.abort();
    else if (path === "/api/notifications/read") {
      reads.push(route.request().postDataJSON());
      unread = 0;
      json = { ok: true };
    } else if (path === "/api/notifications")
      json = {
        notifications: [
          {
            id: notificationId,
            sequence: "1",
            type: "personal_message",
            category: "messages",
            title: "A new message",
            text: "Your solar company replied.",
            url: notificationUrl,
            company_id: null,
            actor_company_id: companyId,
            created_at: new Date().toISOString(),
            read_at: unread ? null : new Date().toISOString(),
          },
        ],
        unread,
        nextCursor: null,
      };
    else if (path === "/api/network")
      json = {
        incoming: [],
        sent: [],
        connections: [],
        blocked: [],
        notifications: [],
      };
    else if (path === "/api/companies")
      json = {
        companies: [],
        total: 0,
        page: 1,
        facets: { types: [], services: [], states: [] },
      };
    else if (path === "/api/social/suggestions" || path === "/api/publications")
      json = [];
    else if (path === "/api/feed") json = { posts: [], nextCursor: null };
    else if (path === "/api/personal-inbox")
      json = { threads: [], unread: 0, requests: 0 };
    else if (path.startsWith("/api/companies/"))
      json = {
        id: companyId,
        name: "Solar Company",
        services: [],
        locations: [],
      };
    else if (path === "/api/health")
      json = { status: "ok", release: "development" };
    await route.fulfill({ json });
  });
  return {
    prefs,
    sent,
    reads,
    deleted,
    restoreUser: () => {
      session = state;
    },
    changeUser: () => {
      session = {
        ...state,
        user: { ...state.user, id: deviceId, name: "Other Reader" },
      };
    },
    setNotificationUrl: (url: string) => {
      notificationUrl = url;
    },
  };
}
for (const width of [390, 1440]) {
  test(`individual inbox and explicit browser opt-in at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const data = await fixture(page);
    await page.goto("/account#notifications");
    await expect(
      page.getByRole("button", { name: "Enable notifications", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => (window as any).pushRequests)).toBe(0);
    await expect(
      page.getByRole("switch", { name: /Show message previews/ }),
    ).not.toBeChecked();
    await page.getByRole("switch", { name: /Company activity/ }).uncheck();
    await expect.poll(() => data.prefs.social).toBe(false);
    await page
      .getByRole("button", { name: "Enable notifications", exact: true })
      .click();
    await expect(
      page.getByText("Notifications are on", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => (window as any).pushRequests)).toBe(1);
    expect(data.sent).toHaveLength(1);
    expect(data.sent[0].platform).toBe("web");
    expect(data.sent[0].installationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(data.sent[0].bindingId).toMatch(/^[a-f0-9-]{36}$/);
    expect(await page.evaluate(() => (window as any).pushOwner.userId)).toBe(
      userId,
    );
    await page.getByLabel("Notifications", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: /A new message/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mark all read", exact: true })
      .click();
    await expect.poll(() => data.reads.length).toBe(1);
    await page.getByRole("link", { name: /A new message/ }).click();
    await expect(page).toHaveURL(/\/account#updates$/);
    await expect(
      page.getByRole("heading", { name: "App updates", exact: true }),
    ).toBeVisible();
    await page.goto("/account#notifications");
    // Hash navigation stays in this document and must not repeat the prompt.
    await expect
      .poll(() => page.evaluate(() => (window as any).pushRequests))
      .toBe(1);
    await page.screenshot({
      path: `test-results/notification-settings-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("denied permission is explained without re-prompting", async ({
  page,
}) => {
  await fixture(page, "denied");
  await page.goto("/account#notifications");
  await expect(page.getByText(/Blocked by your browser/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable notifications", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pushRequests)).toBe(0);
  await expect(page.getByRole("switch", { name: /Messages/ })).toBeEnabled();
});
test("turning off clears worker binding and browser subscription", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/account#notifications");
  await page
    .getByRole("button", { name: "Enable notifications", exact: true })
    .click();
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable notifications", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).pushOwner)).toBeNull();
  expect(await page.evaluate(() => (window as any).pushUnsubscribed)).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("connect.web-push")),
  ).toBeNull();
});
test("signing out removes the subscription before leaving the account", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/account#notifications");
  await page
    .getByRole("button", { name: "Enable notifications", exact: true })
    .click();
  await expect(
    page.getByText("Notifications are on", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Account and company menu").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => data.deleted.length).toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).pushOwner))
    .toBeNull();
  expect(await page.evaluate(() => (window as any).pushUnsubscribed)).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("connect.web-push")),
  ).toBeNull();
});
test("an account changed in another tab clears the old binding without prompting", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/account#notifications");
  await page
    .getByRole("button", { name: "Enable notifications", exact: true })
    .click();
  await expect(
    page.getByText("Notifications are on", { exact: true }),
  ).toBeVisible();
  data.changeUser();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).pushOwner))
    .toBeNull();
  expect(await page.evaluate(() => (window as any).pushUnsubscribed)).toBe(1);
  expect(await page.evaluate(() => (window as any).pushRequests)).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("connect.web-push")),
  ).toBeNull();
});
test("a company message notification opens the canonical route and marks only that alert read", async ({
  page,
}) => {
  const data = await fixture(page);
  data.setNotificationUrl(
    `/messages?company=${companyId}&notification=${notificationId}&token=ignored`,
  );
  await page.goto("/account");
  await page.getByLabel("Notifications", { exact: true }).click();
  await page.getByRole("link", { name: /A new message/ }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/company/${companyId}$`));
  await expect.poll(() => data.reads.length).toBeGreaterThan(0);
  expect(
    data.reads.every((request) => request.ids?.[0] === notificationId),
  ).toBe(true);
});
test("a failed preference save restores the switch and keeps an actionable error", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/notifications/preferences", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 503,
      json: { error: "Please try again shortly." },
    });
  });
  await page.goto("/account#notifications");
  const toggle = page.getByRole("switch", { name: /Company activity/ });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Please try again shortly." }),
  ).toBeVisible();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
});

async function workerFixture() {
  const handlers = new Map<string, (event: any) => void>(),
    shown: any[] = [],
    opened: string[] = [];
  let stored: any = { userId, bindingId },
    windows: any[] = [],
    session: any = { user: { id: userId } };
  const sandbox: any = {
    URL,
    MessageChannel,
    setTimeout,
    clearTimeout,
    AbortSignal,
    fetch: async () => {
      if (session instanceof Error) throw session;
      return { ok: true, json: async () => session };
    },
    self: {
      location: { origin: "https://connect.test" },
      addEventListener: (name: string, handler: any) =>
        handlers.set(name, handler),
      registration: {
        showNotification: async (title: string, options: any) =>
          shown.push({ title, ...options }),
        getNotifications: async (filter?: any) =>
          shown
            .filter(
              (item) =>
                !item.closed && (!filter?.tag || item.tag === filter.tag),
            )
            .map((item) => ({
              ...item,
              close: () => {
                item.closed = true;
              },
            })),
      },
      clients: {
        matchAll: async () => windows,
        openWindow: async (url: string) => opened.push(url),
      },
    },
  };
  vm.runInNewContext(
    await fs.readFile("apps/web/public/push-sw.js", "utf8"),
    sandbox,
  );
  sandbox.owner = async (value?: any, expected?: any) => {
    if (
      value !== undefined &&
      (!expected ||
        (stored?.userId === expected.userId &&
          stored?.bindingId === expected.bindingId))
    )
      stored = value;
    return stored;
  };
  const ledgers = new Map<string, Record<string, number>>();
  sandbox.readNotices = async (
    expected: any,
    ids?: string[],
    key = "confirmed-read",
  ) => {
    if (
      stored?.userId !== expected.userId ||
      stored?.bindingId !== expected.bindingId
    )
      return {};
    const ledgerKey = key + ":" + expected.bindingId;
    const values = ledgers.get(ledgerKey) || {};
    ids?.forEach((id) => (values[id] = Date.now()));
    ledgers.set(ledgerKey, values);
    return values;
  };
  const fire = async (name: string, event: any) => {
    let work: Promise<any> = Promise.resolve();
    handlers.get(name)!({
      ...event,
      waitUntil: (value: Promise<any>) => {
        work = value;
      },
    });
    await work;
  };
  const payload = {
    id: notificationId,
    type: "personal_message",
    recipientUserId: userId,
    bindingId,
    title: "Private sender",
    body: "Private message",
    url: "/messages?company=" + companyId,
    companyId,
  };
  return {
    sandbox,
    handlers,
    shown,
    opened,
    payload,
    fire,
    session: (value: any) => {
      session = value;
    },
    windows: (value: any[]) => {
      windows = value;
    },
  };
}
test("worker gates queued alerts by account, binding and current session; never caches pages", async () => {
  const f = await workerFixture();
  expect(f.handlers.has("fetch")).toBe(false);
  await f.fire("push", {
    data: { json: () => ({ ...f.payload, bindingId: deviceId }) },
  });
  await f.fire("push", {
    data: { json: () => ({ ...f.payload, recipientUserId: deviceId }) },
  });
  await f.fire("push", {
    data: { json: () => ({ ...f.payload, url: "https://evil.example/" }) },
  });
  expect(f.shown).toHaveLength(0);
  await f.fire("push", { data: { json: () => f.payload } });
  expect(f.shown).toHaveLength(1);
  expect(f.shown[0].tag).toBe(notificationId);
  expect(f.shown[0].data.url).toContain("company=" + companyId);
  expect(f.shown[0].data.url).toContain("notification=" + notificationId);
  f.session(new Error("offline"));
  await f.fire("push", {
    data: { json: () => ({ ...f.payload, id: deviceId }) },
  });
  expect(f.shown[1].title).toBe("Connect");
  expect(f.shown[1].body).not.toContain("Private");
  f.session({ user: null });
  await f.fire("push", {
    data: { json: () => ({ ...f.payload, id: companyId }) },
  });
  expect(f.shown).toHaveLength(2);
});
test("worker quietly displays a confirmed visible conversation and safely opens a clicked notification", async () => {
  const f = await workerFixture();
  f.windows([
    {
      url: "https://connect.test/messages",
      visibilityState: "visible",
      focused: true,
      postMessage: (message: any, ports: MessagePort[]) => {
        if (message.type === "connect:push-check")
          ports[0].postMessage({ active: true });
      },
    },
  ]);
  await f.fire("push", { data: { json: () => f.payload } });
  expect(f.shown).toHaveLength(1);
  expect(f.shown[0].silent).toBe(true);
  expect(f.shown[0].renotify).toBe(false);
  f.windows([]);
  await f.fire("push", {
    data: { json: () => ({ ...f.payload, id: deviceId }) },
  });
  expect(f.shown[1].silent).toBe(false);
  await f.fire("notificationclick", {
    notification: { data: f.shown[0].data, close() {} },
  });
  expect(f.opened).toHaveLength(1);
  expect(new URL(f.opened[0]).origin).toBe("https://connect.test");
  expect(
    f.sandbox.safeDestination("//evil.example/messages", companyId),
  ).toBeNull();
  expect(f.sandbox.safeDestination("/api/auth/logout", companyId)).toBeNull();
  expect(
    f.sandbox.safeDestination("/messages?token=secret", companyId),
  ).not.toContain("token");
  await f.sandbox.owner(null);
  await f.fire("notificationclick", {
    notification: { data: f.shown[0].data, close() {} },
  });
  expect(f.opened).toHaveLength(1);
});
test("a delayed old-session result cannot clear the next account's worker owner", async () => {
  const f = await workerFixture();
  let finish: ((value: any) => void) | undefined;
  f.sandbox.fetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const receiving = f.fire("push", { data: { json: () => f.payload } });
  await expect.poll(() => !!finish).toBe(true);
  const next = { userId: deviceId, bindingId: notificationId };
  await f.sandbox.owner(next);
  finish!({ ok: true, json: async () => ({ user: null }) });
  await receiving;
  expect(await f.sandbox.owner()).toEqual(next);
  expect(f.shown).toHaveLength(0);
});

test("inbox reads only rows viewed with focus for one second", async ({
  page,
}) => {
  const data = await fixture(page);
  const ids = Array.from(
    { length: 15 },
    (_, i) => `90000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: {
        notifications: ids.map((id, i) => ({
          id,
          sequence: String(15 - i),
          type: "personal_message",
          category: "messages",
          title: `Message ${i + 1}`,
          text: "A company has replied with a project update.",
          url: "/account/updates",
          company_id: null,
          actor_company_id: companyId,
          created_at: new Date().toISOString(),
          read_at: data.reads.some((r) => r.ids?.includes(id))
            ? new Date().toISOString()
            : null,
        })),
        unread: 15,
        nextCursor: null,
      },
    }),
  );
  await page.goto("/account");
  await page.waitForTimeout(1200);
  expect(data.reads).toHaveLength(0);
  await page.getByLabel("Notifications", { exact: true }).click();
  await expect
    .poll(() => data.reads.flatMap((r) => r.ids || []).length)
    .toBeGreaterThan(0);
  const read = new Set(data.reads.flatMap((r) => r.ids || []));
  expect(read.has(ids[0])).toBe(true);
  expect(read.has(ids[14])).toBe(false);
  expect(read.size).toBeLessThan(ids.length);
});
for (const host of ["mac", "windows"] as const) {
  test(`${host} native opt-in, new-alert privacy and safe tap use the shared bridge`, async ({
    page,
  }) => {
    const data = await fixture(page);
    await page.addInitScript(
      ({ host }) => {
        const w = window as any;
        Object.defineProperty(navigator, "userAgent", {
          value: `Connect${host === "mac" ? "Mac" : "Windows"}/0.1.1`,
        });
        w.__CONNECT_DESKTOP_NOTIFICATIONS__ = true;
        w.nativeOwner = null;
        w.nativeEnabled = false;
        w.nativeShown = [];
        w.nativeRead = [];
        w.nativePermissionGestures = [];
        const status = (requestId?: string) =>
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent(`connect:${host}-notifications`, {
                detail: {
                  type: "status",
                  requestId,
                  enabled: w.nativeEnabled,
                  permission: w.nativeEnabled ? "granted" : "default",
                },
              }),
            ),
          );
        const receive = (message: any) => {
          if (message.type === "notificationOwner") {
            if (w.nativeOwner !== message.userId) w.nativeEnabled = false;
            w.nativeOwner = message.userId;
            status();
          } else if (message.type === "notificationStatus")
            status(message.requestId);
          else if (message.type === "notificationPermission") {
            w.nativePermissionGestures.push(navigator.userActivation.isActive);
            w.nativeEnabled = true;
            status(message.requestId);
          } else if (message.type === "notificationDisable") {
            w.nativeEnabled = false;
            status(message.requestId);
          } else if (message.type === "notificationRead")
            w.nativeRead.push(message);
          else if (message.type === "notificationShow")
            w.nativeShown.push(message);
        };
        if (host === "mac") {
          w.webkit = {
            messageHandlers: { connectMac: { postMessage: receive } },
          };
        } else {
          w.chrome ||= {};
          w.chrome.webview = { postMessage: receive };
        }
        window.addEventListener(
          "connect:native-notification-permission",
          (e: any) =>
            receive({
              type: "notificationPermission",
              requestId: e.detail.requestId,
            }),
        );
      },
      { host },
    );
    await page.route("**/api/mobile/releases/desktop", (route) =>
      route.fulfill({
        json: {
          macos: { versionName: "0.1.1", downloads: [] },
          windows: { versionName: "0.1.1", downloads: [] },
        },
      }),
    );
    await page.goto("/account#notifications");
    await expect(
      page.getByText("Notifications on this computer", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => (window as any).nativeShown)).toHaveLength(
      0,
    );
    await page
      .getByRole("button", { name: "Enable notifications", exact: true })
      .click();
    await expect(
      page.getByText("Notifications are on", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).nativePermissionGestures),
    ).toEqual([true]);
    expect(await page.evaluate(() => (window as any).pushRequests)).toBe(0);
    const id = "66666666-6666-4666-8666-666666666666";
    await page.route("**/api/notifications", (route) =>
      route.fulfill({
        json: {
          notifications: [
            {
              id,
              sequence: "2",
              type: "personal_message",
              category: "messages",
              title: "Private customer",
              text: "Private project details",
              url: "/account/updates",
              company_id: null,
              actor_company_id: companyId,
              created_at: new Date().toISOString(),
              read_at: null,
            },
          ],
          unread: 1,
          nextCursor: "1",
        },
      }),
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).nativeShown.length))
      .toBe(1);
    const alert = await page.evaluate(() => (window as any).nativeShown[0]);
    expect(alert.title).toBe("Connect");
    expect(alert.body).not.toContain("Private");
    await page.route("**/api/notifications?before=1", (route) =>
      route.fulfill({
        json: {
          notifications: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              sequence: "0",
              type: "personal_message",
              category: "messages",
              title: "Older unread message",
              text: "History",
              url: "/account/updates",
              company_id: null,
              actor_company_id: companyId,
              created_at: "2026-01-01",
              read_at: null,
            },
          ],
          unread: 2,
          nextCursor: null,
        },
      }),
    );
    await page.evaluate(
      (host) =>
        window.dispatchEvent(
          new CustomEvent(`connect:${host}-command`, {
            detail: { type: "notifications" },
          }),
        ),
      host,
    );
    await page
      .getByRole("button", { name: "Earlier notifications", exact: true })
      .click();
    await expect(
      page.getByText("Older unread message", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => (window as any).nativeShown.length)).toBe(
      1,
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.evaluate(
      ({ host, id, userId }) =>
        window.dispatchEvent(
          new CustomEvent(`connect:${host}-notifications`, {
            detail: { type: "open", id, userId, url: "https://evil.example/" },
          }),
        ),
      { host, id, userId },
    );
    await expect(page).toHaveURL(/\/account#notifications$/);
    await page.evaluate(
      ({ host, id, userId }) =>
        window.dispatchEvent(
          new CustomEvent(`connect:${host}-notifications`, {
            detail: {
              type: "open",
              id,
              userId,
              url: "/account/updates",
              companyId: null,
            },
          }),
        ),
      { host, id, userId },
    );
    await expect(page).toHaveURL(/\/account#updates$/);
    await expect
      .poll(() => data.reads.some((r) => r.ids?.includes(id)))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            (window as any).nativeRead.some((m: any) => m.ids.includes(id)),
          id,
        ),
      )
      .toBe(true);
    const download =
      "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.4/Connect-0.1.2-Setup.exe";
    await page.route("**/api/mobile/releases/desktop", (route) =>
      route.fulfill({
        json: {
          [host === "mac" ? "macos" : "windows"]: {
            versionName: "0.1.2",
            downloads: [
              {
                arch: host === "mac" ? "universal" : "x64",
                url: download,
                sha256: "a".repeat(64),
              },
              {
                arch: "arm64",
                url: "https://evil.example/installer.exe",
                sha256: "b".repeat(64),
              },
            ],
          },
        },
      }),
    );
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(page.getByRole("link", { name: /Download for/ })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("link", { name: /Download for/ }),
    ).toHaveAttribute("href", download);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).nativeShown.filter(
              (m: any) => m.title === "Connect update available",
            ).length,
        ),
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          (window as any).nativeShown.filter(
            (m: any) => m.title === "Connect update available",
          ).length,
      ),
    ).toBe(1);
    data.changeUser();
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).nativeOwner))
      .toBe(deviceId);
    expect(await page.evaluate(() => (window as any).nativeEnabled)).toBe(
      false,
    );
  });
}

test("worker withdraws confirmed reads and rejects late or previously dismissed duplicates", async () => {
  const worker = await workerFixture();
  await worker.fire("push", { data: { json: () => worker.payload } });
  expect(worker.shown).toHaveLength(1);
  await worker.fire("message", {
    source: { url: "https://connect.test/account" },
    data: {
      type: "connect:push-read",
      userId,
      bindingId,
      ids: [notificationId],
    },
  });
  expect(worker.shown[0].closed).toBe(true);
  await worker.fire("push", { data: { json: () => worker.payload } });
  expect(worker.shown).toHaveLength(1);
  const next = {
    ...worker.payload,
    id: "77777777-7777-4777-8777-777777777777",
  };
  await worker.fire("push", { data: { json: () => next } });
  worker.shown[1].closed = true;
  await worker.fire("push", { data: { json: () => next } });
  expect(worker.shown).toHaveLength(2);
  const queued = {
    ...worker.payload,
    id: "88888888-8888-4888-8888-888888888888",
  };
  await worker.fire("message", {
    source: { url: "https://connect.test/account" },
    data: { type: "connect:push-read", userId, bindingId, ids: [queued.id] },
  });
  await worker.fire("push", { data: { json: () => queued } });
  expect(worker.shown).toHaveLength(2);
});

test("worker withdraws a platform display that finishes after logout", async () => {
  const f = await workerFixture();
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => (started = resolve));
  const pending = new Promise<void>((resolve) => (finish = resolve));
  const show = f.sandbox.self.registration.showNotification;
  f.sandbox.self.registration.showNotification = async (...args: any[]) => {
    started();
    await pending;
    return show(...args);
  };
  const delivery = f.fire("push", { data: { json: () => f.payload } });
  await entered;
  await f.fire("message", {
    source: { url: "https://connect.test/account" },
    data: { type: "connect:push-owner", owner: null },
    ports: [],
  });
  finish();
  await delivery;
  expect(f.shown).toHaveLength(1);
  expect(f.shown[0].closed).toBe(true);
});

test("a permission prompt cannot opt back in after signing out and back into the same account", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/account#notifications");
  await page.evaluate(() => {
    (Notification as any).requestPermission = () =>
      new Promise((resolve) => ((window as any).finishPermission = resolve));
  });
  await page
    .getByRole("button", { name: "Enable notifications", exact: true })
    .click();
  data.changeUser();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("main").getByText("Other Reader", { exact: true }),
  ).toBeVisible();
  data.restoreUser();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("main").getByText("Individual Reader", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).finishPermission("granted"));
  await expect(page.getByRole("alert")).toContainText("Your account changed");
  expect(data.sent).toHaveLength(0);
  expect(
    await page.evaluate(() => localStorage.getItem("connect.web-push")),
  ).toBeNull();
});
