import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  LoaderCircle,
  MessageCircle,
  Search,
  ArrowUp,
  Layers,
  Reply,
  Pin,
  SmilePlus,
  CheckCheck,
  FolderOpen,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { JobLogo, type JobDetail, type JobStatus } from "./jobs";
import { JobAttachments, type JobFile } from "./job-attachments";
import { ChatAttachmentUpload } from "./project-chat-attachments";
import { type QuoteHistory } from "./project-chat-workflow";
import "./project-chat.css";
import type { Company } from "./types";
import {
  confirmedNotificationsRead,
  useNotificationConversation,
} from "./web-push";
import { ProjectActivity, pendingActivityCount } from "./project-activity";
import { ChatEmojiPicker } from "./chat-emoji-picker";

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
  attachments?: JobFile[];
  reply?: {
    id: string;
    body: string;
    author_name: string;
    sender_name: string;
    attachments?: JobFile[];
  } | null;
  reactions?: {
    emoji: string;
    count: number;
    reacted: boolean;
    people?: { id: string; name: string; company_name: string }[];
  }[];
  pinned?: boolean;
  readByOtherCompany?: boolean;
};
type MessagePage = {
  messages: ChatMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
  pinnedMessages?: ChatMessage[];
  conversation?: {
    company: Company;
    canSend: boolean;
    needsStart: boolean;
    invited: boolean;
    reason?: string | null;
  };
};
type Draft = {
  body: string;
  clientId?: string;
  attachments?: JobFile[];
  reply?: ChatMessage["reply"];
};
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
      clientId:
        typeof value.clientId === "string"
          ? value.clientId
          : crypto.randomUUID(),
      attachments: Array.isArray(value.attachments)
        ? value.attachments.filter(
            (f: JobFile) =>
              typeof f?.id === "string" && typeof f.original_name === "string",
          )
        : [],
      reply: value.reply?.id ? value.reply : null,
    };
  } catch {
    return { body: "", clientId: crypto.randomUUID(), attachments: [] };
  }
}
function saveDraft(key: string, draft: Draft) {
  try {
    if (draft.body || draft.attachments?.length || draft.reply)
      sessionStorage.setItem(key, JSON.stringify(draft));
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
  const [showDetails, setShowDetails] = useState(
    () => window.matchMedia("(min-width: 901px)").matches,
  );
  const jobId = params.get("job") || "",
    providerId = params.get("provider") || "";
  const selected = jobId && providerId ? `${jobId}:${providerId}` : "";
  const fromMatches = params.get("from") === "matches" && !!selected;
  const matchesParams = new URLSearchParams();
  if (
    ["confirmation", "needsConfirmation"].includes(
      params.get("matchView") || "",
    )
  )
    matchesParams.set("view", "confirmation");
  const matchPage = Number(params.get("matchPage"));
  if (Number.isInteger(matchPage) && matchPage > 1)
    matchesParams.set("page", String(matchPage));
  const matchesHref = `/jobs/${jobId}/matches${matchesParams.size ? `?${matchesParams}` : ""}`;
  const layout = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = layout.current;
    if (!el) return;
    const size = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty(
        "--inbox-height",
        `${Math.max(240, Math.floor((window.visualViewport?.height || window.innerHeight) - top))}px`,
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
  }, [fromMatches]);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false,
      queued = false;
    const load = async () => {
      if (controller.signal.aborted || document.visibilityState !== "visible")
        return;
      if (busy) {
        queued = true;
        return;
      }
      queued = false;
      busy = true;
      try {
        const value = await api<{ threads: Thread[]; hasMore: boolean }>(
          `/jobs/inbox?q=${encodeURIComponent(query)}&page=${page}&unread=${unread}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResult(value);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        busy = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (queued) {
            queued = false;
            void load();
          }
        }
      }
    };
    setLoading(true);
    const timer = window.setTimeout(load, query ? 180 : 0),
      poll = window.setInterval(load, 8000);
    window.addEventListener("focus", load);
    window.addEventListener("connect:job-activity", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", load);
      window.removeEventListener("connect:job-activity", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [company.id, query, page, unread, revision, retry]);
  const active = result?.threads.find((t) => threadKey(t) === selected);
  const read = useCallback(() => {
    refresh();
  }, [refresh]);
  const openThread = (thread: Thread) => {
    setShowDetails(window.matchMedia("(min-width: 901px)").matches);
    setParams({ job: thread.job_id, provider: thread.provider_id });
  };
  return (
    <div
      className={`jobs-page workspace-inbox ${selected ? "has-conversation" : ""} ${fromMatches ? "inbox-from-matches" : ""}`}
    >
      {fromMatches && (
        <div className="inbox-match-navigation">
          <Link to={matchesHref}>
            <ArrowLeft size={17} /> Back to matches
          </Link>
          <Link to="/jobs/inbox">
            All conversations <ArrowRight size={16} />
          </Link>
        </div>
      )}
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
              [
                ...new Map(
                  result.threads.map((thread) => [thread.job_id, thread]),
                ).values(),
              ].map((jobThread) => (
                <section
                  className="project-thread-group"
                  key={jobThread.job_id}
                  aria-label={jobThread.title}
                >
                  <div className="project-thread-group-heading">
                    <BriefcaseBusiness size={15} />
                    <strong title={jobThread.title}>{jobThread.title}</strong>
                  </div>
                  <span className="project-thread-group-status">
                    {statusLabels[jobThread.status]}
                  </span>
                  {result.threads
                    .filter((thread) => thread.job_id === jobThread.job_id)
                    .map((thread) => (
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
                          <span className="inbox-thread-preview">
                            {thread.sender_company_id === company.id &&
                            thread.body
                              ? "You: "
                              : ""}
                            {thread.body || "Discuss this job"}
                          </span>
                        </span>
                        {thread.unread_count > 0 && (
                          <span
                            className="inbox-unread-count"
                            aria-label={`${thread.unread_count} unread messages`}
                          >
                            {thread.unread_count > 99
                              ? "99+"
                              : thread.unread_count}
                          </span>
                        )}
                      </button>
                    ))}
                </section>
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
            fromMatches={fromMatches}
          />
        ) : (
          <section className="inbox-welcome">
            <span>
              <MessageCircle size={32} />
            </span>
            <h2>Keep the conversation moving.</h2>
            <p>
              Choose a job conversation to compare quotes, discuss the work, and
              agree on the next step.
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
  fromMatches,
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
  fromMatches: boolean;
}) {
  const { admin } = useApp();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [readingLatest, setReadingLatest] = useState(false);
  const [compactScreen, setCompactScreen] = useState(
    () => window.matchMedia("(max-width: 900px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompactScreen(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [detail, setDetail] = useState<JobDetail | null>(null),
    [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<QuoteHistory | null>(null);
  const [tab, setTab] = useState<"messages" | "files">("messages");
  const [fileList, setFileList] = useState<JobFile[]>([]),
    [filesLoading, setFilesLoading] = useState(false),
    [filesError, setFilesError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false),
    [messageQuery, setMessageQuery] = useState(""),
    [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null),
    [searchBusy, setSearchBusy] = useState(false),
    [searchError, setSearchError] = useState("");
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]),
    [showPinned, setShowPinned] = useState(false);
  const [uploading, setUploading] = useState(false),
    [messageActionError, setMessageActionError] = useState("");
  const [conversation, setConversation] =
    useState<MessagePage["conversation"]>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [connectionError, setConnectionError] = useState(false);
  const [hasOlder, setHasOlder] = useState(false),
    [olderBusy, setOlderBusy] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [newMessages, setNewMessages] = useState(false);
  useNotificationConversation(
    !loading &&
      !error &&
      tab === "messages" &&
      !messageQuery.trim() &&
      !showPinned &&
      readingLatest &&
      !(showDetails && compactScreen)
      ? `/jobs/inbox?job=${jobId}&provider=${providerId}`
      : null,
  );
  const draftKey = `connect-job-draft:${userId}:${company.id}:${jobId}:${providerId}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(draftKey));
  const [sending, setSending] = useState<ChatMessage | null>(null),
    [sendError, setSendError] = useState("");
  const [inviting, setInviting] = useState(false),
    [invitedHere, setInvitedHere] = useState(false),
    [inviteError, setInviteError] = useState("");
  const inviteLock = useRef(false);
  const activityRoot = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    latest = useRef<ChatMessage[]>([]),
    poll = useRef<() => void>(() => {}),
    marked = useRef(""),
    readBusy = useRef(false),
    markedEvent = useRef(""),
    eventReadBusy = useRef(false);
  const messagePosition = useRef({ top: 0, atBottom: true });
  const scrollIntent = useRef<
    { kind: "bottom" } | { kind: "prepend"; height: number; top: number } | null
  >(null);
  const live = useRef(true),
    sendLock = useRef(false);
  const nearBottom = () => {
    const element = feed.current;
    if (!element || !element.getClientRects().length)
      return messagePosition.current.atBottom;
    return element.scrollHeight - element.clientHeight - element.scrollTop < 90;
  };
  useLayoutEffect(() => {
    if (
      tab !== "messages" ||
      !feed.current?.getClientRects().length ||
      (showDetails && compactScreen)
    )
      return;
    feed.current.scrollTop = messagePosition.current.atBottom
      ? feed.current.scrollHeight
      : messagePosition.current.top;
    setReadingLatest(messagePosition.current.atBottom);
    if (messagePosition.current.atBottom) setNewMessages(false);
  }, [tab, showDetails, compactScreen]);
  const bottom = () => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
    setNewMessages(false);
    setReadingLatest(true);
    messagePosition.current = {
      top: feed.current?.scrollTop || 0,
      atBottom: true,
    };
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
    if (!intent || !el?.getClientRects().length) return;
    scrollIntent.current = null;
    if (!messages.length && !sending) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTop =
      intent.kind === "bottom"
        ? el.scrollHeight
        : el.scrollHeight - intent.height + intent.top;
    if (intent.kind === "bottom") {
      setNewMessages(false);
      setReadingLatest(true);
    }
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
      ready = false,
      queued = false;
    const load = async () => {
      if (controller.signal.aborted || document.visibilityState !== "visible")
        return;
      if (!ready || busy) {
        queued = true;
        return;
      }
      queued = false;
      busy = true;
      try {
        const cursor = latest.current.at(-1)?.id;
        const [r, recent, h, d] = await Promise.all([
          api<MessagePage>(
            `/jobs/${jobId}/messages?providerId=${providerId}${cursor ? `&after=${cursor}` : ""}`,
            { signal: controller.signal },
          ),
          cursor
            ? api<MessagePage>(
                `/jobs/${jobId}/messages?providerId=${providerId}`,
                { signal: controller.signal },
              )
            : Promise.resolve(null),
          api<QuoteHistory>(
            `/jobs/${jobId}/quote-history?providerId=${providerId}`,
            { signal: controller.signal },
          ),
          api<JobDetail>(`/jobs/${jobId}`, { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) {
          merge([...(recent?.messages || []), ...r.messages]);
          setHistory(h);
          setDetail(d);
          setPinnedMessages(recent?.pinnedMessages || r.pinnedMessages || []);
          if (r.conversation) setConversation(r.conversation);
          if (!cursor) setHasOlder(r.hasOlder);
          setConnectionError(false);
          if (r.hasNewer) queued = true;
        }
      } catch {
        if (!controller.signal.aborted) setConnectionError(true);
      } finally {
        busy = false;
        if (queued && !controller.signal.aborted) {
          queued = false;
          void load();
        }
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
      api<QuoteHistory>(
        `/jobs/${jobId}/quote-history?providerId=${providerId}`,
        { signal: controller.signal },
      ),
    ])
      .then(([d, m, h]) => {
        if (controller.signal.aborted) return;
        setDetail(d);
        setHistory(h);
        setPinnedMessages(m.pinnedMessages || []);
        setConversation(m.conversation);
        latest.current = m.messages;
        scrollIntent.current = { kind: "bottom" };
        setMessages(m.messages);
        setHasOlder(m.hasOlder);
        setLoading(false);
        ready = true;
        if (queued) {
          queued = false;
          void load();
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    const timer = window.setInterval(load, 5000);
    window.addEventListener("focus", load);
    window.addEventListener("connect:job-activity", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("connect:job-activity", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [jobId, providerId, retry]);
  useEffect(() => {
    if (!loading) poll.current();
  }, [revision]);
  useEffect(() => {
    if (!showDetails) return;
    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close activity"]',
    );
    close?.focus({ preventScroll: true });
    return () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="inbox-project-activity"]',
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
    if (
      !last ||
      !root ||
      tab !== "messages" ||
      messageQuery.trim() ||
      showPinned
    )
      return;
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
        (showDetails && window.matchMedia("(max-width: 900px)").matches) ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      const bounds = root.getBoundingClientRect(),
        item = node.getBoundingClientRect();
      if (
        !root.getClientRects().length ||
        bounds.height <= 0 ||
        !node.getClientRects().length ||
        item.bottom > bounds.bottom + 1 ||
        item.bottom <= bounds.top
      )
        return;
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
    root.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", mark);
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [
    messages,
    jobId,
    providerId,
    onRead,
    showDetails,
    tab,
    messageQuery,
    showPinned,
  ]);
  useEffect(() => {
    const event = [...(history?.events || [])]
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      )
      .at(-1);
    if (!event) return;
    const roots: HTMLElement[] = [];
    const activityScroll = activityRoot.current?.querySelector<HTMLElement>(
      ".project-activity-scroll",
    );
    if (showDetails && activityScroll) roots.push(activityScroll);
    if (!roots.length) return;
    const mark = async () => {
      if (
        eventReadBusy.current ||
        markedEvent.current === event.id ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      const visible = roots.some((root) => {
        if (!root.getClientRects().length) return false;
        const bounds = root.getBoundingClientRect();
        // Current proof and its history can both exist, with one tab hidden.
        // Read the visible heading; a long proof card need not fit onscreen.
        return Array.from(
          root.querySelectorAll<HTMLElement>(`[data-event-id="${event.id}"]`),
        ).some((node) => {
          if (!node.getClientRects().length) return false;
          const item = node.getBoundingClientRect();
          return (
            bounds.height > 0 &&
            item.height > 0 &&
            item.top >= bounds.top - 1 &&
            item.top + Math.min(item.height, 48) <= bounds.bottom + 1
          );
        });
      });
      if (!visible) return;
      eventReadBusy.current = true;
      try {
        const result = await post<{ notificationIds: string[] }>(
          `/jobs/${jobId}/events/read`,
          { providerId, eventId: event.id },
        );
        confirmedNotificationsRead(userId, result.notificationIds);
        markedEvent.current = event.id;
        if (live.current) onRead();
      } catch {
        /* Keep unread if the server did not confirm it. */
      } finally {
        eventReadBusy.current = false;
      }
    };
    const observers = roots.map((root) => {
      const observer = new IntersectionObserver(() => void mark(), {
        root,
        threshold: [0, 0.5, 1],
      });
      const observe = () => {
        observer.disconnect();
        root
          .querySelectorAll(`[data-event-id="${event.id}"]`)
          .forEach((node) => observer.observe(node));
      };
      observe();
      const changes = new MutationObserver(observe);
      changes.observe(root, { childList: true, subtree: true });
      root.addEventListener("scroll", mark, { passive: true });
      return () => {
        observer.disconnect();
        changes.disconnect();
        root.removeEventListener("scroll", mark);
      };
    });
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      observers.forEach((dispose) => dispose());
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [
    history,
    jobId,
    providerId,
    userId,
    tab,
    messageQuery,
    showPinned,
    showDetails,
    onRead,
    compactScreen,
  ]);
  useEffect(() => {
    if (!sendError || !draft.clientId || sending) return;
    const delivered = messages.find(
      (message) => message.client_id === draft.clientId,
    );
    if (!delivered || delivered.body !== draft.body.trim()) return;
    const savedIds = (draft.attachments || [])
      .map((file) => file.id)
      .sort()
      .join(",");
    if (
      (delivered.attachments || [])
        .map((file) => file.id)
        .sort()
        .join(",") !== savedIds
    )
      return;
    setDraft({
      body: "",
      clientId: crypto.randomUUID(),
      attachments: [],
      reply: null,
    });
    saveDraft(draftKey, { body: "" });
    setSendError("");
  }, [messages, sendError, draft, sending, draftKey]);
  const changeDraft = (body: string) => {
    const next = { ...draft, body: body.slice(0, 5000) };
    setDraft(next);
    saveDraft(draftKey, next);
    setSendError("");
  };
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (
      !canSend ||
      loading ||
      error ||
      uploading ||
      (!draft.body.trim() && !draft.attachments?.length) ||
      sendLock.current
    )
      return;
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
      attachments: draft.attachments,
      reply: draft.reply,
    };
    const sendingDraft = { ...draft, body, clientId };
    saveDraft(draftKey, sendingDraft);
    sendLock.current = true;
    setSendError("");
    scrollIntent.current = { kind: "bottom" };
    setSending(pending);
    setDraft({ ...sendingDraft, body: "" });
    try {
      const result = await post<{ message: ChatMessage }>(
        `/jobs/${jobId}/messages`,
        {
          providerId,
          body,
          clientId,
          fileIds: sendingDraft.attachments?.map((f) => f.id) || [],
          replyTo: sendingDraft.reply?.id || null,
          ...(conversation?.needsStart ? { startConversation: true } : {}),
        },
      );
      if (readDraft(draftKey).clientId === clientId)
        saveDraft(draftKey, { body: "" });
      if (live.current) {
        merge([result.message], true);
        setConversation((value) =>
          value ? { ...value, needsStart: false } : value,
        );
        setSending(null);
        setDraft({
          body: "",
          clientId: crypto.randomUUID(),
          attachments: [],
          reply: null,
        });
        onSent();
        poll.current();
      }
    } catch (e) {
      if (live.current) {
        setSending(null);
        setDraft(sendingDraft);
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
  useEffect(() => {
    if (tab !== "files") return;
    const controller = new AbortController();
    setFilesLoading(true);
    setFilesError("");
    api<{ files: JobFile[] }>(
      `/jobs/${jobId}/messages/files?providerId=${providerId}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setFileList(r.files);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setFilesError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFilesLoading(false);
      });
    return () => controller.abort();
  }, [tab, jobId, providerId, revision, messages.length]);
  useEffect(() => {
    const query = messageQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearchError("");
      setSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    setSearchBusy(true);
    const timer = window.setTimeout(
      () =>
        void api<MessagePage>(
          `/jobs/${jobId}/messages?providerId=${providerId}&q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        )
          .then((r) => {
            if (!controller.signal.aborted) {
              setSearchResults(r.messages);
              setSearchError("");
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted) setSearchError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearchBusy(false);
          }),
      220,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [messageQuery, jobId, providerId]);
  const attachmentChange = (attachments: JobFile[]) =>
    setDraft((current) => {
      const next = { ...current, attachments };
      saveDraft(draftKey, next);
      return next;
    });
  const reply = (message: ChatMessage) => {
    const next = {
      ...draft,
      reply: {
        id: message.id,
        body: message.body,
        author_name: message.author_name,
        sender_name: message.sender_name,
        attachments: message.attachments,
      },
    };
    setDraft(next);
    saveDraft(draftKey, next);
    setTab("messages");
    input.current?.focus();
  };
  const clearReply = () => {
    const next = { ...draft, reply: null };
    setDraft(next);
    saveDraft(draftKey, next);
  };
  const messageAction = async (
    message: ChatMessage,
    action: "react" | "pin",
    data: object,
  ) => {
    setMessageActionError("");
    try {
      const result = await post<{
        reactions?: ChatMessage["reactions"];
        pinned?: boolean;
      }>(`/jobs/${jobId}/messages/${message.id}/${action}`, {
        providerId,
        ...data,
      });
      merge([{ ...message, ...result }]);
      if (action === "pin")
        setPinnedMessages((current) =>
          result.pinned
            ? [
                ...current.filter((m) => m.id !== message.id),
                { ...message, pinned: true },
              ]
            : current.filter((m) => m.id !== message.id),
        );
    } catch (e) {
      setMessageActionError((e as Error).message);
    }
  };
  const other =
    conversation?.company ||
    (detail
      ? detail.permissions.hirer
        ? detail.conversations.find((c) => c.id === providerId)
        : detail.hiringCompany
      : initialThread?.company);
  const title =
    detail?.job.title || initialThread?.title || "Loading conversation…";
  const canSend =
    conversation?.canSend ??
    (!!detail &&
      (detail.permissions.hirer ||
        detail.permissions.chosen ||
        detail.job.status === "open"));
  const invited = invitedHere || !!conversation?.invited;
  const starting = !!conversation?.needsStart && !invited && !messages.length;
  const canInvite =
    admin &&
    !!detail?.permissions.hirer &&
    !!other &&
    detail.job.status === "open" &&
    !detail.quotes.some((quote) => quote.provider_company_id === providerId) &&
    (!detail.job.quote_deadline ||
      new Date(detail.job.quote_deadline).getTime() >= Date.now());
  const invite = async () => {
    if (!canInvite || invited || inviteLock.current) return;
    inviteLock.current = true;
    setInviting(true);
    setInviteError("");
    try {
      const result = await post<{ invitedCompanyIds: string[] }>(
        `/jobs/${jobId}/invite`,
        { companyIds: [providerId] },
      );
      if (!result.invitedCompanyIds.includes(providerId))
        throw new Error("This company cannot receive an invitation yet.");
      if (live.current) {
        setInvitedHere(true);
        setConversation((value) =>
          value ? { ...value, invited: true, needsStart: false } : value,
        );
        onSent();
        poll.current();
      }
    } catch (e) {
      if (live.current) setInviteError((e as Error).message);
    } finally {
      inviteLock.current = false;
      if (live.current) setInviting(false);
    }
  };
  const visibleMessages =
    sending && !messages.some((m) => m.client_id === sending.client_id)
      ? [...messages, sending]
      : messages;
  const displayedMessages = messageQuery.trim()
    ? searchResults || []
    : showPinned
      ? pinnedMessages
      : visibleMessages;
  const activityCount = useMemo(
    () =>
      detail ? pendingActivityCount(detail, history, providerId, admin) : 0,
    [detail, history, providerId, admin],
  );
  const timeline = [...displayedMessages].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const allFiles = [
    ...new Map(
      [
        ...(detail?.files.filter(
          (f) =>
            (!f.provider_company_id || f.provider_company_id === providerId) &&
            (!f.quote_id || history?.quote?.id === f.quote_id) &&
            (!f.update_id ||
              detail.selected?.provider_company_id === providerId),
        ) || []),
        ...fileList,
      ].map((f) => [f.id, f]),
    ).values(),
  ];
  const workflowChanged = () => {
    poll.current();
    onSent();
  };
  return (
    <>
      <section
        className="inbox-conversation"
        aria-label={`Conversation with ${other?.name || "company"}`}
      >
        <header className="inbox-conversation-header">
          <button
            className="inbox-back-button"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft size={19} />
            <span>Inbox</span>
          </button>
          <div className="inbox-conversation-title">
            <Link to={`/jobs/${jobId}`} title={title}>
              {title}
            </Link>
            <span className="project-conversation-company">
              <JobLogo company={other} />
              {other ? (
                <Link to={`/jobs/companies/${other.slug}`}>{other.name}</Link>
              ) : (
                "Company conversation"
              )}
              <span className="project-company-separator">·</span>
              <span
                className={`inbox-job-status status-${detail?.job.status || "loading"}`}
              >
                {detail ? statusLabels[detail.job.status] : "Loading…"}
              </span>
            </span>
          </div>
          <div className="inbox-header-actions">
            <button
              className={`inbox-header-action ${searchOpen ? "is-active" : ""}`}
              aria-label="Search this conversation"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((v) => !v);
                setMessageQuery("");
                setTab("messages");
              }}
            >
              <Search size={19} />
              <span>Search</span>
            </button>
            <button
              className={`inbox-header-action ${tab === "files" ? "is-active" : ""}`}
              aria-label={
                tab === "files"
                  ? "Back to messages"
                  : "Files for this conversation"
              }
              aria-pressed={tab === "files"}
              onClick={() => {
                setTab(tab === "files" ? "messages" : "files");
                setSearchOpen(false);
                setMessageQuery("");
              }}
            >
              {tab === "files" ? (
                <MessageCircle size={19} />
              ) : (
                <FileText size={19} />
              )}
              <span>{tab === "files" ? "Messages" : "Files"}</span>
            </button>
            <button
              className={`inbox-header-action ${showDetails ? "is-active" : ""}`}
              aria-label="Activity"
              aria-expanded={showDetails}
              aria-controls="inbox-project-activity"
              onClick={() => {
                onToggleDetails();
              }}
            >
              <Layers size={19} />
              <span>Activity</span>
              {activityCount > 0 && (
                <b className="inbox-activity-count">{activityCount}</b>
              )}
            </button>
          </div>
        </header>
        {(((pinnedMessages.length > 0 || showPinned) && tab === "messages") ||
          (invited && !history?.quote) ||
          (canInvite && !invited)) && (
          <div className="project-conversation-toolbar">
            {(pinnedMessages.length > 0 || showPinned) &&
              tab === "messages" && (
                <button
                  className={`project-pinned-toggle ${showPinned ? "is-active" : ""}`}
                  aria-pressed={showPinned}
                  onClick={() => {
                    setShowPinned((v) => !v);
                    setMessageQuery("");
                  }}
                >
                  <Pin size={14} />
                  {showPinned
                    ? "Show all messages"
                    : `${pinnedMessages.length} pinned`}
                </button>
              )}
            {invited && !history?.quote ? (
              <span className="project-invited">
                <Check size={14} />
                Invited to quote
              </span>
            ) : canInvite && !invited ? (
              <button
                className="project-text-button"
                disabled={inviting}
                onClick={() => void invite()}
              >
                {inviting ? "Inviting…" : "Invite to quote"}
              </button>
            ) : null}
          </div>
        )}
        {searchOpen && tab === "messages" && (
          <div className="project-message-search">
            <Search size={17} />
            <input
              autoFocus
              aria-label="Search messages in this job"
              placeholder="Search messages in this job"
              value={messageQuery}
              onChange={(e) => {
                setMessageQuery(e.target.value);
                setShowPinned(false);
              }}
            />
            <button
              className="inbox-icon-button"
              aria-label="Close message search"
              onClick={() => {
                setSearchOpen(false);
                setMessageQuery("");
              }}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {inviteError && (
          <p className="inbox-invite-error" role="alert">
            {inviteError}
          </p>
        )}
        {connectionError && (
          <div className="inbox-connection-status" role="status">
            Reconnecting to messages…{" "}
            <button onClick={() => poll.current()}>Try now</button>
          </div>
        )}
        {tab === "files" ? (
          <div className="project-files-view">
            <header>
              <h2>Files for this job</h2>
              <p>
                Plans, quote documents, progress photos, and files shared in
                this conversation.
              </p>
            </header>
            {filesLoading ? (
              <div className="inbox-loading">
                <LoaderCircle className="inbox-spinner" size={19} />
                Loading files…
              </div>
            ) : filesError ? (
              <p className="inbox-send-error" role="alert">
                {filesError}
              </p>
            ) : allFiles.length ? (
              <JobAttachments files={allFiles} />
            ) : (
              <div className="project-files-empty">
                <FolderOpen size={28} />
                <h3>No files shared yet</h3>
                <p>
                  Attach a photo or PDF to a message. It will also appear here.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="inbox-message-area">
            <div
              className="inbox-message-scroll"
              ref={feed}
              role="log"
              aria-label="Job messages"
              aria-live="polite"
              aria-relevant="additions"
              onScroll={() => {
                if (
                  !feed.current?.getClientRects().length ||
                  (showDetails && compactScreen)
                )
                  return;
                messagePosition.current = {
                  top: feed.current?.scrollTop || 0,
                  atBottom: nearBottom(),
                };
                setReadingLatest(nearBottom());
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
                  {hasOlder && !messageQuery.trim() && !showPinned && (
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
                  {messageActionError && (
                    <p className="inbox-send-error" role="alert">
                      {messageActionError}
                    </p>
                  )}
                  {searchBusy && (
                    <p className="project-search-status">Searching…</p>
                  )}
                  {searchError && (
                    <p className="inbox-send-error" role="alert">
                      {searchError}
                    </p>
                  )}
                  {messageQuery.trim() &&
                    !searchBusy &&
                    !displayedMessages.length && (
                      <div className="inbox-chat-empty">
                        <Search size={24} />
                        <h2>No matching messages</h2>
                        <p>Try a different word or phrase.</p>
                      </div>
                    )}
                  {showPinned && !pinnedMessages.length && (
                    <div className="inbox-chat-empty">
                      <Pin size={24} />
                      <h2>No pinned messages</h2>
                      <button onClick={() => setShowPinned(false)}>
                        Show all messages
                      </button>
                    </div>
                  )}
                  {!timeline.length && !messageQuery.trim() && !showPinned && (
                    <div className="inbox-chat-empty">
                      {!fromMatches && (
                        <span>
                          <MessageCircle size={27} />
                        </span>
                      )}
                      <h2>
                        {!canSend
                          ? "No messages in this conversation"
                          : other
                            ? `Say hello to ${other.name}`
                            : "Start the conversation"}
                      </h2>
                      <p>
                        {canSend
                          ? "Discuss the work, ask a question, or check when they can start."
                          : "Use Activity for job updates or Files for shared documents."}
                      </p>
                      {canSend && (
                        <div
                          className="inbox-conversation-starters"
                          aria-label="Message suggestions"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (draft.body.trim()) return;
                              changeDraft(
                                "Hi, are you available for this job? Let me know when your team could start.",
                              );
                              input.current?.focus();
                            }}
                            disabled={!!draft.body.trim()}
                          >
                            <CalendarDays size={15} /> Ask about availability
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (draft.body.trim()) return;
                              changeDraft(
                                "Hi, could your team help with this job? Please take a look at the details and let me know what you need to prepare a quote.",
                              );
                              input.current?.focus();
                            }}
                            disabled={!!draft.body.trim()}
                          >
                            <MessageCircle size={15} /> Discuss the work
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {timeline.map((entry, index) => {
                    const previous = timeline[index - 1],
                      newDay =
                        !previous ||
                        new Date(previous.created_at).toDateString() !==
                          new Date(entry.created_at).toDateString();
                    const grouped =
                      !!previous &&
                      !newDay &&
                      entry.author_id === previous.author_id &&
                      entry.sender_company_id === previous.sender_company_id &&
                      Date.parse(entry.created_at) -
                        Date.parse(previous.created_at) <
                        5 * 60_000;
                    const next = timeline[index + 1];
                    const groupEnd = !(
                      next &&
                      next.author_id === entry.author_id &&
                      next.sender_company_id === entry.sender_company_id &&
                      Date.parse(next.created_at) -
                        Date.parse(entry.created_at) <
                        5 * 60_000 &&
                      new Date(next.created_at).toDateString() ===
                        new Date(entry.created_at).toDateString()
                    );
                    return (
                      <Fragment key={entry.id}>
                        {newDay && (
                          <div className="inbox-date-divider">
                            <span>{dayLabel(entry.created_at)}</span>
                          </div>
                        )}
                        <ProjectMessage
                          message={entry}
                          grouped={grouped}
                          groupEnd={groupEnd}
                          otherCompany={other?.name}
                          companyId={company.id}
                          userId={userId}
                          sending={sending?.id === entry.id}
                          canSend={canSend}
                          onReply={() => reply(entry)}
                          onReact={(emoji) =>
                            void messageAction(entry, "react", {
                              emoji,
                            })
                          }
                          onPin={() =>
                            void messageAction(entry, "pin", {
                              pinned: !entry.pinned,
                            })
                          }
                        />
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
        )}
        {!loading &&
          !error &&
          tab === "messages" &&
          (canSend ? (
            <form
              className="inbox-composer"
              onSubmit={(event) => {
                if (emojiOpen) event.preventDefault();
                else void send(event);
              }}
            >
              {starting && (
                <p className="inbox-first-message-note">
                  Your job details will be shared with{" "}
                  {other?.name || "this company"} when you send.
                </p>
              )}
              {sendError && (
                <p className="inbox-send-error" role="alert">
                  {sendError} Your message is saved. Retry sending or{" "}
                  <button
                    type="button"
                    className="project-text-button"
                    onClick={() => {
                      setDraft({
                        body: "",
                        clientId: crypto.randomUUID(),
                        attachments: [],
                        reply: null,
                      });
                      saveDraft(draftKey, { body: "" });
                      setSendError("");
                    }}
                  >
                    discard this draft
                  </button>
                  .
                </p>
              )}
              {draft.reply && (
                <div className="project-reply-composer">
                  <Reply size={16} />
                  <div>
                    <strong>
                      Replying to{" "}
                      {draft.reply.author_name || draft.reply.sender_name}
                    </strong>
                    <span>
                      {draft.reply.body ||
                        draft.reply.attachments?.[0]?.original_name ||
                        "Attachment"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inbox-icon-button"
                    aria-label="Cancel reply"
                    disabled={!!sending || !!sendError}
                    onClick={clearReply}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div className="inbox-compose-row">
                <ChatAttachmentUpload
                  key={draft.clientId}
                  jobId={jobId}
                  providerId={providerId}
                  clientId={draft.clientId!}
                  files={draft.attachments || []}
                  onChange={attachmentChange}
                  onBusy={setUploading}
                  disabled={!!sending || !!sendError}
                />
                <div className="inbox-compose-field">
                  <textarea
                    ref={input}
                    aria-label="Job message"
                    placeholder={`Message ${other?.name || "this company"}…`}
                    rows={1}
                    maxLength={5000}
                    value={draft.body}
                    disabled={!!sending || !!sendError}
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
                    type="button"
                    className="inbox-emoji-button"
                    aria-label="Add emoji"
                    aria-expanded={emojiOpen}
                    disabled={!!sending || !!sendError}
                    onClick={() => setEmojiOpen((value) => !value)}
                  >
                    <SmilePlus size={21} />
                  </button>
                  <button
                    type="submit"
                    aria-label="Send"
                    title="Send message"
                    disabled={
                      !!sending ||
                      uploading ||
                      (!draft.body.trim() && !draft.attachments?.length)
                    }
                  >
                    {sending ? (
                      <LoaderCircle className="inbox-spinner" size={18} />
                    ) : (
                      <ArrowUp size={20} />
                    )}
                    <span>
                      {sending ? "Sending" : sendError ? "Retry" : "Send"}
                    </span>
                  </button>
                </div>
              </div>
              {emojiOpen && (
                <ChatEmojiPicker
                  onClose={() => {
                    setEmojiOpen(false);
                    input.current?.focus();
                  }}
                  onSelect={(emoji) => {
                    const start =
                      input.current?.selectionStart ?? draft.body.length;
                    const end = input.current?.selectionEnd ?? start;
                    changeDraft(
                      draft.body.slice(0, start) +
                        emoji +
                        draft.body.slice(end),
                    );
                    setEmojiOpen(false);
                    requestAnimationFrame(() => {
                      input.current?.focus();
                      input.current?.setSelectionRange(
                        start + emoji.length,
                        start + emoji.length,
                      );
                    });
                  }}
                />
              )}
              <div className="inbox-composer-hint">
                <span>
                  Sending as <strong>{company.name}</strong>
                </span>
                <span>Enter to send · Shift + Enter for a new line</span>
              </div>
            </form>
          ) : (
            <div className="inbox-closed-note">
              {conversation?.reason ||
                "This conversation is closed. You can still read your messages."}
            </div>
          ))}
      </section>
      {detail && (
        <div
          className="inbox-activity-host"
          ref={activityRoot}
          id="inbox-project-activity"
          hidden={!showDetails}
        >
          <ProjectActivity
            detail={detail}
            history={history}
            providerId={providerId}
            admin={admin}
            onChanged={workflowChanged}
            onClose={onToggleDetails}
          />
        </div>
      )}
    </>
  );
}
function ProjectMessage({
  message,
  grouped,
  groupEnd,
  otherCompany,
  companyId,
  userId,
  sending,
  canSend,
  onReply,
  onReact,
  onPin,
}: {
  message: ChatMessage;
  grouped: boolean;
  groupEnd: boolean;
  otherCompany?: string;
  companyId: string;
  userId: string;
  sending: boolean;
  canSend: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onPin: () => void;
}) {
  const [picker, setPicker] = useState(false),
    [customEmoji, setCustomEmoji] = useState("");
  const own = message.sender_company_id === companyId;
  return (
    <article
      data-message-id={message.id}
      className={`inbox-message ${own ? "is-own" : ""} ${sending ? "is-sending" : ""} ${grouped ? "is-grouped" : ""} ${groupEnd ? "is-group-end" : ""}`}
    >
      <div className="inbox-message-author">
        {message.author_id === userId
          ? "You"
          : message.author_name || message.sender_name}
        <span> · {message.sender_name}</span>
        {message.pinned && <Pin size={12} />}
        <time
          dateTime={message.created_at}
          title={stamp(message.created_at, true)}
        >
          {new Date(message.created_at).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </div>
      <div className="inbox-message-body">
        {message.reply && (
          <div className="project-quoted-message">
            <Reply size={14} />
            <div>
              <strong>
                {message.reply.author_name || message.reply.sender_name}
              </strong>
              <span>
                {message.reply.body ||
                  message.reply.attachments?.[0]?.original_name ||
                  "Attachment"}
              </span>
            </div>
          </div>
        )}
        {message.body && (
          <div className="project-message-text">
            <MessageText body={message.body} />
          </div>
        )}
        {!!message.attachments?.length && (
          <JobAttachments files={message.attachments} />
        )}
      </div>
      {!!message.reactions?.length && (
        <div className="project-message-reactions">
          {message.reactions.map((reaction) => (
            <button
              type="button"
              key={reaction.emoji}
              aria-pressed={reaction.reacted}
              disabled={!canSend || sending}
              title={
                reaction.people
                  ?.map((p) => `${p.name} · ${p.company_name}`)
                  .join("\n") || `${reaction.count} reactions`
              }
              onClick={() => onReact(reaction.emoji)}
            >
              <span>{reaction.emoji}</span>
              {reaction.count}
            </button>
          ))}
        </div>
      )}
      <div className="inbox-message-meta">
        {own &&
          groupEnd &&
          (sending ? (
            <span>Sending…</span>
          ) : (
            <span>
              {message.readByOtherCompany ? (
                <CheckCheck size={12} />
              ) : (
                <Check size={12} />
              )}{" "}
              {message.readByOtherCompany
                ? `Seen by ${otherCompany || "the other company"}`
                : "Sent"}
            </span>
          ))}
        {!sending && canSend && (
          <span className="project-message-tools">
            <button
              type="button"
              aria-label="Reply to message"
              title="Reply"
              onClick={onReply}
            >
              <Reply size={14} />
            </button>
            <button
              type="button"
              aria-label="React to message"
              title="React"
              aria-expanded={picker}
              onClick={() => setPicker((v) => !v)}
            >
              <SmilePlus size={14} />
            </button>
            <button
              type="button"
              aria-label={message.pinned ? "Unpin message" : "Pin message"}
              title={message.pinned ? "Unpin" : "Pin"}
              onClick={onPin}
            >
              <Pin size={14} />
            </button>
          </span>
        )}
      </div>
      {picker && (
        <div className="project-reaction-picker">
          <div>
            {["👍", "✅", "👏", "🙌", "❤️", "👀"].map((emoji) => (
              <button
                type="button"
                aria-label={`React ${emoji}`}
                key={emoji}
                onClick={() => {
                  onReact(emoji);
                  setPicker(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customEmoji.trim()) {
                onReact(customEmoji.trim());
                setPicker(false);
                setCustomEmoji("");
              }
            }}
          >
            <input
              aria-label="Another emoji"
              placeholder="Paste an emoji"
              value={customEmoji}
              maxLength={16}
              onChange={(e) => setCustomEmoji(e.target.value)}
            />
            <button type="submit" disabled={!customEmoji.trim()}>
              Add
            </button>
            <button
              type="button"
              aria-label="Close reactions"
              onClick={() => setPicker(false)}
            >
              <X size={14} />
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
