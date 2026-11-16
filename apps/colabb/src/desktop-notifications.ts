import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { isMacApp, isWindowsApp } from "./mac-app";
import {
  notificationDestination,
  isVisibleNotificationConversation,
} from "./web-push";
import type { InboxNotification } from "./notifications";
import { useDesktopUpdate } from "./desktop-updates";

type Permission = "default" | "granted" | "denied" | "unsupported";
export type DesktopNotificationStatus = {
  enabled: boolean;
  permission: Permission;
  error?: string;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const changed = "connect:desktop-notification-status";
let status: DesktopNotificationStatus = {
  enabled: false,
  permission: "default",
};
const pending = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void; timer: number }
>();
function host() {
  return isMacApp() ? "mac" : isWindowsApp() ? "windows" : null;
}
export function desktopNotificationsSupported() {
  return !!host() && (window as any).__CONNECT_DESKTOP_NOTIFICATIONS__ === true;
}
function send(message: unknown) {
  if (!desktopNotificationsSupported()) return;
  if (isMacApp())
    (window as any).webkit.messageHandlers.connectMac.postMessage(message);
  else (window as any).chrome.webview.postMessage(message);
}
export function useDesktopNotificationStatus() {
  const [value, setValue] = useState(status);
  useEffect(() => {
    const update = () => setValue({ ...status });
    window.addEventListener(changed, update);
    return () => window.removeEventListener(changed, update);
  }, []);
  return value;
}
export function setDesktopNotifications(enabled: boolean) {
  if (!desktopNotificationsSupported())
    return Promise.reject(
      new Error(
        "Update the Connect desktop app to enable device notifications.",
      ),
    );
  const requestId = crypto.randomUUID();
  const result = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(
        new Error("Check the system notification prompt, then try again."),
      );
    }, 60000);
    pending.set(requestId, { resolve, reject, timer });
  });
  // Native hosts forward only a trusted, recent gesture captured in an isolated world.
  if (enabled)
    window.dispatchEvent(
      new CustomEvent("connect:native-notification-permission", {
        detail: { requestId },
      }),
    );
  else
    send({
      type: enabled ? "notificationPermission" : "notificationDisable",
      requestId,
    });
  return result;
}
type Preferences = Record<
  "messages" | "social" | "requests" | "team" | "updates" | "previews",
  boolean
>;
export function useDesktopNotifications(
  ready: boolean,
  userId: string | null,
  companyId: string | null,
  items: InboxNotification[],
  loadedUser: string | null,
  open: (url: string, companyId?: string | null) => void,
) {
  const current = useRef({ userId, open });
  current.current = { userId, open };
  const baseline = useRef<{
    owner: string | null;
    seen: Set<string>;
    initialized: boolean;
    sequence: bigint;
  }>({ owner: null, seen: new Set(), initialized: false, sequence: 0n });
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const native = useDesktopNotificationStatus();
  const update = useDesktopUpdate();
  useEffect(() => {
    if (!desktopNotificationsSupported()) return;
    const eventName = `connect:${host()}-notifications`;
    const receive = (event: Event) => {
      const message = (event as CustomEvent).detail;
      if (!message || typeof message !== "object") return;
      if (
        message.type === "status" &&
        typeof message.enabled === "boolean" &&
        ["default", "granted", "denied", "unsupported"].includes(
          message.permission,
        )
      ) {
        status = {
          enabled: message.enabled,
          permission: message.permission,
          error:
            typeof message.error === "string"
              ? message.error.slice(0, 240)
              : undefined,
        };
        window.dispatchEvent(new Event(changed));
        const task = pending.get(message.requestId);
        if (task) {
          clearTimeout(task.timer);
          pending.delete(message.requestId);
          status.error ? task.reject(new Error(status.error)) : task.resolve();
        }
      } else if (
        message.type === "open" &&
        UUID.test(message.id || "") &&
        message.userId === current.current.userId &&
        typeof message.url === "string" &&
        notificationDestination(message.url, message.companyId)
      ) {
        const url = new URL(message.url, location.origin);
        url.searchParams.set("notification", message.id);
        current.current.open(url.pathname + url.search, message.companyId);
      }
    };
    window.addEventListener(eventName, receive);
    const read = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data?.userId === current.current.userId && Array.isArray(data.ids))
        send({
          type: "notificationRead",
          userId: data.userId,
          ids: data.ids
            .filter((id: unknown) => typeof id === "string" && UUID.test(id))
            .slice(0, 500),
        });
    };
    window.addEventListener("connect:notifications-read", read);
    const rebind = (event: Event) => {
      if ((event as CustomEvent).detail?.type === "state") {
        send({ type: "notificationOwner", userId: current.current.userId });
      }
    };
    window.addEventListener(`connect:${host()}-command`, rebind);
    const query = () =>
      send({ type: "notificationStatus", requestId: crypto.randomUUID() });
    window.addEventListener("focus", query);
    return () => {
      window.removeEventListener(eventName, receive);
      window.removeEventListener("connect:notifications-read", read);
      window.removeEventListener(`connect:${host()}-command`, rebind);
      window.removeEventListener("focus", query);
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(
          new Error("Your account changed. Open notification settings again."),
        );
      }
      pending.clear();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    baseline.current = {
      owner: userId,
      seen: new Set(),
      initialized: false,
      sequence: 0n,
    };
    status = { enabled: false, permission: "default" };
    window.dispatchEvent(new Event(changed));
    setPreferences(null);
    if (!desktopNotificationsSupported()) return;
    send({ type: "notificationOwner", userId });
    send({ type: "notificationStatus", requestId: crypto.randomUUID() });
    let cancelled = false;
    const load = () => {
      if (userId)
        void api<Preferences>("/notifications/preferences")
          .then((value) => {
            if (!cancelled) setPreferences(value);
          })
          .catch(() => {});
    };
    load();
    window.addEventListener("connect:notification-preferences", load);
    return () => {
      cancelled = true;
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(
          new Error("Your account changed. Open notification settings again."),
        );
      }
      pending.clear();
      window.removeEventListener("connect:notification-preferences", load);
      send({ type: "notificationOwner", userId: null });
    };
  }, [userId, ready]);
  useEffect(() => {
    if (
      !desktopNotificationsSupported() ||
      !userId ||
      loadedUser !== userId ||
      baseline.current.owner !== userId
    )
      return;
    const existing = baseline.current;
    if (!existing.initialized) {
      existing.initialized = true;
      items.forEach((item) => {
        existing.seen.add(item.id);
        const sequence = /^\d+$/.test(item.sequence)
          ? BigInt(item.sequence)
          : 0n;
        if (sequence > existing.sequence) existing.sequence = sequence;
      });
      return;
    }
    if (!preferences) return;
    for (const item of [...items].reverse()) {
      if (existing.seen.has(item.id)) continue;
      existing.seen.add(item.id);
      const sequence = /^\d+$/.test(item.sequence) ? BigInt(item.sequence) : 0n;
      if (sequence <= existing.sequence) continue;
      existing.sequence = sequence;
      if (
        !native.enabled ||
        item.read_at ||
        !preferences[item.category as keyof Preferences] ||
        !notificationDestination(item.url, item.company_id)
      )
        continue;
      if (
        item.category === "messages" &&
        (!item.company_id || item.company_id === companyId) &&
        isVisibleNotificationConversation(item.url)
      )
        continue;
      send({
        type: "notificationShow",
        id: item.id,
        userId,
        title: preferences.previews ? item.title.slice(0, 120) : "Connect",
        body: preferences.previews
          ? item.text.slice(0, 500)
          : "You have a new notification.",
        url: item.url,
        companyId: item.company_id,
      });
    }
    if (existing.seen.size > 1000)
      existing.seen = new Set(items.map((item) => item.id));
  }, [userId, companyId, loadedUser, items, preferences, native.enabled]);
  useEffect(() => {
    if (
      !userId ||
      !update?.available ||
      !native.enabled ||
      !preferences?.updates ||
      !desktopNotificationsSupported()
    )
      return;
    const key = `connect.desktop-update-notified:${update.platform}:${userId}`;
    try {
      if (localStorage.getItem(key) === update.version) return;
      send({
        type: "notificationShow",
        id: crypto.randomUUID(),
        userId,
        title: "Connect update available",
        body: `Connect ${update.version} is ready to download.`,
        url: "/account/updates",
        companyId: null,
      });
      localStorage.setItem(key, update.version);
    } catch {
      /* Notification preferences continue to work without browser storage. */
    }
  }, [userId, update, native.enabled, preferences?.updates]);
}
