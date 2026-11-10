import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Info,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Search,
  Send,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { JobLogo, type JobDetail, type JobStatus } from "./jobs";
import { JobAttachments } from "./job-attachments";
import type { Company } from "./types";
import { confirmedNotificationsRead } from "./web-push";

type Thread = {
  job_id: string;
  provider_id: string;
  title: string;
  status: JobStatus;
  company: Company;
  body: string | null;
  sender_company_id: string | null;
  unread_count: number;
  updated_at: string;
};
type ChatMessage = {
  id: string;
  body: string;
  sender_company_id: string;
  sender_name: string;
  author_name: string;
  author_id: string;
  client_id?: string;
  created_at: string;
};
type MessagePage = {
  messages: ChatMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
};
type Draft = { body: string; clientId?: string };
const statusLabels: Record<JobStatus, string> = {
  draft: "Draft",
  open: "Receiving quotes",
  awarded: "Waiting for confirmation",
  in_progress: "In progress",
  review: "Ready for review",
  completed: "Finished",
  cancelled: "Closed",
};
const threadKey = (thread: Pick<Thread, "job_id" | "provider_id">) =>
  `${thread.job_id}:${thread.provider_id}`;
const money = (cents?: number | null) =>
  cents == null
    ? "Open to quotes"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: cents % 100 ? 2 : 0,
      }).format(cents / 100);
function stamp(value: string, full = false) {
  const date = new Date(value);
  if (full)
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function dayLabel(value: string) {
  const d = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function readDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "{}");
    return {
      body: typeof value.body === "string" ? value.body.slice(0, 5000) : "",
      clientId: typeof value.clientId === "string" ? value.clientId : undefined,
    };
  } catch {
    return { body: "" };
  }
}
function saveDraft(key: string, draft: Draft) {
  try {
    if (draft.body) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    /* Sending still works when browser storage is unavailable. */
  }
}
function MessageText({ body }: { body: string }) {
  return (
    <>
      {body.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
export function JobInboxPage() {
  const { company, session, signIn } = useApp();
  if (!company)
    return (
      <div className="jobs-page workspace-inbox">
        <section className="jobs-panel inbox-access">
          <MessageCircle size={32} />
          <h1>Your conversations, together.</h1>
          <p>
            {session.user
              ? "Switch to a company account to open its inbox."
              : "Sign in to discuss jobs and quotes with companies."}
          </p>
          {!session.user && (
            <button className="jobs-button jobs-primary" onClick={signIn}>
              Sign in
            </button>
          )}
        </section>
      </div>
    );
  return (
    <InboxWorkspace
      key={`${session.user?.id}:${company.id}`}
      company={company}
    />
  );
}
function InboxWorkspace({ company }: { company: Company }) {
  const { revision, refresh, session } = useApp();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(""),
    [unread, setUnread] = useState(false),
    [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    threads: Thread[];
    hasMore: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const jobId = params.get("job") || "",
    providerId = params.get("provider") || "";
  const selected = jobId && providerId ? `${jobId}:${providerId}` : "";
  const layout = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = layout.current;
    if (!el) return;
    const size = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty(
        "--inbox-height",
        `${Math.max(320, Math.floor((window.visualViewport?.height || window.innerHeight) - top - 20))}px`,
      );
    };
    size();
    const observer = new ResizeObserver(size);
    const header = document.querySelector(".jobs-site-header");
    if (header) observer.observe(header);
    window.addEventListener("resize", size);
    window.visualViewport?.addEventListener("resize", size);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", size);
      window.visualViewport?.removeEventListener("resize", size);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const value = await api<{ threads: Thread[]; hasMore: boolean }>(
          `/jobs/inbox?q=${encodeURIComponent(query)}&page=${page}&unread=${unread}`,
          { signal: controller.signal },
        );
        setResult(value);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    setLoading(true);
    const timer = window.setTimeout(load, query ? 180 : 0),
      poll = window.setInterval(load, 8000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [company.id, query, page, unread, revision, retry]);
  const active = result?.threads.find((t) => threadKey(t) === selected);
  const read = useCallback(() => {
    refresh();
  }, [refresh]);
  const openThread = (thread: Thread) => {
    setShowDetails(false);
    setParams({ job: thread.job_id, provider: thread.provider_id });
  };
  return (
    <div
      className={`jobs-page workspace-inbox ${selected ? "has-conversation" : ""}`}
    >
      <div
        className={`inbox-layout ${showDetails ? "details-open" : ""}`}
        ref={layout}
      >
        <aside className="inbox-sidebar" aria-label="Conversations">
          <header className="inbox-list-heading">
            <div>
              <h1>Inbox</h1>
              <span>{company.name}</span>
            </div>
            <MessageCircle size={21} />
          </header>
          <div className="inbox-list-tools">
            <label className="inbox-search">
              <Search size={17} />
              <input
                aria-label="Search conversations"
                placeholder="Search companies or jobs"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <div className="inbox-filters" aria-label="Filter conversations">
              <button
                aria-pressed={!unread}
                onClick={() => {
                  setUnread(false);
                  setPage(1);
                }}
              >
                All
              </button>
              <button
                aria-pressed={unread}
                onClick={() => {
                  setUnread(true);
                  setPage(1);
                }}
              >
                Unread
              </button>
              {loading && result && (
                <LoaderCircle
                  className="inbox-spinner"
                  size={14}
                  aria-label="Updating conversations"
                />
              )}
            </div>
          </div>
          <div className="inbox-thread-list" aria-busy={loading}>
            {!result && loading ? (
              <div className="inbox-loading">
                <LoaderCircle className="inbox-spinner" size={20} />
                <span>Loading conversations…</span>
              </div>
            ) : result?.threads.length ? (
              result.threads.map((thread) => (
                <button
                  type="button"
                  className={`workspace-inbox-thread ${selected === threadKey(thread) ? "is-selected" : ""} ${thread.unread_count ? "is-unread" : ""}`}
                  key={threadKey(thread)}
                  aria-current={
                    selected === threadKey(thread) ? "true" : undefined
                  }
                  onClick={() => openThread(thread)}
                >
                  <JobLogo company={thread.company} />
                  <span className="inbox-thread-copy">
                    <span className="inbox-thread-heading">
                      <strong title={thread.company.name}>
                        {thread.company.name}
                      </strong>
                      <time
                        dateTime={thread.updated_at}
                        title={stamp(thread.updated_at, true)}
                      >
                        {stamp(thread.updated_at)}
                      </time>
                    </span>
                    <span className="inbox-thread-job" title={thread.title}>
                      {thread.title}
                    </span>
                    <span className="inbox-thread-preview">
                      {thread.sender_company_id === company.id && thread.body
                        ? "You: "
                        : ""}
                      {thread.body || "Start a conversation"}
                    </span>
                  </span>
                  {thread.unread_count > 0 && (
                    <span
                      className="inbox-unread-count"
                      aria-label={`${thread.unread_count} unread messages`}
                    >
                      {thread.unread_count > 99 ? "99+" : thread.unread_count}
                    </span>
                  )}
                </button>
              ))
            ) : (
              !error && (
                <div className="inbox-list-empty">
                  <MessageCircle size={26} />
                  <strong>
                    {query
                      ? "No matching conversations"
                      : unread
                        ? "You’re all caught up"
                        : "No conversations yet"}
                  </strong>
                  <p>
                    {query
                      ? "Try a company name or job title."
                      : unread
                        ? "New messages will appear here."
                        : "Message a company about a job, or invite one to quote."}
                  </p>
                  {!query && !unread && (
                    <Link to="/jobs">
                      Find work <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
              )
            )}
          </div>
          {error && (
            <div className="inbox-list-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
            </div>
          )}
          {(page > 1 || result?.hasMore) && (
            <div className="inbox-pagination">
              <button
                aria-label="Previous conversations"
                disabled={page === 1 || loading}
                onClick={() => setPage((n) => n - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>Page {page}</span>
              <button
                aria-label="More conversations"
                disabled={!result?.hasMore || loading}
                onClick={() => setPage((n) => n + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </aside>
        {selected ? (
          <Conversation
            key={`${company.id}:${selected}`}
            jobId={jobId}
            providerId={providerId}
            company={company}
            userId={session.user!.id}
            initialThread={active}
            revision={revision}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((v) => !v)}
            onBack={() => {
              setParams({});
              setShowDetails(false);
            }}
            onRead={read}
            onSent={read}
          />
        ) : (
          <section className="inbox-welcome">
            <span>
              <MessageCircle size={32} />
            </span>
            <h2>Keep the conversation moving.</h2>
            <p>
              Choose a company on the left to discuss the job, compare details,
              and agree on the next step.
            </p>
            <div>
              <BriefcaseBusiness size={17} /> Every conversation stays with its
              job.
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
function Conversation({
  jobId,
  providerId,
  company,
  userId,
  initialThread,
  revision,
  showDetails,
  onToggleDetails,
  onBack,
  onRead,
  onSent,
}: {
  jobId: string;
  providerId: string;
  company: Company;
  userId: string;
  initialThread?: Thread;
  revision: number;
  showDetails: boolean;
  onToggleDetails: () => void;
  onBack: () => void;
  onRead: () => void;
  onSent: () => void;
}) {
  const [detail, setDetail] = useState<JobDetail | null>(null),
    [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [connectionError, setConnectionError] = useState(false);
  const [hasOlder, setHasOlder] = useState(false),
    [olderBusy, setOlderBusy] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [newMessages, setNewMessages] = useState(false);
  const draftKey = `connect-job-draft:${userId}:${company.id}:${jobId}:${providerId}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(draftKey));
  const [sending, setSending] = useState<ChatMessage | null>(null),
    [sendError, setSendError] = useState("");
  const feed = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    latest = useRef<ChatMessage[]>([]),
    poll = useRef<() => void>(() => {}),
    marked = useRef(""),
    readBusy = useRef(false);
  const scrollIntent = useRef<
    { kind: "bottom" } | { kind: "prepend"; height: number; top: number } | null
  >(null);
  const live = useRef(true),
    sendLock = useRef(false);
  const nearBottom = () =>
    !feed.current ||
    feed.current.scrollHeight -
      feed.current.clientHeight -
      feed.current.scrollTop <
      90;
  const bottom = () => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
    setNewMessages(false);
  };
  const merge = (incoming: ChatMessage[], forceBottom = false) => {
    const wasNear = nearBottom(),
      oldIds = new Set(latest.current.map((m) => m.id));
    const values = [
      ...new Map(
        [...latest.current, ...incoming].map((m) => [m.id, m]),
      ).values(),
    ].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    latest.current = values;
    if (forceBottom || wasNear) scrollIntent.current = { kind: "bottom" };
    setMessages(values);
    if (!forceBottom && !wasNear && incoming.some((m) => !oldIds.has(m.id)))
      setNewMessages(true);
  };
  useLayoutEffect(() => {
    const intent = scrollIntent.current,
      el = feed.current;
    if (!intent || !el) return;
    scrollIntent.current = null;
    el.scrollTop =
      intent.kind === "bottom"
        ? el.scrollHeight
        : el.scrollHeight - intent.height + intent.top;
    if (intent.kind === "bottom") setNewMessages(false);
  }, [messages, sending, loading]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false,
      ready = false;
    const load = async () => {
      if (!ready || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const cursor = latest.current.at(-1)?.id;
        const r = await api<MessagePage>(
          `/jobs/${jobId}/messages?providerId=${providerId}${cursor ? `&after=${cursor}` : ""}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          merge(r.messages);
          if (!cursor) setHasOlder(r.hasOlder);
          setConnectionError(false);
          if (r.hasNewer) setTimeout(() => poll.current(), 0);
        }
      } catch {
        if (!controller.signal.aborted) setConnectionError(true);
      } finally {
        busy = false;
      }
    };
    poll.current = () => void load();
    setLoading(true);
    setError("");
    void Promise.all([
      api<JobDetail>(`/jobs/${jobId}`, { signal: controller.signal }),
      api<MessagePage>(`/jobs/${jobId}/messages?providerId=${providerId}`, {
        signal: controller.signal,
      }),
    ])
      .then(([d, m]) => {
        if (controller.signal.aborted) return;
        setDetail(d);
        latest.current = m.messages;
        scrollIntent.current = { kind: "bottom" };
        setMessages(m.messages);
        setHasOlder(m.hasOlder);
        setLoading(false);
        ready = true;
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    const timer = window.setInterval(load, 5000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [jobId, providerId, retry]);
  useEffect(() => {
    if (!loading) poll.current();
  }, [revision]);
  useEffect(() => {
    if (!showDetails) return;
    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close job details"]',
    );
    close?.focus({ preventScroll: true });
    return () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="inbox-job-details"]',
        )
        ?.focus({ preventScroll: true });
  }, [showDetails]);
  useLayoutEffect(() => {
    const el = input.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(140, Math.max(42, el.scrollHeight))}px`;
    }
  }, [draft.body, loading]);
  useEffect(() => {
    const last = messages.at(-1),
      root = feed.current;
    if (!last || !root) return;
    const node = root.querySelector<HTMLElement>(
      `[data-message-id="${last.id}"]`,
    );
    if (!node) return;
    const mark = async () => {
      if (
        readBusy.current ||
        marked.current === last.id ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        (showDetails && window.matchMedia("(max-width: 1280px)").matches) ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      const bounds = root.getBoundingClientRect(),
        item = node.getBoundingClientRect();
      if (item.bottom > bounds.bottom + 1 || item.bottom <= bounds.top) return;
      readBusy.current = true;
      try {
        const result = await post<{ notificationIds: string[] }>(
          `/jobs/${jobId}/messages/read`,
          {
            providerId,
            messageId: last.id,
          },
        );
        confirmedNotificationsRead(userId, result.notificationIds);
        marked.current = last.id;
        if (live.current) onRead();
      } catch {
        /* Retry on the next visible read; never discard unread state on failure. */
      } finally {
        readBusy.current = false;
      }
    };
    const observer = new IntersectionObserver(() => void mark(), {
      root,
      threshold: [0, 0.5, 1],
    });
    observer.observe(node);
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [messages, jobId, providerId, onRead, showDetails]);
  const changeDraft = (body: string) => {
    const next = { body };
    setDraft(next);
    saveDraft(draftKey, next);
    setSendError("");
  };
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.body.trim() || sendLock.current) return;
    const body = draft.body.trim(),
      clientId = draft.clientId || crypto.randomUUID();
    const pending: ChatMessage = {
      id: clientId,
      client_id: clientId,
      body,
      sender_company_id: company.id,
      sender_name: company.name,
      author_name: "You",
      author_id: userId,
      created_at: new Date().toISOString(),
    };
    saveDraft(draftKey, { body, clientId });
    sendLock.current = true;
    setSendError("");
    scrollIntent.current = { kind: "bottom" };
    setSending(pending);
    setDraft({ body: "" });
    try {
      const result = await post<{ message: ChatMessage }>(
        `/jobs/${jobId}/messages`,
        { providerId, body, clientId },
      );
      if (readDraft(draftKey).clientId === clientId)
        saveDraft(draftKey, { body: "" });
      if (live.current) {
        merge([result.message], true);
        setSending(null);
        onSent();
      }
    } catch (e) {
      if (live.current) {
        setSending(null);
        setDraft({ body, clientId });
        setSendError((e as Error).message);
      }
    } finally {
      sendLock.current = false;
      if (live.current) input.current?.focus({ preventScroll: true });
    }
  };
  const older = async () => {
    if (!messages.length || olderBusy) return;
    setOlderBusy(true);
    setHistoryError("");
    const before = messages[0].id,
      height = feed.current?.scrollHeight || 0,
      scroll = feed.current?.scrollTop || 0;
    try {
      const r = await api<MessagePage>(
        `/jobs/${jobId}/messages?providerId=${providerId}&before=${before}`,
      );
      if (!live.current) return;
      latest.current = [
        ...r.messages,
        ...latest.current.filter((m) => !r.messages.some((n) => n.id === m.id)),
      ];
      scrollIntent.current = { kind: "prepend", height, top: scroll };
      setMessages(latest.current);
      setHasOlder(r.hasOlder);
    } catch (e) {
      if (live.current) setHistoryError((e as Error).message);
    } finally {
      if (live.current) setOlderBusy(false);
    }
  };
  const other = detail
    ? detail.permissions.hirer
      ? detail.conversations.find((c) => c.id === providerId)
      : detail.hiringCompany
    : initialThread?.company;
  const title =
    detail?.job.title || initialThread?.title || "Loading conversation…";
  const canSend =
    !!detail &&
    (detail.permissions.hirer ||
      detail.permissions.chosen ||
      detail.job.status === "open");
  const visibleMessages =
    sending && !messages.some((m) => m.client_id === sending.client_id)
      ? [...messages, sending]
      : messages;
  return (
    <>
      <section
        className="inbox-conversation"
        aria-label={`Conversation with ${other?.name || "company"}`}
      >
        <header className="inbox-conversation-header">
          <button
            className="inbox-mobile-back inbox-icon-button"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft size={20} />
          </button>
          <JobLogo company={other} />
          <div className="inbox-conversation-title">
            {other ? (
              <Link to={`/jobs/companies/${other.slug}`}>{other.name}</Link>
            ) : (
              <strong>Company conversation</strong>
            )}
            <span>Shared with your company team</span>
          </div>
          <button
            className={`inbox-icon-button ${showDetails ? "is-active" : ""}`}
            aria-label="Job details"
            title="Job details"
            aria-expanded={showDetails}
            aria-controls="inbox-job-details"
            onClick={onToggleDetails}
          >
            <Info size={20} />
          </button>
        </header>
        <Link className="inbox-job-strip" to={`/jobs/${jobId}`}>
          <BriefcaseBusiness size={17} />
          <span>{title}</span>
          {detail && <small>{statusLabels[detail.job.status]}</small>}
          <ChevronRight size={17} />
        </Link>
        {connectionError && (
          <div className="inbox-connection-status" role="status">
            Reconnecting to messages…{" "}
            <button onClick={() => poll.current()}>Try now</button>
          </div>
        )}
        <div className="inbox-message-area">
          <div
            className="inbox-message-scroll"
            ref={feed}
            role="log"
            aria-label="Job messages"
            aria-live="polite"
            aria-relevant="additions"
            onScroll={() => {
              if (nearBottom()) setNewMessages(false);
            }}
          >
            {loading ? (
              <div className="inbox-loading">
                <LoaderCircle className="inbox-spinner" size={21} />
                <span>Loading messages…</span>
              </div>
            ) : error ? (
              <div className="inbox-chat-empty" role="alert">
                <p>{error}</p>
                <button
                  className="jobs-button jobs-secondary"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                {hasOlder && (
                  <button
                    className="inbox-load-older"
                    onClick={() => void older()}
                    disabled={olderBusy}
                  >
                    {olderBusy ? "Loading…" : "Load earlier messages"}
                  </button>
                )}
                {historyError && (
                  <p className="inbox-send-error" role="alert">
                    {historyError} Try loading earlier messages again.
                  </p>
                )}
                {!visibleMessages.length && (
                  <div className="inbox-chat-empty">
                    <span>
                      <MessageCircle size={27} />
                    </span>
                    <h2>Start the conversation</h2>
                    <p>Ask about the scope, timing, or quote for this job.</p>
                    {canSend && (
                      <button
                        onClick={() => {
                          changeDraft(
                            "Hi, can you confirm your availability for this job?",
                          );
                          input.current?.focus();
                        }}
                      >
                        Ask about availability <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                )}
                {visibleMessages.map((message, index) => {
                  const own = message.sender_company_id === company.id,
                    previous = visibleMessages[index - 1],
                    newDay =
                      !previous ||
                      new Date(previous.created_at).toDateString() !==
                        new Date(message.created_at).toDateString();
                  return (
                    <Fragment key={message.id}>
                      {newDay && (
                        <div className="inbox-date-divider">
                          <span>{dayLabel(message.created_at)}</span>
                        </div>
                      )}
                      <article
                        data-message-id={message.id}
                        className={`inbox-message ${own ? "is-own" : ""}`}
                      >
                        <div className="inbox-message-author">
                          {message.author_id === userId
                            ? "You"
                            : message.author_name || message.sender_name}
                        </div>
                        <div className="inbox-message-body">
                          <MessageText body={message.body} />
                        </div>
                        <div className="inbox-message-meta">
                          <time
                            dateTime={message.created_at}
                            title={stamp(message.created_at, true)}
                          >
                            {new Date(message.created_at).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" },
                            )}
                          </time>
                          {own &&
                            (sending?.id === message.id ? (
                              <span>Sending…</span>
                            ) : (
                              <span>
                                <Check size={12} /> Sent
                              </span>
                            ))}
                        </div>
                      </article>
                    </Fragment>
                  );
                })}
              </>
            )}
          </div>
          {newMessages && (
            <button className="inbox-new-messages" onClick={bottom}>
              <ArrowDown size={14} /> New messages
            </button>
          )}
        </div>
        {!loading &&
          !error &&
          (canSend ? (
            <form className="inbox-composer" onSubmit={send}>
              {sendError && (
                <p className="inbox-send-error" role="alert">
                  {sendError} Your message is saved below.
                </p>
              )}
              <div className="inbox-compose-field">
                <textarea
                  ref={input}
                  aria-label="Job message"
                  placeholder={`Message ${other?.name || "this company"}…`}
                  rows={1}
                  maxLength={5000}
                  value={draft.body}
                  disabled={!!sending}
                  onChange={(e) => changeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="Send"
                  title="Send message"
                  disabled={!!sending || !draft.body.trim()}
                >
                  {sending ? (
                    <LoaderCircle className="inbox-spinner" size={18} />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
              <div className="inbox-composer-hint">
                <span>
                  Sending as <strong>{company.name}</strong>
                </span>
                <span>Enter to send · Shift + Enter for a new line</span>
              </div>
            </form>
          ) : (
            <div className="inbox-closed-note">
              This conversation is closed. You can still read your messages.
            </div>
          ))}
      </section>
      {showDetails && (
        <aside
          className="inbox-job-details"
          id="inbox-job-details"
          aria-label="Job details"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onToggleDetails();
            }
          }}
        >
          <header>
            <h2>Job details</h2>
            <button
              className="inbox-icon-button"
              aria-label="Close job details"
              onClick={onToggleDetails}
            >
              <X size={19} />
            </button>
          </header>
          {detail ? (
            <JobContext detail={detail} providerId={providerId} />
          ) : (
            <div className="inbox-loading">Loading job…</div>
          )}
        </aside>
      )}
    </>
  );
}
function JobContext({
  detail,
  providerId,
}: {
  detail: JobDetail;
  providerId: string;
}) {
  const { job } = detail,
    quote = detail.permissions.hirer
      ? detail.quotes.find((q) => q.provider_company_id === providerId)
      : detail.ownQuote;
  const files = detail.files.filter(
    (f) =>
      !f.quote_id ||
      !detail.permissions.hirer ||
      detail.quotes.find((q) => q.id === f.quote_id)?.provider_company_id ===
        providerId,
  );
  return (
    <div className="inbox-context-content">
      <span className={`job-status ${job.status.replaceAll("_", "-")}`}>
        {statusLabels[job.status]}
      </span>
      <h3>{job.title}</h3>
      <p className="inbox-context-location">
        <MapPin size={15} /> {job.location}
      </p>
      <Link className="jobs-button jobs-secondary" to={`/jobs/${job.id}`}>
        View job <ArrowRight size={16} />
      </Link>
      <dl>
        <div>
          <dt>Total budget</dt>
          <dd>{money(job.budget_cents)}</dd>
        </div>
        <div>
          <dt>
            <CalendarDays size={14} /> Start
          </dt>
          <dd>{job.start_window || "Flexible"}</dd>
        </div>
        {quote && (
          <>
            <div>
              <dt>{detail.permissions.hirer ? "Their quote" : "Your quote"}</dt>
              <dd>{money(quote.amount_cents)}</dd>
            </div>
            <div>
              <dt>Proposed start</dt>
              <dd>{quote.start_window || "To be agreed"}</dd>
            </div>
          </>
        )}
      </dl>
      <details className="inbox-scope">
        <summary>Scope of work</summary>
        <p>{job.description}</p>
      </details>
      <section className="inbox-context-files">
        <h3>
          <FileText size={17} /> Job files{" "}
          {files.length ? `(${files.length})` : ""}
        </h3>
        {files.length ? (
          <JobAttachments files={files} />
        ) : (
          <p>No files shared with this job yet.</p>
        )}
      </section>
    </div>
  );
}
