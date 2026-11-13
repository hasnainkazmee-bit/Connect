/* Notifications only: no fetch handler, offline cache, or stored account credentials. */
const DATABASE = "connect-notifications";
const STORE = "settings";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function safeDestination(value, companyId) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    return null;
  const url = new URL(value, self.location.origin);
  if (url.origin !== self.location.origin) return null;
  const id = "[a-f0-9-]{36}";
  if (
    !new RegExp(
      `^/(?:jobs/(?:inbox|${id})|messages(?:/(?:people/|company/)?${id})?|posts/${id}|company/${id}|join/[a-z0-9][a-z0-9-]{1,39}|account(?:/updates)?|requests|network(?:/connections)?)$`,
      "i",
    ).test(url.pathname)
  )
    return null;
  const cleaned = new URL(url.pathname, self.location.origin);
  for (const key of [
    "conversation",
    "personal",
    "company",
    "comment",
    "notification",
    "job",
    "provider",
  ]) {
    const part = url.searchParams.get(key);
    if (part && UUID.test(part)) cleaned.searchParams.set(key, part);
  }
  if (companyId && UUID.test(companyId))
    cleaned.searchParams.set("notificationCompany", companyId);
  if (
    url.pathname.startsWith("/jobs/") &&
    UUID.test(url.pathname.slice("/jobs/".length)) &&
    [
      "#work-checklist",
      "#job-review",
      "#received-quotes",
      "#quote-form",
    ].includes(url.hash)
  )
    cleaned.hash = url.hash;
  return cleaned.href;
}
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function owner(value, expected) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        STORE,
        value === undefined ? "readonly" : "readwrite",
      );
      const store = tx.objectStore(STORE);
      const request =
        value === undefined || expected
          ? store.get("owner")
          : value === null
            ? store.delete("owner")
            : store.put(value, "owner");
      if (expected) {
        request.onsuccess = () => {
          const previous = request.result;
          if (
            previous?.userId === expected.userId &&
            previous?.bindingId === expected.bindingId
          )
            store.delete("owner");
        };
      }
      tx.oncomplete = () => resolve(request.result || null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
// Keep a bounded, binding-specific ledger so a provider-queued alert cannot
// reappear after its recipient has already read it on this installation.
async function readNotices(expected, ids, key = "confirmed-read") {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, ids ? "readwrite" : "readonly"),
        store = tx.objectStore(STORE);
      const binding = store.get("owner"),
        saved = store.get(key);
      let result = {};
      saved.onsuccess = () => {
        const current = binding.result;
        if (
          current?.userId !== expected.userId ||
          current?.bindingId !== expected.bindingId
        )
          return;
        const prior = saved.result;
        result =
          prior?.userId === expected.userId &&
          prior?.bindingId === expected.bindingId
            ? prior.ids || {}
            : {};
        if (ids) {
          const now = Date.now();
          for (const id of ids) result[id] = now;
          result = Object.fromEntries(
            Object.entries(result)
              .filter(([, at]) => now - at < 7 * 86400000)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5000),
          );
          store.put({ ...expected, ids: result }, key);
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (
    !event.source?.url ||
    new URL(event.source.url).origin !== self.location.origin
  )
    return;
  if (event.data?.type === "connect:push-read") {
    const data = event.data;
    if (
      !UUID.test(data.userId || "") ||
      !UUID.test(data.bindingId || "") ||
      !Array.isArray(data.ids) ||
      data.ids.length > 500 ||
      data.ids.some((id) => typeof id !== "string" || !UUID.test(id))
    )
      return;
    event.waitUntil(
      (async () => {
        const ids = await readNotices(
          { userId: data.userId, bindingId: data.bindingId },
          data.ids,
        );
        for (const notification of await self.registration.getNotifications())
          if (
            notification.data?.userId === data.userId &&
            notification.data?.bindingId === data.bindingId &&
            ids[notification.tag]
          )
            notification.close();
      })().catch(() => {}),
    );
    return;
  }
  if (event.data?.type !== "connect:push-owner") return;
  const value = event.data.owner;
  if (
    value !== null &&
    (!UUID.test(value?.userId || "") || !UUID.test(value?.bindingId || ""))
  )
    return;
  event.waitUntil(
    owner(value)
      .then(async () => {
        // Notifications visible from an earlier account must disappear too.
        for (const notification of await self.registration.getNotifications()) {
          if (!value || notification.data?.bindingId !== value.bindingId)
            notification.close();
        }
        event.ports[0]?.postMessage({ ok: true });
      })
      .catch(() => event.ports[0]?.postMessage({ ok: false })),
  );
});
async function activeConversation(client, payload) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.active === true);
    };
    client.postMessage(
      {
        type: "connect:push-check",
        id: payload.id,
        recipientUserId: payload.recipientUserId,
        bindingId: payload.bindingId,
        companyId: payload.companyId,
        url: payload.url,
      },
      [channel.port2],
    );
  });
}
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      const current = await owner().catch(() => null);
      if (
        !current ||
        payload?.recipientUserId !== current.userId ||
        payload?.bindingId !== current.bindingId ||
        !UUID.test(payload?.id || "")
      )
        return;
      if ((await readNotices(current).catch(() => ({})))[payload.id]) return;
      if (
        (await readNotices(current, undefined, "delivered").catch(() => ({})))[
          payload.id
        ]
      )
        return;
      const url = safeDestination(payload.url, payload.companyId);
      if (!url) return;
      const destination = new URL(url);
      destination.searchParams.set("notification", payload.id);
      let sessionVerified = false;
      try {
        const response = await fetch("/api/session", {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        if (response.ok) {
          const session = await response.json();
          if (session.user?.id !== current.userId) {
            await owner(null, current);
            return;
          }
          sessionVerified = true;
        } else if (response.status === 401) {
          await owner(null, current);
          return;
        }
      } catch {
        /* A temporary outage never reveals a message preview. */
      }
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const sameOrigin = windows.filter(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      const visible = sameOrigin.filter(
        (client) => client.visibilityState === "visible" && client.focused,
      );
      sameOrigin.forEach((client) =>
        client.postMessage({ type: "connect:push-inbox" }),
      );
      const quiet =
        /message/.test(payload.type || "") &&
        (
          await Promise.all(
            visible.map((client) => activeConversation(client, payload)),
          )
        ).some(Boolean);
      // Recheck after any page response: a sign-out may have happened meanwhile.
      const latest = await owner().catch(() => null);
      if (
        latest?.bindingId !== current.bindingId ||
        latest?.userId !== current.userId
      )
        return;
      if ((await readNotices(current).catch(() => ({})))[payload.id]) return;
      await self.registration.showNotification(
        (sessionVerified
          ? String(payload.title || "Connect")
          : "Connect"
        ).slice(0, 120),
        {
          body: String(
            sessionVerified
              ? payload.body || "You have a new notification."
              : "Open Connect to check your notifications.",
          ).slice(0, 500),
          icon: "/assets/connect-icon.png",
          badge: "/assets/connect-icon.png",
          tag: payload.id,
          // Web Push requires a visible notification even when the chat is open.
          // Quiet delivery avoids an extra sound without risking Safari revocation.
          silent: quiet,
          renotify: false,
          data: {
            url: destination.href,
            bindingId: current.bindingId,
            userId: current.userId,
          },
        },
      );
      await readNotices(current, [payload.id], "delivered").catch(() => {});
      // Logout or a confirmed read can race the platform's asynchronous display.
      const afterDisplay = await owner().catch(() => null);
      if (
        afterDisplay?.userId !== current.userId ||
        afterDisplay?.bindingId !== current.bindingId ||
        (await readNotices(current).catch(() => ({})))[payload.id]
      )
        for (const notification of await self.registration.getNotifications({
          tag: payload.id,
        }))
          if (notification.data?.bindingId === current.bindingId)
            notification.close();
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const current = await owner().catch(() => null);
      if (
        !current ||
        current.bindingId !== event.notification.data?.bindingId ||
        current.userId !== event.notification.data?.userId
      )
        return;
      const stored = new URL(
        event.notification.data?.url || "/",
        self.location.origin,
      );
      const url = safeDestination(
        stored.pathname + stored.search,
        stored.searchParams.get("notificationCompany"),
      );
      if (!url || stored.origin !== self.location.origin) return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client =
        windows.find(
          (item) =>
            new URL(item.url).origin === self.location.origin &&
            item.visibilityState === "visible",
        ) ||
        windows.find(
          (item) => new URL(item.url).origin === self.location.origin,
        );
      if (client) {
        // Let the app route through its existing unsaved-work guard.
        const handled = new Promise((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => {
            channel.port1.close();
            resolve(false);
          }, 800);
          channel.port1.onmessage = (message) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(message.data?.handled === true);
          };
          client.postMessage({ type: "connect:push-open", url }, [
            channel.port2,
          ]);
        });
        await client.focus();
        if (!(await handled)) await self.clients.openWindow(url);
      } else await self.clients.openWindow(url);
    })(),
  );
});
