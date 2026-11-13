import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  BellOff,
  Check,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Settings,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import {
  disconnectWebPush,
  enableWebPush,
  notificationDestination,
  pushBinding,
  pushSupported,
  confirmedNotificationsRead,
} from "./web-push";
import "./notifications.css";
import {
  checkDesktopUpdate,
  desktopVersion,
  useDesktopUpdate,
} from "./desktop-updates";
import {
  desktopNotificationsSupported,
  setDesktopNotifications,
  useDesktopNotificationStatus,
} from "./desktop-notifications";
export type InboxNotification = {
  id: string;
  sequence: string;
  type: string;
  category: string;
  title: string;
  text: string;
  url: string;
  company_id: string | null;
  actor_company_id: string | null;
  created_at: string;
  read_at: string | null;
};
type Page = {
  notifications: InboxNotification[];
  unread: number;
  nextCursor: string | null;
};
export function useNotificationInbox(userId: string | null, revision: number) {
  const [items, setItems] = useState<InboxNotification[]>([]),
    [unread, setUnread] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [loadedUser, setLoadedUser] = useState<string | null>(null);
  const epoch = useRef(0),
    pending = useRef(false);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  async function load(more = false) {
    if (!userId || (more && pending.current)) return;
    const owner = userId,
      sequence = more ? epoch.current : ++epoch.current;
    if (more) pending.current = true;
    setLoading(true);
    try {
      const result = await api<Page>(
        "/notifications" +
          (more && cursor ? "?before=" + encodeURIComponent(cursor) : ""),
      );
      if (currentUser.current !== owner || sequence !== epoch.current) return;
      const incoming = Array.isArray(result.notifications)
        ? result.notifications
        : [];
      setItems((old) =>
        more
          ? [
              ...old,
              ...incoming.filter(
                (n) => !old.some((existing) => existing.id === n.id),
              ),
            ]
          : incoming,
      );
      confirmedNotificationsRead(
        owner,
        incoming.filter((item) => item.read_at).map((item) => item.id),
      );
      setUnread(result.unread || 0);
      setLoadedUser(owner);
      setCursor(result.nextCursor || null);
      setError("");
    } catch (e) {
      if (currentUser.current === owner && sequence === epoch.current)
        setError((e as Error).message);
    } finally {
      if (sequence === epoch.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    epoch.current++;
    pending.current = false;
    setItems([]);
    setLoadedUser(null);
    setUnread(0);
    setCursor(null);
    setError("");
    if (!userId) {
      setLoading(false);
      return;
    }
    void load();
    const stream = new EventSource("/api/notifications/events");
    const changed = () => {
      void load();
      window.dispatchEvent(new Event("connect:job-activity"));
    };
    const visible = () => {
      if (!document.hidden) void load();
    };
    stream.addEventListener("changed", changed);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 60000);
    return () => {
      epoch.current++;
      stream.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId]);
  useEffect(() => {
    if (userId) void load();
  }, [revision]);
  async function markRead(ids?: string[]) {
    const owner = userId;
    try {
      const result = await post<{ ids?: string[] }>(
        "/notifications/read",
        ids ? { ids } : {},
      );
      if (!owner || currentUser.current !== owner) return;
      confirmedNotificationsRead(
        owner,
        result.ids || ids || items.map((item) => item.id),
      );
      setItems((old) =>
        old.map((item) =>
          !ids || ids.includes(item.id)
            ? { ...item, read_at: item.read_at || new Date().toISOString() }
            : item,
        ),
      );
      void load();
    } catch (e) {
      if (currentUser.current === owner) setError((e as Error).message);
    }
  }
  return {
    items,
    unread,
    cursor,
    error,
    loading,
    loadedUser,
    refresh: () => void load(),
    more: () => void load(true),
    markRead,
  };
}
type InboxState = ReturnType<typeof useNotificationInbox> & {
  openNotification: (url: string, companyId?: string | null) => void;
};
export const NotificationContext = createContext<InboxState | null>(null);
export function useNotificationReadContext(
  kind: "company_conversation" | "personal_conversation" | "post",
  id: string | null,
) {
  const { session } = useApp();
  const inbox = useContext(NotificationContext);
  const current = useRef(inbox);
  current.current = inbox;
  useEffect(() => {
    if (!id || !session.user) return;
    let timer = 0,
      disposed = false,
      sent = false;
    const check = () => {
      clearTimeout(timer);
      if (document.hidden || !document.hasFocus() || sent) return;
      timer = window.setTimeout(() => {
        sent = true;
        void post<{ read: number; ids?: string[] }>(
          "/notifications/read-context",
          { kind, id },
        )
          .then((result) => {
            if (!disposed && result.read > 0) {
              confirmedNotificationsRead(session.user!.id, result.ids || []);
              current.current?.refresh();
            }
          })
          .catch(() => {
            sent = false;
          });
      }, 1000);
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("blur", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("blur", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [kind, id, session.user?.id, inbox?.items[0]?.id]);
}
export function NotificationContents({
  closeMenu,
  heading = true,
}: {
  closeMenu?: () => void;
  heading?: boolean;
}) {
  const inbox = useContext(NotificationContext)!;
  const { company, network } = useApp();
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef(inbox);
  latest.current = inbox;
  useEffect(() => {
    if (!list.current) return;
    const visible = new Set<string>(),
      timers = new Map<string, number>(),
      batch = new Set<string>();
    let flush = 0;
    const clear = (id: string) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
    };
    const observeRead = (id: string) => {
      if (document.hidden || !document.hasFocus() || timers.has(id)) return;
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          if (!visible.has(id) || document.hidden || !document.hasFocus())
            return;
          batch.add(id);
          clearTimeout(flush);
          flush = window.setTimeout(() => {
            const ids = [...batch];
            batch.clear();
            if (ids.length) void latest.current.markRead(ids);
          }, 100);
        }, 1000),
      );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.notificationId!;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
            visible.add(id);
            observeRead(id);
          } else {
            visible.delete(id);
            clear(id);
          }
        }
      },
      { root: list.current, threshold: [0.65] },
    );
    list.current
      .querySelectorAll<HTMLElement>("[data-unread='true']")
      .forEach((item) => observer.observe(item));
    const focus = () => {
      for (const id of visible) {
        clear(id);
        observeRead(id);
      }
    };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      clearTimeout(flush);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [inbox.items]);
  return (
    <div className="notification-inbox">
      <div className="notification-inbox-heading">
        {heading && <strong>Notifications</strong>}
        <Link
          to="/account#notifications"
          className="icon-button"
          aria-label="Notification settings"
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            closeMenu?.();
          }}
        >
          <Settings size={17} />
        </Link>
        <button
          className="text-button"
          disabled={!inbox.unread}
          onClick={() => void inbox.markRead()}
        >
          Mark all read
        </button>
      </div>
      {company && network.incoming.length > 0 && (
        <Link
          className="requests-notification-link"
          to="/requests"
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            closeMenu?.();
          }}
        >
          <UserPlus size={17} />
          <span>Connection requests</span>
          <b className="count">{network.incoming.length}</b>
          <ChevronRight size={15} />
        </Link>
      )}
      {inbox.error && (
        <p className="notification-error" role="alert">
          {inbox.error}{" "}
          <button className="text-button" onClick={inbox.refresh}>
            Try again
          </button>
        </p>
      )}
      <div className="notification-inbox-list" ref={list}>
        {inbox.items.map((item) => {
          const Icon =
            item.category === "messages"
              ? MessageSquare
              : ["requests", "team"].includes(item.category)
                ? UserPlus
                : item.category === "updates"
                  ? RefreshCw
                  : Sparkles;
          const destination = notificationDestination(
            item.url,
            item.company_id,
          );
          return (
            <Link
              key={item.id}
              data-notification-id={item.id}
              data-unread={!item.read_at}
              className={
                "notification-item " + (!item.read_at ? "is-unread" : "")
              }
              to={destination?.path || "/account#notifications"}
              onClick={(event) => {
                event.preventDefault();
                event.currentTarget.closest("details")?.removeAttribute("open");
                closeMenu?.();
                void inbox.markRead([item.id]);
                if (destination)
                  inbox.openNotification(item.url, item.company_id);
              }}
            >
              <span className="notification-item-icon">
                <Icon size={18} />
              </span>
              <span>
                <strong>{item.title}</strong>
                {item.text && <span>{item.text}</span>}
                <small>
                  {new Date(item.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              {!item.read_at && <i aria-label="Unread" />}
            </Link>
          );
        })}
        {!inbox.items.length && (
          <div className="notification-empty">
            <Bell size={25} />
            <strong>
              {inbox.loading
                ? "Loading notifications…"
                : "You’re all caught up."}
            </strong>
            <span>Messages, company activity, and updates appear here.</span>
          </div>
        )}
      </div>
      {inbox.cursor && (
        <button
          className="button notification-load"
          disabled={inbox.loading}
          onClick={inbox.more}
        >
          {inbox.loading ? "Loading…" : "Earlier notifications"}
        </button>
      )}
      <Link
        className="notification-settings-link"
        to="/account#notifications"
        onClick={(event) => {
          event.currentTarget.closest("details")?.removeAttribute("open");
          closeMenu?.();
        }}
      >
        Choose what you hear about <ChevronRight size={16} />
      </Link>
    </div>
  );
}
type Preferences = {
  messages: boolean;
  social: boolean;
  requests: boolean;
  team: boolean;
  updates: boolean;
  previews: boolean;
};
type Config = {
  webPush: { enabled: boolean; publicKey: string | null };
  fcm: { enabled: boolean };
};
const labels: { key: keyof Preferences; title: string; description: string }[] =
  [
    {
      key: "messages",
      title: "Messages",
      description: "New messages and replies.",
    },
    {
      key: "requests",
      title: "Requests",
      description: "Message and company connection requests.",
    },
    {
      key: "social",
      title: "Company activity",
      description: "Reactions, comments, follows, and reviews.",
    },
    {
      key: "team",
      title: "Your team",
      description: "Invitations and company access changes.",
    },
    {
      key: "updates",
      title: "App updates",
      description: "When a new version of Connect is ready.",
    },
    {
      key: "previews",
      title: "Show message previews",
      description:
        "Include message text in device alerts. Leave off for more privacy.",
    },
  ];
export function NotificationPreferences() {
  const { session } = useApp();
  const [preferences, setPreferences] = useState<Preferences | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const owner = useRef(session.user?.id);
  const native = useDesktopNotificationStatus();
  const desktop = desktopNotificationsSupported();
  owner.current = session.user?.id;
  useEffect(() => {
    const controller = new AbortController();
    setPreferences(null);
    setBusy(false);
    setError("");
    if (!session.user) return;
    Promise.all([
      api<Preferences>("/notifications/preferences", {
        signal: controller.signal,
      }),
      api<Config>("/notifications/config", { signal: controller.signal }),
    ])
      .then(([prefs, settings]) => {
        if (!controller.signal.aborted) {
          setPreferences(prefs);
          setConfig(settings);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [session.user?.id]);
  useEffect(() => {
    const changed = () => setVersion((v) => v + 1);
    window.addEventListener("connect:push-changed", changed);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", changed);
    return () => {
      window.removeEventListener("connect:push-changed", changed);
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", changed);
    };
  }, []);
  const supported = pushSupported(),
    permission = desktop
      ? native.permission
      : supported
        ? Notification.permission
        : null;
  const enabled = desktop
    ? native.enabled
    : supported &&
      permission === "granted" &&
      pushBinding()?.userId === session.user?.id;
  async function action(work: () => Promise<unknown>) {
    const id = owner.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (owner.current === id) setError((e as Error).message);
    } finally {
      if (owner.current === id) {
        setBusy(false);
        setVersion((v) => v + 1);
      }
    }
  }
  return (
    <section
      className="notification-preferences"
      id="notifications"
      data-revision={version}
    >
      <h2>
        <Bell size={20} /> Notifications
      </h2>
      <p>
        Choose what reaches you. Everything stays available in your notification
        inbox.
      </p>
      <div className="notification-device">
        <span className="notification-device-icon">
          {enabled ? <Bell size={22} /> : <BellOff size={22} />}
        </span>
        <div>
          <strong>
            {enabled
              ? "Notifications are on"
              : desktop
                ? "Notifications on this computer"
                : "Notifications on this browser"}
          </strong>
          <p>
            {desktop
              ? native.permission === "denied"
                ? "Blocked in system settings. Allow notifications for Connect, then return here."
                : "Get alerts while Connect is open or minimized. Fully quit apps do not receive alerts yet."
              : !supported
                ? "Use Connect in a supported browser for device alerts. Your inbox is always available here."
                : permission === "denied"
                  ? "Blocked by your browser. Allow notifications in site settings to turn them on."
                  : !config?.webPush.enabled
                    ? "Device alerts are not available yet. Your inbox still receives notifications."
                    : enabled
                      ? "You’ll hear about the activity you choose below, even when Connect is closed."
                      : "Get an alert when something needs your attention."}
          </p>
        </div>
        {enabled ? (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void action(
                desktop
                  ? () => setDesktopNotifications(false)
                  : disconnectWebPush,
              )
            }
          >
            Turn off
          </button>
        ) : (
          (desktop || (supported && config?.webPush.enabled)) &&
          permission !== "denied" && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  desktop
                    ? setDesktopNotifications(true)
                    : enableWebPush(
                        session.user!.id,
                        config!.webPush.publicKey!,
                      ),
                )
              }
            >
              {busy ? "Enabling…" : "Enable notifications"}
            </button>
          )
        )}
      </div>
      {error && (
        <p className="notification-error" role="alert">
          {error}
        </p>
      )}
      {!preferences && !error && <p>Loading your preferences…</p>}
      <div className="notification-preference-list">
        {preferences &&
          labels.map(({ key, title, description }) => (
            <label className="notification-preference" key={key}>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={preferences[key]}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.checked;
                  const previous = preferences;
                  const id = owner.current;
                  setPreferences({ ...previous, [key]: value });
                  void action(async () => {
                    try {
                      const updated = await api<Preferences>(
                        "/notifications/preferences",
                        {
                          method: "PATCH",
                          body: JSON.stringify({ [key]: value }),
                        },
                      );
                      if (owner.current === id) {
                        setPreferences(updated);
                        window.dispatchEvent(
                          new Event("connect:notification-preferences"),
                        );
                      }
                    } catch (error) {
                      if (owner.current === id) setPreferences(previous);
                      throw error;
                    }
                  });
                }}
              />
              <span className="notification-switch" aria-hidden="true">
                <Check size={12} />
              </span>
            </label>
          ))}
      </div>
    </section>
  );
}
export function AccountUpdates() {
  const desktop = desktopVersion(),
    update = useDesktopUpdate();
  const [checking, setChecking] = useState(false),
    [available, setAvailable] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section id="updates" className="account-updates">
      <h2>
        <RefreshCw size={20} /> App updates
      </h2>
      <p>
        {desktop
          ? `Connect ${desktop.current}. Web improvements arrive automatically; install a new desktop version when one is available.`
          : "Web improvements arrive automatically. Refresh to load the latest version."}
      </p>
      {desktop && update?.available && (
        <div className="desktop-update-downloads">
          <strong>Connect {update.version} is ready</strong>
          {update.downloads.map((item) => (
            <a
              className="button primary"
              key={item.arch}
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              Download for{" "}
              {desktop.platform === "macos"
                ? "Mac"
                : `Windows ${item.arch === "arm64" ? "ARM64" : "x64"}`}
            </a>
          ))}
          <small>
            Save your work, quit Connect, then run the installer. Your account
            stays in place.
          </small>
        </div>
      )}
      <button
        className={"button " + (available ? "primary" : "")}
        disabled={checking}
        onClick={async () => {
          if (available) {
            location.reload();
            return;
          }
          setChecking(true);
          try {
            if (desktop) {
              const result = await checkDesktopUpdate(true);
              setMessage(
                result?.available
                  ? "Your desktop update is ready above."
                  : "You have the latest desktop version.",
              );
              return;
            }
            const response = await fetch("/api/health", { cache: "no-store" });
            if (!response.ok) throw new Error();
            const { release } = await response.json();
            const current =
              (import.meta as any).env.VITE_CONNECT_RELEASE || "development";
            setAvailable(
              !!release && current !== "development" && release !== current,
            );
            setMessage(
              release && current !== "development" && release !== current
                ? "A fresh Connect is ready. Your saved work will be here after refreshing."
                : "You’re up to date.",
            );
          } catch {
            setMessage("Couldn’t check right now. Please try again.");
          } finally {
            setChecking(false);
          }
        }}
      >
        {checking
          ? "Checking…"
          : available
            ? "Refresh Connect"
            : "Check for updates"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
