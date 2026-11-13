import { useEffect } from "react";
import { api, post } from "./api";
import { isMacApp, isWindowsApp } from "./mac-app";

const RECORD = "connect.web-push";
const INSTALLATION = "connect.push-installation";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type PushBinding = {
  userId: string;
  bindingId: string;
  deviceId: string;
};
let currentUser: string | null = null;
let generation = 0;
let activeConversation = "";
let task: Promise<unknown> = Promise.resolve();
export function pushSupported() {
  return (
    !isMacApp() &&
    !isWindowsApp() &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
export function pushBinding(): PushBinding | null {
  try {
    const value = JSON.parse(localStorage.getItem(RECORD) || "null");
    return value &&
      UUID.test(value.userId) &&
      UUID.test(value.bindingId) &&
      UUID.test(value.deviceId)
      ? value
      : null;
  } catch {
    return null;
  }
}
function storeBinding(value: PushBinding | null) {
  if (value) localStorage.setItem(RECORD, JSON.stringify(value));
  else localStorage.removeItem(RECORD);
  window.dispatchEvent(new Event("connect:push-changed"));
}
async function registration() {
  const value = await navigator.serviceWorker.getRegistration("/");
  return value &&
    [value.active, value.waiting, value.installing].some(
      (worker) =>
        worker?.scriptURL === new URL("/push-sw.js", location.origin).href,
    )
    ? value
    : null;
}
async function workerOwner(
  reg: ServiceWorkerRegistration | null,
  value: PushBinding | null,
) {
  const worker = reg?.active;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(
        new Error("Connect couldn’t finish notification setup. Try again."),
      );
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      event.data?.ok
        ? resolve()
        : reject(
            new Error(
              "Browser storage is unavailable. Allow site storage to enable notifications.",
            ),
          );
    };
    worker.postMessage(
      {
        type: "connect:push-owner",
        owner: value && { userId: value.userId, bindingId: value.bindingId },
      },
      [channel.port2],
    );
  });
}
export function confirmedNotificationsRead(userId: string, ids: string[]) {
  const valid = [...new Set(ids)].filter((id) => UUID.test(id));
  if (!UUID.test(userId) || !valid.length) return;
  for (let offset = 0; offset < valid.length; offset += 500) {
    const batch = valid.slice(offset, offset + 500);
    window.dispatchEvent(
      new CustomEvent("connect:notifications-read", {
        detail: { userId, ids: batch },
      }),
    );
    const binding = pushBinding();
    if (!pushSupported() || binding?.userId !== userId) continue;
    void registration()
      .then((reg) => {
        const latest = pushBinding();
        if (latest?.bindingId !== binding.bindingId || latest.userId !== userId)
          return;
        reg?.active?.postMessage({
          type: "connect:push-read",
          userId,
          bindingId: binding.bindingId,
          ids: batch,
        });
      })
      .catch(() => {});
  }
}
async function disconnect() {
  const record = pushBinding();
  const reg = "serviceWorker" in navigator ? await registration() : null;
  await workerOwner(reg, null).catch(() => {});
  if (record)
    await api(`/notifications/devices/${record.deviceId}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  try {
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } finally {
    storeBinding(null);
  }
}
export function disconnectWebPush() {
  generation++;
  task = task.catch(() => {}).then(disconnect);
  return task;
}
function applicationKey(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export async function enableWebPush(userId: string, publicKey: string) {
  if (!pushSupported())
    throw new Error(
      "This app does not support browser notifications. Your notification inbox still works.",
    );
  const attempt = generation;
  // This runs synchronously from the Enable button, never during page loading.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Allow notifications in your browser’s site settings, then try again."
        : "Notifications weren’t enabled. You can try again whenever you’re ready.",
    );
  task = task
    .catch(() => {})
    .then(async () => {
      const valid = () => currentUser === userId && generation === attempt;
      if (!valid())
        throw new Error(
          "Your account changed. Open notification settings again.",
        );
      await disconnect();
      if (!valid()) return;
      let installationId = localStorage.getItem(INSTALLATION);
      if (!installationId || !UUID.test(installationId)) {
        installationId = crypto.randomUUID();
        localStorage.setItem(INSTALLATION, installationId);
      }
      const reg = await navigator.serviceWorker.register("/push-sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Notification setup took too long. Please try again.",
                ),
              ),
            10000,
          ),
        ),
      ]);
      if (!valid()) return;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(publicKey),
      });
      const bindingId = crypto.randomUUID();
      try {
        const result = await post<{ id: string }>("/notifications/devices", {
          platform: "web",
          installationId,
          bindingId,
          subscription: subscription.toJSON(),
        });
        if (!valid()) {
          await subscription.unsubscribe();
          await api(`/notifications/devices/${result.id}`, {
            method: "DELETE",
          }).catch(() => {});
          return;
        }
        const record = { userId, bindingId, deviceId: result.id };
        await workerOwner(reg, record);
        if (!valid()) {
          await workerOwner(reg, null).catch(() => {});
          await subscription.unsubscribe();
          await api(`/notifications/devices/${result.id}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});
          return;
        }
        storeBinding(record);
      } catch (error) {
        await subscription.unsubscribe();
        throw error;
      }
    });
  return task;
}
export function notificationDestination(
  value: string,
  companyId?: string | null,
) {
  try {
    if (/[\\\x00-\x20]/.test(value) || value.startsWith("//")) return null;
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return null;
    const id = "[a-f0-9-]{36}";
    if (
      !new RegExp(
        `^/(?:jobs/(?:inbox|${id})|messages(?:/(?:people/|company/)?${id})?|posts/${id}|company/${id}|join/[a-z0-9][a-z0-9-]{1,39}|account(?:/updates)?|requests|network(?:/connections)?)$`,
        "i",
      ).test(url.pathname)
    )
      return null;
    if (
      url.pathname === "/messages" &&
      UUID.test(url.searchParams.get("conversation") || "")
    )
      url.pathname += "/" + url.searchParams.get("conversation");
    else if (
      url.pathname === "/messages" &&
      UUID.test(url.searchParams.get("personal") || "")
    )
      url.pathname += "/people/" + url.searchParams.get("personal");
    else if (
      url.pathname === "/messages" &&
      UUID.test(url.searchParams.get("company") || "")
    )
      url.pathname += "/company/" + url.searchParams.get("company");
    const query = new URLSearchParams();
    if (url.pathname === "/jobs/inbox") {
      const job = url.searchParams.get("job"),
        provider = url.searchParams.get("provider");
      if (job && provider && UUID.test(job) && UUID.test(provider)) {
        query.set("job", job);
        query.set("provider", provider);
      }
    }
    const comment = url.searchParams.get("comment");
    if (comment && UUID.test(comment)) query.set("comment", comment);
    const company = companyId || url.searchParams.get("notificationCompany");
    // Job notifications can point directly at the review they require. Keep
    // only known section anchors; arbitrary fragments and queries stay removed.
    const jobHash =
      url.pathname.startsWith("/jobs/") &&
      UUID.test(url.pathname.slice("/jobs/".length)) &&
      [
        "#work-checklist",
        "#job-review",
        "#received-quotes",
        "#quote-form",
      ].includes(url.hash)
        ? url.hash
        : "";
    const path =
      url.pathname === "/account/updates"
        ? "/account#updates"
        : url.pathname + (query.size ? "?" + query : "") + jobHash;
    return { path, companyId: company && UUID.test(company) ? company : null };
  } catch {
    return null;
  }
}
export function useNotificationConversation(path: string | null) {
  useEffect(() => {
    if (!path) return;
    activeConversation = path;
    return () => {
      if (activeConversation === path) activeConversation = "";
    };
  }, [path]);
}
export function isVisibleNotificationConversation(url: string) {
  return (
    !document.hidden &&
    document.hasFocus() &&
    !!activeConversation &&
    notificationDestination(url)?.path === activeConversation
  );
}
export function useWebPushLifecycle(
  userId: string | null,
  companyId: string | null,
  ready: boolean,
  refresh: () => void,
  open: (url: string) => void,
) {
  useEffect(() => {
    if (!ready) return;
    currentUser = userId;
    generation++;
    if (!pushSupported()) return;
    const record = pushBinding();
    if (record && record.userId !== userId)
      void disconnectWebPush().catch(() => {});
    else if (record && Notification.permission !== "granted")
      void disconnectWebPush().catch(() => {});
    else if (record)
      void registration()
        .then(async (reg) => {
          if (currentUser !== userId) return;
          const subscription = await reg?.pushManager.getSubscription();
          const status = await api<{ active: boolean }>(
            `/notifications/devices/${record.deviceId}`,
          );
          if (
            currentUser !== userId ||
            pushBinding()?.bindingId !== record.bindingId
          )
            return;
          if (!subscription || !status.active) {
            await workerOwner(reg, null);
            await subscription?.unsubscribe();
            storeBinding(null);
          } else await workerOwner(reg, record);
        })
        .catch(() => {});
    return () => {
      generation++;
    };
  }, [userId, ready]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        (event.source as ServiceWorker | null)?.scriptURL !==
          new URL("/push-sw.js", location.origin).href
      )
        return;
      if (event.data?.type === "connect:push-inbox") refresh();
      else if (event.data?.type === "connect:push-open") {
        if (!notificationDestination(event.data.url)) return;
        open(event.data.url);
        event.ports[0]?.postMessage({ handled: true });
      } else if (event.data?.type === "connect:push-check") {
        const record = pushBinding();
        const destination = notificationDestination(event.data.url);
        const active =
          !document.hidden &&
          document.hasFocus() &&
          !!userId &&
          userId === event.data.recipientUserId &&
          record?.bindingId === event.data.bindingId &&
          (!event.data.companyId || event.data.companyId === companyId) &&
          !!activeConversation &&
          destination?.path === activeConversation;
        event.ports[0]?.postMessage({ active });
      }
    };
    navigator.serviceWorker.addEventListener("message", receive);
    return () =>
      navigator.serviceWorker.removeEventListener("message", receive);
  }, [userId, companyId, refresh, open]);
}
