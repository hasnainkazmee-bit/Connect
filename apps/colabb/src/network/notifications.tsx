import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bell, Check, ChevronRight, Settings2 } from "lucide-react";
import { useApp } from "../context";
import { confirmedNotificationsRead } from "../web-push";
import { NetworkState, useNetworkResource } from "./common";
import { networkApi, networkError, networkPost, networkTime } from "./client";
import type { NetworkList, NetworkNotification } from "./types";
export function NetworkNotifications({
  onNavigate,
  onRead,
  settings = false,
}: {
  onNavigate: (path: string) => void;
  onRead: () => void;
  settings?: boolean;
}) {
  const { session } = useApp();
  const [tab, setTab] = useState("all"),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    [visibility, setVisibility] = useState(0);
  const resource = useNetworkResource<
      NetworkList<NetworkNotification> & { unread_count: number }
    >(`/notifications?limit=30${tab === "unread" ? "&unread=true" : ""}`),
    root = useRef<HTMLDivElement>(null),
    pending = useRef(new Set<string>());
  useEffect(() => {
    const changed = () => {
      if (!document.hidden && document.hasFocus()) setVisibility((v) => v + 1);
    };
    window.addEventListener("focus", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.removeEventListener("focus", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);
  useEffect(() => {
    if (settings) return;
    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          const id = el.dataset.notificationId;
          if (!id || el.dataset.read === "true" || pending.current.has(id))
            return;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
            if (timers.has(el)) return;
            timers.set(
              el,
              window.setTimeout(async () => {
                timers.delete(el);
                if (document.hidden || !document.hasFocus()) return;
                pending.current.add(id);
                try {
                  await networkPost("/notifications/read", { ids: [id] });
                  if (session.user)
                    confirmedNotificationsRead(session.user.id, [id]);
                  resource.setData((data) =>
                    data
                      ? {
                          ...data,
                          items: data.items.map((item) =>
                            item.id === id
                              ? { ...item, read_at: new Date().toISOString() }
                              : item,
                          ),
                        }
                      : data,
                  );
                  onRead();
                } catch (e) {
                  pending.current.delete(id);
                  setError(networkError(e));
                }
              }, 1200),
            );
          } else {
            clearTimeout(timers.get(el));
            timers.delete(el);
          }
        });
      },
      { threshold: [0.8] },
    );
    root.current
      ?.querySelectorAll("[data-notification-id]")
      .forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [resource.data?.items.length, settings, tab, visibility]);
  async function loadMore() {
    if (!resource.data?.next_cursor) return;
    setMore(true);
    try {
      const r = await networkApi<NetworkList<NetworkNotification>>(
        `/notifications?limit=30&cursor=${encodeURIComponent(resource.data.next_cursor)}${tab === "unread" ? "&unread=true" : ""}`,
      );
      resource.setData((d) =>
        d
          ? {
              ...d,
              items: [...d.items, ...r.items],
              next_cursor: r.next_cursor,
            }
          : d,
      );
    } catch (e) {
      setError(networkError(e));
    } finally {
      setMore(false);
    }
  }
  if (settings)
    return (
      <NotificationPreferences onBack={() => onNavigate("/notifications")} />
    );
  return (
    <div ref={root} className="nw-notifications">
      <div className="nw-section-heading nw-heading-actions">
        <div>
          <h1>Notifications</h1>
          <p>Replies, mentions and updates from your network.</p>
        </div>
        <button
          className="nw-icon"
          aria-label="Notification preferences"
          onClick={() => onNavigate("/notifications/settings")}
        >
          <Settings2 size={19} />
        </button>
      </div>
      <div className="nw-tabs">
        <button
          aria-current={tab === "all" ? "page" : undefined}
          onClick={() => setTab("all")}
        >
          All
        </button>
        <button
          aria-current={tab === "unread" ? "page" : undefined}
          onClick={() => setTab("unread")}
        >
          Unread
        </button>
      </div>
      {resource.loading || resource.error ? (
        <NetworkState
          loading={resource.loading}
          error={resource.error}
          retry={resource.retry}
        />
      ) : !resource.data?.items.length ? (
        <NetworkState
          title={
            tab === "unread"
              ? "You’re all caught up"
              : "Keep the conversation going"
          }
        >
          <p>
            {tab === "unread"
              ? "New notifications will appear here."
              : "Your replies, mentions and company updates will appear here."}
          </p>
        </NetworkState>
      ) : (
        <div className="nw-panel nw-notification-list">
          {resource.data.items.map((item) => (
            <button
              key={item.id}
              className={`nw-notification ${item.read_at ? "" : "unread"}`}
              data-notification-id={item.id}
              data-read={!!item.read_at}
              onClick={async () => {
                if (!item.read_at) {
                  try {
                    await networkPost("/notifications/read", {
                      ids: [item.id],
                    });
                    if (session.user)
                      confirmedNotificationsRead(session.user.id, [item.id]);
                    onRead();
                  } catch (e) {
                    setError(networkError(e));
                  }
                }
                const path = item.url?.startsWith("/network/")
                  ? item.url.slice(8)
                  : item.post_id
                    ? `/posts/${item.post_id}`
                    : item.community_id
                      ? `/communities/${item.community_id}`
                      : "";
                if (path) onNavigate(path);
              }}
            >
              <span className="nw-notification-icon">
                <Bell size={19} />
              </span>
              <span>
                <strong>{item.title}</strong>
                {item.body && <p>{item.body}</p>}
                <small>{networkTime(item.created_at)}</small>
              </span>
              {!item.read_at && <i />}
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
      {resource.data?.next_cursor && (
        <div className="nw-load-more">
          <button className="nw-button" disabled={more} onClick={loadMore}>
            {more ? "Loading…" : "More notifications"}
          </button>
        </div>
      )}
      {error && (
        <p className="nw-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function NotificationPreferences({ onBack }: { onBack: () => void }) {
  type Preferences = {
    replies: boolean;
    mentions: boolean;
    community_posts: boolean;
    company_posts: boolean;
  };
  const resource = useNetworkResource<{ preferences: Preferences }>(
      "/notification-preferences",
    ),
    [values, setValues] = useState<Preferences | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (resource.data) setValues(resource.data.preferences);
  }, [resource.data]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await networkApi("/notification-preferences", {
        method: "PUT",
        body: JSON.stringify(values),
      });
      setSaved(true);
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="nw-back" onClick={onBack}>
        ← Notifications
      </button>
      <div className="nw-section-heading">
        <h1>Stay in the loop</h1>
        <p>Choose which Network updates reach you.</p>
      </div>
      {resource.loading || resource.error ? (
        <NetworkState
          loading={resource.loading}
          error={resource.error}
          retry={resource.retry}
        />
      ) : (
        values && (
          <form className="nw-panel" onSubmit={save}>
            {(
              [
                [
                  "replies",
                  "Replies to your posts",
                  "Know when someone adds to the conversation.",
                ],
                [
                  "mentions",
                  "Mentions",
                  "When a person includes you in a post or comment.",
                ],
                [
                  "community_posts",
                  "Community discussions",
                  "New discussions in communities you’ve joined.",
                ],
                [
                  "company_posts",
                  "Company posts",
                  "Posts from companies you follow.",
                ],
              ] as const
            ).map(([key, label, hint]) => (
              <label className="nw-preference" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={values[key]}
                  onChange={(e) => {
                    setValues((v) =>
                      v ? { ...v, [key]: e.target.checked } : v,
                    );
                    setSaved(false);
                  }}
                />
              </label>
            ))}
            {error && <p className="nw-error">{error}</p>}
            <div className="nw-actions">
              <button className="nw-button nw-primary" disabled={busy}>
                {busy ? "Saving…" : "Save preferences"}
              </button>
              {saved && (
                <span className="nw-saved">
                  <Check size={16} />
                  Saved
                </span>
              )}
            </div>
          </form>
        )
      )}
    </>
  );
}
