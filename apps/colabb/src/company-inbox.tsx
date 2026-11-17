import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Building2,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  PencilLine,
  Search,
  ShieldOff,
  Users,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import type {
  Company,
  Connection,
  ConnectionRequest,
  Message,
  Network,
  Profile,
} from "./types";
import { AttachmentViewer } from "./job-attachments";
import {
  confirmedNotificationsRead,
  useNotificationConversation,
} from "./web-push";
import {
  NotificationContext,
  useNotificationReadContext,
} from "./notifications";
import { usePageGuard } from "./page-navigation";
import { InboxSections } from "./inbox-sections";
import "./brand/company-inbox.css";

const destination = (id: string) =>
  `/inbox/companies?company=${encodeURIComponent(id)}`;
const profileUrl = (c: Company) => `/${c.username || c.slug}`;
const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const fileSize = (size: number) =>
  size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

function CompanyLogo({ company }: { company: Company }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="cmi-logo">
      {company.logo_url && !failed ? (
        <img
          src={company.logo_url}
          alt={`${company.name} logo`}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function useInboxData<T>(path: string | null, poll = false) {
  const { revision } = useApp();
  const [state, setState] = useState<{
    path: string | null;
    data?: T;
    error?: string;
  }>({ path });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      // The full-screen attachment viewer keeps the conversation mounted.
      // Fetching the latest messages marks them read, so pause behind that view.
      if (
        busy ||
        controller.signal.aborted ||
        document.hidden ||
        document.querySelector(".company-inbox")?.closest("[hidden]")
      )
        return;
      busy = true;
      try {
        const data = await api<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ path, data });
      } catch (e) {
        if (!controller.signal.aborted)
          setState((old) => ({
            path,
            data: old.path === path ? old.data : undefined,
            error: (e as Error).message,
          }));
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = poll ? window.setInterval(load, 6000) : undefined;
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [path, revision, reload, poll]);
  return {
    data: state.path === path ? state.data : undefined,
    error: state.path === path ? state.error : undefined,
    retry: () => setReload((n) => n + 1),
  };
}

function useInboxVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const container = document
      .querySelector(".company-inbox")
      ?.closest(".app-route-container");
    if (!container) return;
    const update = () => setVisible(!container.hasAttribute("hidden"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
    return () => observer.disconnect();
  }, []);
  return visible;
}

function useDraft(key: string) {
  const [body, setBody] = useState(() => {
    try {
      return sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      body ? sessionStorage.setItem(key, body) : sessionStorage.removeItem(key);
    } catch {
      /* The composer works without storage. */
    }
  }, [key, body]);
  return [body, setBody] as const;
}

function Feedback({
  children,
  retry,
}: {
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="cmi-error" role="alert">
      {children}
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
function Loading() {
  return (
    <div className="cmi-loading" role="status">
      <LoaderCircle size={22} />
      Loading conversation…
    </div>
  );
}

export function CompanyInboxPage() {
  const { company, session, signIn, createCompany } = useApp();
  const [params] = useSearchParams();
  if (!company)
    return (
      <section className="cmi-access">
        <MessageCircle size={32} />
        <h1>Talk to a company.</h1>
        <p>
          {session.user
            ? "Company messages are shared with your team. Choose or set up a company to continue."
            : "Sign in to introduce your company and start a conversation."}
        </p>
        {!session.user ? (
          <button
            className="cmi-primary"
            onClick={() =>
              signIn(`/inbox/companies${params.size ? `?${params}` : ""}`)
            }
          >
            Sign in to message
          </button>
        ) : session.user.account_type !== "individual" ? (
          <button className="cmi-primary" onClick={createCompany}>
            Set up your company
          </button>
        ) : (
          <Link className="cmi-secondary" to="/account">
            Open account settings
          </Link>
        )}
      </section>
    );
  return (
    <CompanyInboxWorkspace
      key={`${session.user?.id}:${company.id}`}
      company={company}
    />
  );
}

function CompanyInboxWorkspace({ company }: { company: Company }) {
  const [params, setParams] = useSearchParams();
  const {
    data: network,
    error,
    retry,
  } = useInboxData<Network>("/network", true);
  const [query, setQuery] = useState("");
  const filter = params.get("filter") || "all";
  const legacyId = params.get("conversation");
  const target =
    params.get("company") ||
    network?.connections.find((c) => c.id === legacyId)?.company.id;
  const isNew = params.get("new") === "1";
  const selected = !!target || !!legacyId || isNew;
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () =>
      node.style.setProperty(
        "--cmi-height",
        `${Math.max(300, (window.visualViewport?.height || window.innerHeight) - node.getBoundingClientRect().top)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    const header = document.querySelector(".jobs-site-header");
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);
  const requests = [...(network?.incoming || []), ...(network?.sent || [])];
  const rows = [
    ...(network?.connections || [])
      .filter((c) => !requests.some((r) => r.company.id === c.company.id))
      .map((c) => ({
        company: c.company,
        preview: c.last_message || "Start the conversation",
        timestamp: c.last_message_at || c.created_at,
        unread: c.unread,
        status: c.blocked
          ? "Blocked"
          : c.status === "connected"
            ? ""
            : "Conversation closed",
        request: false,
      })),
    ...requests.map((r) => ({
      company: r.company,
      preview: r.note || "Would like to connect",
      timestamp: r.created_at,
      unread: 0,
      status: r.to_id === company.id ? "Message request" : "Request sent",
      request: true,
    })),
  ]
    .filter(
      (r) =>
        (filter !== "requests" || r.request) &&
        (filter !== "unread" || r.unread > 0) &&
        `${r.company.name} ${r.preview}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const selectFilter = (value: string) =>
    setParams({
      ...(target ? { company: target } : {}),
      ...(value !== "all" ? { filter: value } : {}),
    });
  return (
    <div
      className={`colabb-inbox company-inbox ${selected ? "cmi-selected" : ""}`}
      ref={root}
    >
      <aside className="cmi-sidebar" aria-label="Company conversations">
        <header className="cmi-list-heading">
          <div>
            <p>{company.name} workspace</p>
            <h1>Inbox</h1>
          </div>
          <Link
            to="/inbox/companies?new=1"
            className="cmi-icon"
            aria-label="New company message"
            title="New message"
          >
            <PencilLine size={20} />
          </Link>
        </header>
        <InboxSections active="companies" />
        <label className="cmi-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search company conversations"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="cmi-filters" aria-label="Filter company conversations">
          {[
            ["all", "All"],
            ["unread", "Unread"],
            ["requests", "Requests"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => selectFilter(key)}
            >
              {label}
              {key === "requests" && !!network?.incoming.length && (
                <span>{network.incoming.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="cmi-threads">
          {error && <Feedback retry={retry}>{error}</Feedback>}
          {!network && !error ? (
            <Loading />
          ) : rows.length ? (
            rows.map((row) => (
              <Link
                className={`cmi-thread ${target === row.company.id ? "is-selected" : ""} ${row.unread ? "is-unread" : ""}`}
                aria-current={target === row.company.id ? "page" : undefined}
                key={row.company.id}
                to={`${destination(row.company.id)}${filter !== "all" ? `&filter=${filter}` : ""}`}
              >
                <CompanyLogo company={row.company} />
                <span className="cmi-thread-copy">
                  <strong>{row.company.name}</strong>
                  <span className="cmi-thread-preview">{row.preview}</span>
                  {row.status && <small>{row.status}</small>}
                </span>
                <span className="cmi-thread-meta">
                  <time dateTime={row.timestamp}>{date(row.timestamp)}</time>
                  {!!row.unread && (
                    <b aria-label={`${row.unread} unread messages`}>
                      {row.unread}
                    </b>
                  )}
                </span>
              </Link>
            ))
          ) : (
            network && (
              <div className="cmi-list-empty">
                <MessageCircle size={23} />
                <strong>
                  {query
                    ? "No conversations found"
                    : filter === "requests"
                      ? "No message requests"
                      : filter === "unread"
                        ? "You’re all caught up"
                        : "Your company conversations"}
                </strong>
                <p>
                  {query
                    ? "Try a different company name."
                    : filter === "requests"
                      ? "Introductions from other companies will appear here."
                      : filter === "unread"
                        ? "New messages appear here."
                        : "Reach out to a company, then keep the conversation here."}
                </p>
                {filter === "all" && !query && (
                  <Link to="/inbox/companies?new=1">
                    New message <ArrowRight size={15} />
                  </Link>
                )}
              </div>
            )
          )}
        </div>
        <p className="cmi-rail-note">
          <Users size={15} />
          Shared with your company’s team
        </p>
      </aside>
      <section className="cmi-pane" aria-label="Company conversation">
        {isNew ? (
          <FindRecipient key={company.id} />
        ) : target && network ? (
          <CompanyConversation
            key={`${company.id}:${target}`}
            target={target}
            network={network}
            reload={retry}
          />
        ) : legacyId && network ? (
          <div className="cmi-welcome">
            <MessageCircle size={30} />
            <h2>Conversation unavailable</h2>
            <p>Choose a conversation from your company inbox.</p>
            <Link to="/inbox/companies">Back to company inbox</Link>
          </div>
        ) : selected ? (
          <Loading />
        ) : (
          <div className="cmi-welcome">
            <span>
              <MessageCircle size={32} />
            </span>
            <h2>A conversation starts here.</h2>
            <p>
              Introduce your company, ask a question, or explore working
              together. Your first message is a request.
            </p>
            <Link className="cmi-primary" to="/inbox/companies?new=1">
              <PencilLine size={17} />
              New message
            </Link>
            <small>Messages are shared with both companies’ teams.</small>
          </div>
        )}
      </section>
    </div>
  );
}

function FindRecipient() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, error, retry } = useInboxData<{
    companies: Company[];
    total: number;
    pageSize: number;
  }>(`/messaging/companies?q=${encodeURIComponent(search)}&page=${page}`);
  return (
    <>
      <header className="cmi-pane-heading">
        <Link
          className="cmi-icon"
          to="/inbox/companies"
          aria-label="Back to company inbox"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2>New message</h2>
          <p>Find a company on Colabb.</p>
        </div>
      </header>
      <div className="cmi-recipient-search">
        <label className="cmi-search">
          <Search size={18} />
          <input
            autoFocus
            type="search"
            aria-label="Find a company to message"
            placeholder="Company name, service or location"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {error && <Feedback retry={retry}>{error}</Feedback>}
        {!data && !error ? (
          <Loading />
        ) : (
          data?.companies.map((c) => (
            <Link className="cmi-recipient" to={destination(c.id)} key={c.id}>
              <CompanyLogo company={c} />
              <span>
                <strong>{c.name}</strong>
                <small>
                  {[c.type, c.location].filter(Boolean).join(" · ")}
                </small>
              </span>
              <ArrowRight size={18} />
            </Link>
          ))
        )}
        {data?.total === 0 && (
          <div className="cmi-list-empty">
            <h3>No companies found</h3>
            <p>
              Try another name or location. Only companies with a team on Colabb
              can receive messages.
            </p>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="cmi-pagination">
            <button
              className="cmi-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="cmi-secondary"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function CompanyConversation({
  target,
  network,
  reload,
}: {
  target: string;
  network: Network;
  reload: () => void;
}) {
  const { company, admin, refresh, toast } = useApp();
  const {
    data: profile,
    error,
    retry,
  } = useInboxData<Profile>(`/companies/${encodeURIComponent(target)}`);
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [confirmBlock, setConfirmBlock] = useState(false),
    [outcome, setOutcome] = useState("");
  const connection = network.connections.find((c) => c.company.id === target);
  const request = [...network.incoming, ...network.sent].find(
    (r) => r.company.id === target,
  );
  const visible = useInboxVisible();
  useNotificationReadContext(
    "company_request",
    visible && request && request.to_id === company?.id ? request.id : null,
  );
  useNotificationConversation(visible ? destination(target) : null);
  const changed = () => {
    refresh();
    retry();
    reload();
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await action();
      changed();
    } catch (e) {
      setActionError((e as Error).message);
      changed();
    } finally {
      setBusy(false);
    }
  };
  if (!profile)
    return error ? <Feedback retry={retry}>{error}</Feedback> : <Loading />;
  const c = profile.company;
  const blocked =
    !!connection?.blocked || profile.relationship.status === "blocked";
  const isSelf = c.id === company!.id;
  const managed = c.listing_status !== "unclaimed" && profile.team.length > 0;
  const samePool = !!company?.is_demo === !!c.is_demo;
  const connected = connection?.status === "connected" && !blocked;
  const respond = (action: "accept" | "decline" | "withdraw") =>
    void run(async () => {
      await post(`/requests/${request!.id}/respond`, { action });
      setOutcome(
        action === "decline"
          ? "Request declined"
          : action === "withdraw"
            ? "Request withdrawn"
            : "",
      );
      if (action === "accept") toast(`You can now message ${c.name}.`);
    });
  return (
    <>
      <header className="cmi-pane-heading">
        <Link
          className="cmi-icon cmi-back"
          to="/inbox/companies"
          aria-label="Back to company inbox"
        >
          <ArrowLeft size={20} />
        </Link>
        <CompanyLogo company={c} />
        <div>
          <Link className="cmi-company-name" to={profileUrl(c)}>
            {c.name}
          </Link>
          <p>
            {blocked
              ? "Messaging unavailable"
              : connected
                ? "Company conversation"
                : request
                  ? request.to_id === company!.id
                    ? "Message request"
                    : "Waiting for a response"
                  : c.location || c.type}
          </p>
        </div>
        <Link className="cmi-profile-link" to={profileUrl(c)}>
          View profile <ArrowRight size={15} />
        </Link>
        {admin && !isSelf && !blocked && (
          <button
            className="cmi-icon"
            aria-label="Block company"
            title="Block company"
            onClick={() => setConfirmBlock(!confirmBlock)}
          >
            <ShieldOff size={18} />
          </button>
        )}
      </header>
      {actionError && <Feedback>{actionError}</Feedback>}
      {confirmBlock && (
        <div className="cmi-confirm">
          <strong>Block {c.name}?</strong>
          <p>
            New messages and requests will stop in both directions. Existing
            messages stay available.
          </p>
          <div>
            <button
              className="cmi-secondary"
              disabled={busy}
              onClick={() => setConfirmBlock(false)}
            >
              Cancel
            </button>
            <button
              className="cmi-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post(`/relationships/${c.id}`, { action: "block" });
                  setConfirmBlock(false);
                })
              }
            >
              Confirm block
            </button>
          </div>
        </div>
      )}
      {isSelf ? (
        <div className="cmi-welcome">
          <Building2 size={30} />
          <h2>This is your company.</h2>
          <p>Choose another company to start a conversation.</p>
          <Link className="cmi-secondary" to="/inbox/companies?new=1">
            Find a company
          </Link>
        </div>
      ) : connection && !request ? (
        <CompanyChat
          key={connection.id}
          connection={connection}
          companyProfile={profile}
          onChange={changed}
          blocked={blocked}
          onUnblock={() =>
            void run(async () => {
              await post(`/relationships/${c.id}`, { action: "unblock" });
            })
          }
          busy={busy}
        />
      ) : blocked ? (
        <div className="cmi-welcome">
          <ShieldOff size={30} />
          <h2>Messaging is unavailable.</h2>
          <p>Messages and requests are blocked between these companies.</p>
          {admin && profile.relationship.blockedByMe && (
            <button
              className="cmi-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post(`/relationships/${c.id}`, { action: "unblock" });
                })
              }
            >
              Unblock company
            </button>
          )}
        </div>
      ) : request ? (
        <RequestReview
          request={request}
          busy={busy}
          onRespond={respond}
          canAccept={managed && samePool}
        />
      ) : !managed || !samePool ? (
        <div className="cmi-welcome">
          <CompanyLogo company={c} />
          <h2>
            {!managed
              ? "This company isn’t ready to receive messages."
              : "This company is in a different workspace."}
          </h2>
          <p>
            {!managed
              ? "Its team needs to claim the profile before you can contact them on Colabb."
              : "Demo companies and real companies have separate company inboxes."}
          </p>
          <Link className="cmi-secondary" to={profileUrl(c)}>
            View company profile <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <RequestComposer
          key={`${target}:${outcome}`}
          company={c}
          outcome={outcome}
          onSent={() => {
            setOutcome("");
            changed();
          }}
        />
      )}
    </>
  );
}

function RequestReview({
  request,
  busy,
  onRespond,
  canAccept,
}: {
  request: ConnectionRequest;
  busy: boolean;
  canAccept: boolean;
  onRespond: (action: "accept" | "decline" | "withdraw") => void;
}) {
  const { company, admin } = useApp();
  const incoming = request.to_id === company!.id;
  return (
    <>
      <div className="cmi-request-preview">
        <span className="cmi-request-label">
          <Clock3 size={15} />
          {incoming ? "A new introduction" : "Request sent"}
        </span>
        <div className="cmi-request-message">
          <p className="cmi-message-by">
            {request.author_name} ·{" "}
            {incoming ? request.company.name : company!.name}
            <time dateTime={request.created_at}>
              {date(request.created_at)} · {time(request.created_at)}
            </time>
          </p>
          <p>{request.note || "We’d like to connect with your company."}</p>
        </div>
      </div>
      <div className="cmi-request-decision">
        <h2>
          {incoming
            ? canAccept
              ? "Start a conversation?"
              : "This request can’t be accepted."
            : "Your introduction is on its way."}
        </h2>
        <p>
          {incoming
            ? canAccept
              ? "Accept to let both teams reply and share files."
              : "This company is no longer eligible to start a conversation. You can decline the request."
            : `${request.company.name} can read your introduction. You can send more messages after they accept.`}
        </p>
        {admin ? (
          <div className="cmi-actions">
            {incoming ? (
              <>
                {canAccept && (
                  <button
                    className="cmi-primary"
                    disabled={busy}
                    onClick={() => onRespond("accept")}
                  >
                    <Check size={17} />
                    Accept request
                  </button>
                )}
                <button
                  className="cmi-secondary"
                  disabled={busy}
                  onClick={() => onRespond("decline")}
                >
                  Decline
                </button>
              </>
            ) : (
              <button
                className="cmi-secondary"
                disabled={busy}
                onClick={() => onRespond("withdraw")}
              >
                Withdraw request
              </button>
            )}
          </div>
        ) : (
          <p className="cmi-hint">
            Your company owner or administrator can{" "}
            {incoming ? "review" : "withdraw"} this request.
          </p>
        )}
      </div>
    </>
  );
}

function RequestComposer({
  company: target,
  outcome,
  onSent,
}: {
  company: Company;
  outcome?: string;
  onSent: () => void;
}) {
  const { company, session, admin } = useApp();
  const [body, setBody] = useDraft(
    `colabb:company-request:${session.user?.id}:${company!.id}:${target.id}`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="cmi-request-compose">
      {outcome && (
        <p className="cmi-success" role="status">
          <Check size={16} />
          {outcome}
        </p>
      )}
      <CompanyLogo company={target} />
      <h2>Introduce your company.</h2>
      <p>
        Tell {target.name} why you’re reaching out. They’ll receive a request
        before the conversation starts.
      </p>
      {!admin ? (
        <div className="cmi-info">
          <Users size={20} />
          <p>
            Your company owner or administrator can send the first message. Once
            accepted, your team can reply here.
          </p>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !body.trim()) return;
            setBusy(true);
            setError("");
            try {
              await post("/requests", {
                companyId: target.id,
                kind: "message",
                note: body.trim(),
              });
              setBody("");
              onSent();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="company-message-request">Your message</label>
          <textarea
            id="company-message-request"
            aria-label="Message request"
            placeholder="Hi, we’re looking for a partner for…"
            maxLength={2000}
            rows={6}
            value={body}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="cmi-compose-meta">
            <span>
              From {session.user?.name} · <b>{company!.name}</b>
            </span>
            <span>{body.length.toLocaleString()} / 2,000</span>
          </div>
          {error && <Feedback>{error}</Feedback>}
          <button className="cmi-primary" disabled={busy || !body.trim()}>
            {busy ? <LoaderCircle size={17} /> : <ArrowUp size={17} />}
            {busy ? "Sending…" : "Send request"}
          </button>
          <p className="cmi-hint">
            Both companies’ teams will have access once the request is accepted.
          </p>
        </form>
      )}
    </div>
  );
}

type CompanyMessage = Message & { author_id: string };
type MessagePage = {
  messages: CompanyMessage[];
  hasMore: boolean;
  peerReadSequence: string;
};

function useVisibleCompanyRead(
  connectionId: string,
  sequence: string | undefined,
  visible: boolean,
  history: RefObject<HTMLDivElement | null>,
  bottom: RefObject<HTMLDivElement | null>,
  onChange: () => void,
) {
  const { session } = useApp();
  const notifications = useContext(NotificationContext);
  const callbacks = useRef({ onChange, notifications });
  callbacks.current = { onChange, notifications };
  const lastRead = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  useEffect(() => {
    if (!sequence || !visible || !session.user) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const userId = session.user.id;
    const canRead = () => {
      const element = history.current;
      const viewport = element?.getBoundingClientRect();
      const end = bottom.current?.getBoundingClientRect();
      return (
        active &&
        !document.hidden &&
        document.hasFocus() &&
        element &&
        !element.closest("[hidden]") &&
        element.clientHeight > 0 &&
        viewport &&
        end &&
        end.top >= viewport.top &&
        end.bottom <= viewport.bottom + 1
      );
    };
    const schedule = () => {
      clearTimeout(timer);
      if (
        !canRead() ||
        pending.current ||
        (lastRead.current && BigInt(lastRead.current) >= BigInt(sequence))
      )
        return;
      // Seeing the newest messages, rather than fetching them, confirms a read.
      timer = setTimeout(async () => {
        if (!canRead() || pending.current) return;
        pending.current = true;
        try {
          const result = await post<{
            notificationIds: string[];
            changed: boolean;
          }>(`/conversations/${connectionId}/read`, { sequence });
          if (!lastRead.current || BigInt(sequence) > BigInt(lastRead.current))
            lastRead.current = sequence;
          if (active && (result.changed || result.notificationIds.length)) {
            confirmedNotificationsRead(userId, result.notificationIds);
            callbacks.current.notifications?.refresh();
            callbacks.current.onChange();
          }
        } catch {
          // Retry while the visible conversation is still at the latest message.
        } finally {
          pending.current = false;
        }
      }, 600);
    };
    const element = history.current;
    element?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    document.addEventListener("visibilitychange", schedule);
    const interval = setInterval(schedule, 6000);
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
      element?.removeEventListener("scroll", schedule);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [connectionId, sequence, visible, session.user?.id, history, bottom]);
}

function CompanyChat({
  connection,
  companyProfile,
  onChange,
  blocked,
  onUnblock,
  busy: actionBusy,
}: {
  connection: Connection;
  companyProfile: Profile;
  onChange: () => void;
  blocked: boolean;
  onUnblock: () => void;
  busy: boolean;
}) {
  const { company, session, admin, open } = useApp();
  const { data, error, retry } = useInboxData<MessagePage>(
    `/conversations/${connection.id}/messages?read=false`,
    true,
  );
  const visible = useInboxVisible();
  const [body, setBody] = useDraft(
    `colabb:company-chat:${session.user?.id}:${company!.id}:${connection.id}`,
  );
  const [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [sendError, setSendError] = useState("");
  usePageGuard(files.length > 0, busy);
  const [older, setOlder] = useState<CompanyMessage[]>([]),
    [hasOlder, setHasOlder] = useState<boolean>(),
    [loadingOlder, setLoadingOlder] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    messageInput = useRef<HTMLTextAreaElement>(null),
    history = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true),
    previousHeight = useRef<number | null>(null),
    lastSend = useRef<{ fingerprint: string; id: string } | null>(null);
  const canSend = connection.status === "connected" && !blocked;
  const messages = [
    ...new Map(
      [...older, ...(data?.messages || [])].map((m) => [m.id, m]),
    ).values(),
  ].sort((a, b) => Number(BigInt(a.sequence) - BigInt(b.sequence)));
  useEffect(() => {
    if (!data) return;
    // Retain messages already read when the latest page advances. The API
    // returns a rolling page, not the entire conversation.
    setOlder((current) => {
      const ids = new Set(current.map((message) => message.id));
      const added = data.messages.filter((message) => !ids.has(message.id));
      return added.length ? [...current, ...added] : current;
    });
  }, [data]);
  const latestMessage = messages.at(-1)?.id;
  useVisibleCompanyRead(
    connection.id,
    messages.at(-1)?.sequence,
    visible,
    history,
    bottom,
    onChange,
  );
  useLayoutEffect(() => {
    const input = messageInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(48, Math.min(180, input.scrollHeight))}px`;
  }, [body]);
  useLayoutEffect(() => {
    if (previousHeight.current !== null && history.current) {
      history.current.scrollTop +=
        history.current.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (nearBottom.current)
      bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, latestMessage]);
  if (reconnect)
    return (
      <RequestComposer
        company={companyProfile.company}
        onSent={() => {
          setReconnect(false);
          onChange();
        }}
      />
    );
  return (
    <>
      <div
        className="cmi-chat"
        ref={history}
        role="log"
        aria-label="Company messages"
        onScroll={() => {
          if (history.current)
            nearBottom.current =
              history.current.scrollHeight -
                history.current.scrollTop -
                history.current.clientHeight <
              100;
        }}
      >
        <p className="cmi-chat-context">
          <Users size={15} />A shared conversation between {company!.name} and{" "}
          {connection.company.name}.
        </p>
        {error && <Feedback retry={retry}>{error}</Feedback>}
        {!data && !error && <Loading />}
        {(hasOlder ?? data?.hasMore) && (
          <button
            className="cmi-older"
            disabled={loadingOlder}
            onClick={async () => {
              setLoadingOlder(true);
              try {
                const page = await api<MessagePage>(
                  `/conversations/${connection.id}/messages?before=${messages[0].sequence}`,
                );
                previousHeight.current = history.current?.scrollHeight ?? null;
                setOlder([...page.messages, ...messages]);
                setHasOlder(page.hasMore);
              } catch (e) {
                setSendError((e as Error).message);
              } finally {
                setLoadingOlder(false);
              }
            }}
          >
            Load earlier messages
          </button>
        )}
        {messages.map((message, i) => {
          const own = message.sender_company_id === company!.id;
          return (
            <div key={message.id}>
              {(!i ||
                date(messages[i - 1].created_at) !==
                  date(message.created_at)) && (
                <div className="cmi-day">{date(message.created_at)}</div>
              )}
              <article className={`cmi-message ${own ? "cmi-own" : ""}`}>
                <p className="cmi-message-by">
                  {message.author_id === session.user?.id
                    ? "You"
                    : message.author_name}{" "}
                  · {message.sender_company_name}
                  <time dateTime={message.created_at}>
                    {time(message.created_at)}
                  </time>
                </p>
                {message.body && (
                  <div className="cmi-bubble">
                    <MessageBody body={message.body} />
                  </div>
                )}
                {message.attachments.length > 0 && (
                  <div className="cmi-message-files">
                    {message.attachments.map((f, index) => (
                      <button
                        type="button"
                        className="cmi-file"
                        key={f.id}
                        aria-label={`Preview ${f.name}`}
                        onClick={() =>
                          open(
                            <AttachmentViewer
                              files={message.attachments.map((a) => ({
                                name: a.name,
                                type: a.mime,
                                size: a.size,
                                src: `/api/attachments/${a.id}?inline=1`,
                                download: `/api/attachments/${a.id}`,
                              }))}
                              initial={index}
                            />,
                          )
                        }
                      >
                        {f.mime.startsWith("image/") ? (
                          <img
                            src={`/api/attachments/${f.id}?inline=1`}
                            alt={f.name}
                            loading="lazy"
                          />
                        ) : (
                          <FileText size={25} />
                        )}
                        <span>
                          <strong>{f.name}</strong>
                          <small>{fileSize(f.size)} · Open preview</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {own && i === messages.length - 1 && (
                  <small className="cmi-receipt">
                    {BigInt(data?.peerReadSequence || "0") >=
                    BigInt(message.sequence) ? (
                      <>
                        <CheckCheck size={15} />
                        Seen by {connection.company.name}
                      </>
                    ) : (
                      <>
                        <Check size={15} />
                        Sent
                      </>
                    )}
                  </small>
                )}
              </article>
            </div>
          );
        })}
        {data && messages.length === 0 && (
          <div className="cmi-list-empty">
            <h3>You’re connected.</h3>
            <p>Say hello or share what you’d like to work on together.</p>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {canSend ? (
        <form
          className="cmi-composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || (!body.trim() && !files.length)) return;
            setBusy(true);
            setSendError("");
            const fingerprint = JSON.stringify([
              body,
              files.map((f) => [f.name, f.size, f.lastModified]),
            ]);
            if (lastSend.current?.fingerprint !== fingerprint)
              lastSend.current = { fingerprint, id: crypto.randomUUID() };
            const payload = new FormData();
            payload.set("body", body);
            payload.set("clientId", lastSend.current.id);
            files.forEach((f) => payload.append("files", f));
            try {
              await api(`/conversations/${connection.id}/messages`, {
                method: "POST",
                body: payload,
              });
              setBody("");
              setFiles([]);
              lastSend.current = null;
              nearBottom.current = true;
              retry();
              onChange();
            } catch (e) {
              setSendError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {sendError && <Feedback>{sendError}</Feedback>}
          {files.length > 0 && (
            <div className="cmi-pending-files">
              {files.map((file, i) => (
                <div key={`${file.name}:${i}`}>
                  <button
                    type="button"
                    onClick={() =>
                      open(
                        <AttachmentViewer
                          files={files.map((f) => ({
                            name: f.name,
                            type: f.type,
                            size: f.size,
                            file: f,
                          }))}
                          initial={i}
                        />,
                      )
                    }
                  >
                    <Paperclip size={15} />
                    <span>{file.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={busy}
                    onClick={() =>
                      setFiles(files.filter((_, index) => index !== i))
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="cmi-compose-row">
            <input
              ref={upload}
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              multiple
              onChange={(e) => {
                const incoming = [
                  ...files,
                  ...Array.from(e.target.files || []),
                ];
                e.target.value = "";
                if (
                  incoming.length > 3 ||
                  incoming.some(
                    (f) =>
                      f.size > 10 * 1024 * 1024 ||
                      f.size === 0 ||
                      ![
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "application/pdf",
                      ].includes(f.type),
                  )
                ) {
                  setSendError(
                    "Choose up to 3 JPG, PNG, WebP or PDF files, no larger than 10 MB each.",
                  );
                  return;
                }
                setSendError("");
                setFiles(incoming);
              }}
            />
            <button
              type="button"
              className="cmi-icon"
              disabled={busy}
              aria-label="Attach files"
              title="Attach files"
              onClick={() => upload.current?.click()}
            >
              <Paperclip size={20} />
            </button>
            <textarea
              ref={messageInput}
              aria-label="Message"
              placeholder={`Message ${connection.company.name}…`}
              rows={1}
              maxLength={10000}
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              className="cmi-send"
              disabled={busy || (!body.trim() && !files.length)}
              aria-label="Send message"
            >
              {busy ? <LoaderCircle size={21} /> : <ArrowUp size={21} />}
            </button>
          </div>
          <div className="cmi-compose-meta">
            <span>
              {session.user?.name} · {company!.name}
            </span>
            <span>Up to 3 files · 10 MB each</span>
          </div>
          <p className="cmi-keyboard-hint">
            Enter to send · Shift + Enter for a new line
          </p>
        </form>
      ) : (
        <div className="cmi-paused">
          <strong>
            {blocked ? "Messaging is blocked." : "This conversation is closed."}
          </strong>
          <p>Your messages and files are still available.</p>
          {admin &&
            (blocked ? (
              companyProfile.relationship.blockedByMe && (
                <button
                  className="cmi-secondary"
                  disabled={actionBusy}
                  onClick={onUnblock}
                >
                  Unblock company
                </button>
              )
            ) : (
              <button
                className="cmi-secondary"
                onClick={() => setReconnect(true)}
              >
                Send a new request
              </button>
            ))}
        </div>
      )}
    </>
  );
}
function MessageBody({ body }: { body: string }) {
  return (
    <>
      {body.split(/(https?:\/\/[^\s]+)/g).map((piece, i) =>
        /^https?:\/\//.test(piece) ? (
          <a key={i} href={piece} target="_blank" rel="noopener noreferrer">
            {piece}
          </a>
        ) : (
          piece
        ),
      )}
    </>
  );
}
