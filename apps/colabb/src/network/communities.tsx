import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  ImagePlus,
  LockKeyhole,
  MessageCircle,
  Pin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { networkApi, networkPost, networkPatch } from "./client";
import {
  communityDate,
  communityError,
  communityRoute,
  communityTime,
  useCommunity,
  type Community,
  type CommunityCompany,
  type CommunityField,
  type CommunityInvitation,
  type CommunityList,
  type CommunityMember,
  type CommunityPost,
  type CommunityReport,
  type CommunityRule,
  type CommunityTopic,
} from "./community-data";
import "./community.css";

export type CommunityProps = {
  path: string;
  onNavigate: (to: string) => void;
  onCompose: (options: { communityId?: string; topicId?: string }) => void;
  onPost: (id: string) => void;
  onRefresh: () => void;
  revision: number;
};
export const communityIsTask = (path: string) => !!communityRoute(path).task;
const routeTo = (c: Community) => `/communities/${c.id}`;
function CompanyMark({
  company,
  size = 44,
}: {
  company: CommunityCompany;
  size?: number;
}) {
  const [failed, setFailed] = useState("");
  return (
    <span className="nc-company-mark" style={{ width: size, height: size }}>
      {company.logo_url && failed !== company.logo_url && (
        <img
          src={company.logo_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(company.logo_url || "")}
        />
      )}
    </span>
  );
}
function CompanyLink({ company }: { company: CommunityCompany }) {
  return (
    <Link
      className="nc-company-link"
      to={company.slug ? `/${company.slug}` : `/company/${company.id}`}
    >
      {company.name}
    </Link>
  );
}
function ErrorLine({ children }: { children: ReactNode }) {
  return children ? (
    <div className="nc-error" role="alert">
      {children}
    </div>
  ) : null;
}
function BusyState({ label = "Loading community…" }: { label?: string }) {
  return (
    <div className="nc-loading" role="status">
      <div className="nc-skeleton" />
      <div className="nc-skeleton" />
      <p>{label}</p>
    </div>
  );
}
function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="nc-empty">
      <Users size={27} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  );
}
function AccessLabel({ community: c }: { community: Community }) {
  return (
    <span className="nc-access">
      {c.visibility === "private" ? (
        <LockKeyhole size={14} />
      ) : (
        <Globe2 size={14} />
      )}
      {c.visibility === "private" ? "Private community" : "Public community"}
      <span aria-hidden="true">·</span>
      {c.member_count.toLocaleString()}{" "}
      {c.member_count === 1 ? "member" : "members"}
    </span>
  );
}

export function CommunityMain(props: CommunityProps) {
  const route = communityRoute(props.path);
  const result = useCommunity(route.id, props.revision);
  if (route.area === "invitations")
    return <InvitationView {...props} token={route.token || ""} />;
  if (route.task === "new") return <CommunityEditor {...props} />;
  if (!route.id) return <DiscoverCommunities {...props} />;
  if (result.loading && !result.community) return <BusyState />;
  if (result.error)
    return (
      <EmptyState
        title="This community couldn’t load."
        action={
          <button className="nc-btn" onClick={result.retry}>
            Try again
          </button>
        }
      >
        {result.error}
      </EmptyState>
    );
  const c = result.community;
  if (!c)
    return (
      <EmptyState
        title="Community not found."
        action={
          <button
            className="nc-btn"
            onClick={() => props.onNavigate("/communities")}
          >
            Discover communities
          </button>
        }
      />
    );
  if (route.task === "manage")
    return (
      <ManageCommunity
        key={c.id + ":" + route.tab}
        {...props}
        community={c}
        tab={route.tab}
      />
    );
  return <CommunityDetail key={c.id} {...props} community={c} />;
}
export function CommunityAside(props: CommunityProps) {
  const route = communityRoute(props.path);
  const { community: c } = useCommunity(route.id, props.revision);
  if (c)
    return (
      <AboutCommunity
        community={c}
        onTopic={(id) =>
          window.dispatchEvent(
            new CustomEvent("colabb:community-topic", {
              detail: { communityId: c.id, topicId: id },
            }),
          )
        }
      />
    );
  return (
    <section className="nc-about nc-panel">
      <h2>Conversations around the work.</h2>
      <p>
        Communities bring people from solar companies together to ask questions,
        compare equipment and share experience.
      </p>
      <div className="nc-aside-detail">
        <Users size={19} />
        <div>
          <strong>Hosted by companies</strong>
          <p>Each space has its own topics, rules and team.</p>
        </div>
      </div>
      <div className="nc-aside-detail">
        <MessageCircle size={19} />
        <div>
          <strong>Join as yourself</strong>
          <p>Your name and company appear with your discussions.</p>
        </div>
      </div>
      <button
        className="nc-text-btn"
        onClick={() => props.onNavigate("/communities/new")}
      >
        Create a community <ArrowRight size={16} />
      </button>
    </section>
  );
}
function AboutCommunity({
  community: c,
  onTopic,
}: {
  community: Community;
  onTopic?: (id: string) => void;
}) {
  return (
    <section className="nc-about nc-panel">
      <h2>About this community</h2>
      <div className="nc-host">
        <CompanyMark company={c.company} />
        <div>
          <CompanyLink company={c.company} />
          <small>Hosted and managed by {c.company.name}</small>
        </div>
      </div>
      <p>{c.description}</p>
      <Link
        className="nc-text-btn"
        to={c.company.slug ? `/${c.company.slug}` : `/company/${c.company.id}`}
      >
        View company profile <ArrowRight size={15} />
      </Link>
      {c.can_read && !!c.topics.length && (
        <section className="nc-about-section">
          <h3>Topics</h3>
          <div className="nc-topic-links">
            <button onClick={() => onTopic?.("")}>
              <MessageCircle size={16} />
              All discussions
            </button>
            {c.topics.map((t) => (
              <button key={t.id} onClick={() => onTopic?.(t.id)}>
                <Tag size={16} />
                {t.label}
              </button>
            ))}
          </div>
        </section>
      )}
      <details className="nc-rules">
        <summary>
          <span>
            <FileText size={17} />
            Community rules
          </span>
          <ChevronDown size={15} />
        </summary>
        {c.rules.length ? (
          <ol>
            {c.rules.map((r, i) => (
              <li key={i}>
                <strong>{r.title}</strong>
                {r.body && <p>{r.body}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p>The host hasn’t added community rules yet.</p>
        )}
      </details>
      {c.archived_at && (
        <p className="nc-quiet-box">
          This community is archived. Existing discussions remain available to
          members.
        </p>
      )}
    </section>
  );
}
function MembershipButton({
  community: c,
  refresh,
  navigate,
  small = false,
}: {
  community: Community;
  refresh: () => void;
  navigate: CommunityProps["onNavigate"];
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { toast } = useApp();
  const joined = c.membership?.status === "joined",
    pending = c.membership?.status === "pending";
  async function action(value: "join" | "cancel" | "leave") {
    setBusy(true);
    setError("");
    try {
      const r = await networkPost<{ community: Community }>(
        `/communities/${c.id}/membership`,
        { action: value },
      );
      setExpanded(false);
      setConfirm(false);
      refresh();
      toast(
        value === "leave"
          ? "You’ve left the community."
          : value === "cancel"
            ? "Join request cancelled."
            : r.community.membership?.status === "pending"
              ? "Your request is with the host."
              : "You’ve joined the community.",
      );
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"nc-membership" + (small ? " nc-membership-small" : "")}>
      <div className="nc-actions">
        {c.can_manage || c.can_moderate ? (
          <button
            className="nc-btn"
            onClick={() => navigate(`${routeTo(c)}/manage/members`)}
          >
            <Settings2 size={16} />
            Manage
          </button>
        ) : null}
        {joined ? (
          <button
            className="nc-btn"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Check size={17} />
            Joined
            <ChevronDown size={14} />
          </button>
        ) : pending ? (
          <button
            className="nc-btn"
            disabled={busy}
            onClick={() => action("cancel")}
          >
            {busy ? "Cancelling…" : "Cancel request"}
          </button>
        ) : !c.archived_at ? (
          <button
            className="nc-btn nc-primary"
            disabled={busy}
            onClick={() => action("join")}
          >
            {busy
              ? "Please wait…"
              : c.join_policy === "approval"
                ? "Request to join"
                : "Join community"}
          </button>
        ) : (
          <span className="nc-chip">Archived</span>
        )}
      </div>
      {pending && <small>Awaiting the host’s approval.</small>}
      {expanded && (
        <div className="nc-membership-details">
          <p>Your membership belongs to you. Colleagues join separately.</p>
          {confirm ? (
            <>
              <p>
                Leave {c.name}?
                {c.visibility === "private"
                  ? " You’ll lose access to its discussions and files."
                  : " You can read public posts, but must rejoin to participate."}
              </p>
              <div className="nc-actions">
                <button
                  className="nc-btn"
                  disabled={busy}
                  onClick={() => action("leave")}
                >
                  {busy ? "Leaving…" : "Leave community"}
                </button>
                <button
                  className="nc-text-btn"
                  onClick={() => setConfirm(false)}
                >
                  Stay
                </button>
              </div>
            </>
          ) : (
            <button className="nc-text-btn" onClick={() => setConfirm(true)}>
              Leave community
            </button>
          )}
        </div>
      )}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
function DiscoverCommunities(props: CommunityProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Community[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { company } = useApp();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      networkApi<CommunityList<Community>>(
        `/communities?q=${encodeURIComponent(query)}&limit=24`,
        { signal: controller.signal },
      )
        .then((r) => {
          setItems(r.items);
          setCursor(r.next_cursor || null);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(communityError(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, props.revision, attempt]);
  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    setError("");
    try {
      const r = await networkApi<CommunityList<Community>>(
        `/communities?q=${encodeURIComponent(query)}&limit=24&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((prev) => [...prev, ...r.items]);
      setCursor(r.next_cursor || null);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setMore(false);
    }
  }
  const canHost = company?.role === "owner" || company?.role === "admin";
  return (
    <div className="nc-discover">
      <header className="nc-page-header">
        <span className="nc-eyebrow">Company-hosted communities</span>
        <h1>Find your people in solar.</h1>
        <p>
          Ask questions, share experience and meet the people behind the work.
        </p>
      </header>
      <div className="nc-discover-toolbar">
        <label className="nc-search">
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics or host companies"
            aria-label="Search communities"
          />
        </label>
        {canHost && (
          <button
            className="nc-btn"
            onClick={() => props.onNavigate("/communities/new")}
          >
            <Plus size={17} />
            Create a community
          </button>
        )}
      </div>
      {loading ? (
        <BusyState label="Finding communities…" />
      ) : error && !items.length ? (
        <EmptyState
          title="Communities couldn’t load."
          action={
            <button className="nc-btn" onClick={() => setAttempt((x) => x + 1)}>
              Try again
            </button>
          }
        >
          {error}
        </EmptyState>
      ) : !items.length ? (
        <EmptyState
          title={
            query ? "No communities found." : "Start a useful conversation."
          }
          action={
            query ? (
              <button className="nc-btn" onClick={() => setQuery("")}>
                Clear search
              </button>
            ) : canHost ? (
              <button
                className="nc-btn nc-primary"
                onClick={() => props.onNavigate("/communities/new")}
              >
                Create a community
              </button>
            ) : undefined
          }
        >
          {query
            ? "Try another topic or company name."
            : "Communities will appear here as companies create them."}
        </EmptyState>
      ) : (
        <>
          <div className="nc-discover-grid">
            {items.map((c) => (
              <article key={c.id} className="nc-discover-card nc-panel">
                <div className="nc-host nc-host-small">
                  <CompanyMark company={c.company} size={32} />
                  <span>
                    Hosted by <CompanyLink company={c.company} />
                  </span>
                </div>
                <h2>
                  <button onClick={() => props.onNavigate(routeTo(c))}>
                    {c.name}
                  </button>
                </h2>
                <p>{c.description}</p>
                <AccessLabel community={c} />
                <footer>
                  {c.membership?.status === "joined" || c.can_manage ? (
                    <button
                      className="nc-btn"
                      onClick={() => props.onNavigate(routeTo(c))}
                    >
                      Open community
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <MembershipButton
                      community={c}
                      refresh={props.onRefresh}
                      navigate={props.onNavigate}
                      small
                    />
                  )}
                  <button
                    className="nc-text-btn"
                    onClick={() => props.onNavigate(routeTo(c))}
                  >
                    About
                  </button>
                </footer>
              </article>
            ))}
          </div>
          <ErrorLine>{error}</ErrorLine>
          {cursor && (
            <div className="nc-load-more">
              <button className="nc-btn" disabled={more} onClick={loadMore}>
                {more ? "Loading…" : "More communities"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function CommunityDetail({
  community: c,
  ...props
}: CommunityProps & { community: Community }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.communityId === c.id) setTopic(detail.topicId || "");
    };
    window.addEventListener("colabb:community-topic", handler);
    return () => window.removeEventListener("colabb:community-topic", handler);
  }, [c.id]);
  const url = `/posts?community_id=${c.id}&limit=30${query ? `&q=${encodeURIComponent(query)}` : ""}${topic ? `&topic_id=${encodeURIComponent(topic)}` : ""}`;
  useEffect(() => {
    if (!c.can_read) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      networkApi<CommunityList<CommunityPost>>(url, {
        signal: controller.signal,
      })
        .then((r) => {
          setItems(r.items);
          setCursor(r.next_cursor || null);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(communityError(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [c.can_read, url, props.revision, attempt]);
  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await networkApi<CommunityList<CommunityPost>>(
        `${url}&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((prev) => [...prev, ...r.items]);
      setCursor(r.next_cursor || null);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setMore(false);
    }
  }
  const posts = items;
  return (
    <div className="nc-detail nc-panel">
      <header className="nc-community-header">
        <div className="nc-community-heading">
          <CompanyMark company={c.company} size={54} />
          <div>
            <h1>{c.name}</h1>
            <p className="nc-hosted">
              Hosted by <CompanyLink company={c.company} />
            </p>
            <AccessLabel community={c} />
          </div>
        </div>
        <MembershipButton
          community={c}
          refresh={props.onRefresh}
          navigate={props.onNavigate}
        />
        {c.cover_url && (
          <img
            className="nc-header-cover"
            src={c.cover_url}
            alt={`${c.name} cover`}
          />
        )}
        <p className="nc-community-purpose">{c.description}</p>
      </header>
      <details className="nc-mobile-about">
        <summary>
          About, topics & community rules <ChevronDown size={16} />
        </summary>
        <AboutCommunity community={c} onTopic={setTopic} />
      </details>
      {!c.can_read ? (
        <EmptyState
          title={
            c.membership?.status === "pending"
              ? "Your request is with the host."
              : "A private space for members."
          }
        >
          {c.membership?.status === "pending"
            ? "You’ll be notified when your request is reviewed. Discussions and files stay private until you’re approved."
            : "Request to join to read discussions, view files and take part."}
        </EmptyState>
      ) : (
        <>
          <div className="nc-community-toolbar">
            <label className="nc-search">
              <Search size={17} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this community"
                aria-label="Search this community"
              />
            </label>
            <select
              aria-label="Filter discussions by topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            >
              <option value="">All topics</option>
              {c.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="nc-quiet-label">Latest discussions</span>
            {c.can_post ? (
              <button
                className="nc-btn nc-primary"
                onClick={() =>
                  props.onCompose({
                    communityId: c.id,
                    topicId: topic || undefined,
                  })
                }
              >
                <Plus size={17} />
                New post
              </button>
            ) : (
              <span className="nc-quiet-label">
                {c.archived_at ? "Read-only" : "Join to post"}
              </span>
            )}
          </div>
          {!!c.pinned_posts?.length && (
            <section
              className="nc-pinned-posts"
              aria-label="Pinned discussions"
            >
              {c.pinned_posts.map((p) => (
                <button key={p.id} onClick={() => props.onPost(p.id)}>
                  <Pin size={17} />
                  <span>
                    <small>Pinned by the community team</small>
                    <strong>{p.title || p.body.split("\n")[0]}</strong>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </section>
          )}
          {loading ? (
            <BusyState label="Loading discussions…" />
          ) : error && !items.length ? (
            <EmptyState
              title="Discussions couldn’t load."
              action={
                <button
                  className="nc-btn"
                  onClick={() => setAttempt((x) => x + 1)}
                >
                  Try again
                </button>
              }
            >
              {error}
            </EmptyState>
          ) : !posts.length ? (
            <EmptyState
              title={
                query || topic
                  ? "No matching discussions."
                  : "Start the first discussion."
              }
              action={
                c.can_post && !query && !topic ? (
                  <button
                    className="nc-btn nc-primary"
                    onClick={() => props.onCompose({ communityId: c.id })}
                  >
                    New post
                  </button>
                ) : query || topic ? (
                  <button
                    className="nc-btn"
                    onClick={() => {
                      setQuery("");
                      setTopic("");
                    }}
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            >
              {query || topic
                ? "Try a different search or topic."
                : "Ask a question or share something useful with the community."}
            </EmptyState>
          ) : (
            <div className="nc-discussion-list">
              {posts.map((p) => (
                <DiscussionRow
                  key={p.id}
                  post={p}
                  onOpen={() => props.onPost(p.id)}
                />
              ))}
            </div>
          )}
          <ErrorLine>{error && items.length ? error : ""}</ErrorLine>
          {cursor && (
            <div className="nc-load-more">
              <button className="nc-btn" disabled={more} onClick={loadMore}>
                {more ? "Loading…" : "More discussions"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function DiscussionRow({
  post: p,
  onOpen,
}: {
  post: CommunityPost;
  onOpen: () => void;
}) {
  const kind =
    p.kind === "question"
      ? "Question"
      : p.kind === "sourcing"
        ? "Looking for equipment"
        : p.kind === "available"
          ? "Equipment available"
          : "Discussion";
  return (
    <article className="nc-discussion">
      <CompanyMark company={p.company} size={42} />
      <div className="nc-discussion-content">
        <div className="nc-discussion-tags">
          <span>{p.topic_label || kind}</span>
          {p.sourcing_status && p.sourcing_status !== "open" && (
            <span>
              {p.sourcing_status === "sourced"
                ? "Sourced"
                : "No longer available"}
            </span>
          )}
        </div>
        <h2>
          <button onClick={onOpen}>{p.title || p.body.split("\n")[0]}</button>
        </h2>
        <p className="nc-discussion-excerpt">{p.body}</p>
        {!!p.answers?.length && (
          <div className="nc-discussion-facts">
            {p.answers.slice(0, 3).map((a) => (
              <span key={a.field_id}>
                <span className="nc-fact-label">{a.label}:</span>{" "}
                {String(a.value ?? "")} {a.unit || ""}
              </span>
            ))}
          </div>
        )}
        {!!p.files.length && (
          <button className="nc-file-indicator" onClick={onOpen}>
            <FileText size={14} />
            {p.files.length === 1
              ? p.files[0].name
              : `${p.files.length} attachments`}
          </button>
        )}
        <footer>
          <span>
            {p.author.name} <span aria-hidden="true">·</span>{" "}
            <CompanyLink company={p.company} />
          </span>
          <button onClick={onOpen}>
            <MessageCircle size={15} />
            {p.comment_count} {p.comment_count === 1 ? "reply" : "replies"}
            <span aria-hidden="true">·</span>
            <time dateTime={p.created_at}>{communityTime(p.created_at)}</time>
          </button>
        </footer>
      </div>
    </article>
  );
}

type EditorValue = {
  name: string;
  description: string;
  visibility: "public" | "private";
  join_policy: "open" | "approval";
  rules: CommunityRule[];
  cover_file_id?: string | null;
  cover_url: string;
};
function CommunityEditor(
  props: CommunityProps & { community?: Community; embedded?: boolean },
) {
  const c = props.community;
  const { company, toast } = useApp();
  const [value, setValue] = useState<EditorValue>(() => ({
    name: c?.name || "",
    description: c?.description || "",
    visibility: c?.visibility || "public",
    join_policy: c?.join_policy || "open",
    rules: c?.rules.map((r) => ({ ...r })) || [],
    cover_url: c?.cover_url || "",
  }));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [coverName, setCoverName] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const canHost = company?.role === "owner" || company?.role === "admin";
  const update = <K extends keyof EditorValue>(key: K, next: EditorValue[K]) =>
    setValue((prev) => ({ ...prev, [key]: next }));
  async function uploadCover(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image for the cover.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Your cover must be 12 MB or less.");
      return;
    }
    setUploading(true);
    try {
      const result = await networkApi<{ file: { id: string; url: string } }>(
        `/files?purpose=cover&name=${encodeURIComponent(file.name)}${c ? `&community_id=${c.id}` : ""}&upload_id=${crypto.randomUUID()}`,
        { method: "POST", body: file, headers: { "Content-Type": file.type } },
      );
      setValue((prev) => ({
        ...prev,
        cover_file_id: result.file.id,
        cover_url: result.file.url,
      }));
      setCoverName(file.name);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setUploading(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || uploading) return;
    setError("");
    if (value.name.trim().length < 3) {
      setError("Give your community a name with at least 3 characters.");
      return;
    }
    if (value.description.trim().length < 12) {
      setError(
        "Add a purpose of at least 12 characters so people know what to discuss.",
      );
      return;
    }
    if (value.rules.some((r) => !r.title.trim())) {
      setError("Add a title to each rule, or remove any blank rules.");
      return;
    }
    setBusy(true);
    const body = {
      name: value.name.trim(),
      description: value.description.trim(),
      visibility: value.visibility,
      join_policy:
        value.visibility === "private" ? "approval" : value.join_policy,
      rules: value.rules.map((r) => ({
        title: r.title.trim(),
        body: r.body.trim(),
      })),
      ...(value.cover_file_id === undefined
        ? {}
        : { cover_file_id: value.cover_file_id }),
    };
    try {
      const result = c
        ? await networkPatch<{ community: Community }>(`/communities/${c.id}`, {
            ...body,
            version: c.version,
          })
        : await networkPost<{ community: Community }>("/communities", {
            ...body,
            topics: [],
            require_topic: false,
          });
      props.onRefresh();
      toast(c ? "Community settings saved." : "Your community is ready.");
      props.onNavigate(routeTo(result.community));
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  }
  async function setArchived(archived: boolean) {
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      await networkPatch(`/communities/${c.id}`, {
        version: c.version,
        archived,
      });
      props.onRefresh();
      props.onNavigate(routeTo(c));
      toast(archived ? "Community archived." : "Community reopened.");
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  }
  if (!c && !canHost)
    return (
      <EmptyState
        title="Create a community with your company."
        action={
          <button
            className="nc-btn"
            onClick={() => props.onNavigate("/communities")}
          >
            Discover communities
          </button>
        }
      >
        A company owner or admin can create and host a community. Switch to a
        company you manage to continue.
      </EmptyState>
    );
  const host = c?.company || company!;
  return (
    <div className={props.embedded ? "nc-editor" : "nc-task nc-editor"}>
      {!props.embedded && (
        <>
          <button
            className="nc-back"
            onClick={() => props.onNavigate("/communities")}
          >
            <ArrowLeft size={17} />
            Communities
          </button>
          <header className="nc-page-header">
            <h1>Create a community</h1>
            <p>Give people a focused place to talk about the work.</p>
          </header>
        </>
      )}
      <div className="nc-editor-grid">
        <form className="nc-panel nc-form-panel" onSubmit={save}>
          <div className="nc-owner">
            <CompanyMark company={host} size={38} />
            <div>
              <small>Hosted by</small>
              <strong>{host.name}</strong>
            </div>
          </div>
          <label className="nc-field">
            <span>Community name</span>
            <input
              required
              minLength={3}
              maxLength={72}
              value={value.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. Equipment Sourcing"
              autoComplete="off"
            />
          </label>
          <label className="nc-field">
            <span>What is this community for?</span>
            <textarea
              required
              minLength={12}
              maxLength={400}
              rows={4}
              value={value.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Describe what people can discuss and who this space is for."
            />
            <small>{value.description.length}/400 characters</small>
          </label>
          <fieldset className="nc-field">
            <legend>
              Community cover <small>Optional</small>
            </legend>
            {value.cover_url ? (
              <div className="nc-cover-choice">
                <img src={value.cover_url} alt="Community cover preview" />
                <div>
                  <strong>{coverName || "Current cover"}</strong>
                  <small>3:2 cover image</small>
                </div>
                <button
                  className="nc-text-btn"
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    setValue((prev) => ({
                      ...prev,
                      cover_url: "",
                      cover_file_id: null,
                    }));
                    setCoverName("");
                  }}
                >
                  Remove
                </button>
              </div>
            ) : null}
            <label className="nc-upload">
              <ImagePlus size={21} />
              <span>
                {uploading
                  ? "Uploading cover…"
                  : value.cover_url
                    ? "Choose a different image"
                    : "Choose a cover image"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  void uploadCover(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <small>
              Use a 1200 × 800 px image (3:2). JPG, PNG or WebP · up to 12 MB.
              Keep important details near the center.
            </small>
          </fieldset>
          <fieldset className="nc-options">
            <legend>Who can see it?</legend>
            {(["public", "private"] as const).map((option) => (
              <label
                key={option}
                className={value.visibility === option ? "is-selected" : ""}
              >
                <input
                  type="radio"
                  name="community-visibility"
                  value={option}
                  checked={value.visibility === option}
                  onChange={() => {
                    update("visibility", option);
                    if (option === "private") update("join_policy", "approval");
                  }}
                />
                <span>
                  <strong>{option === "public" ? "Public" : "Private"}</strong>
                  <small>
                    {option === "public"
                      ? "People on Colabb can read discussions. Members can post."
                      : "Only approved members can read discussions and files."}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="nc-field">
            <span>How people join</span>
            <select
              value={value.join_policy}
              disabled={value.visibility === "private"}
              onChange={(e) =>
                update(
                  "join_policy",
                  e.target.value as EditorValue["join_policy"],
                )
              }
            >
              <option value="open">Anyone on Colabb can join</option>
              <option value="approval">Host approval required</option>
            </select>
            {value.visibility === "private" && (
              <small>Private communities always require approval.</small>
            )}
          </label>
          <section className="nc-form-section">
            <div className="nc-section-heading">
              <div>
                <h2>Community rules</h2>
                <p>Set clear expectations from the start.</p>
              </div>
              <button
                className="nc-btn"
                type="button"
                onClick={() =>
                  update("rules", [...value.rules, { title: "", body: "" }])
                }
              >
                <Plus size={16} />
                Add rule
              </button>
            </div>
            {value.rules.map((r, i) => (
              <div className="nc-rule-editor" key={i}>
                <div className="nc-inline-head">
                  <strong>Rule {i + 1}</strong>
                  <button
                    className="nc-icon-btn"
                    type="button"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() =>
                      update(
                        "rules",
                        value.rules.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <label className="nc-field">
                  <span>Rule title</span>
                  <input
                    value={r.title}
                    maxLength={100}
                    onChange={(e) =>
                      update(
                        "rules",
                        value.rules.map((item, j) =>
                          j === i ? { ...item, title: e.target.value } : item,
                        ),
                      )
                    }
                    placeholder="e.g. Keep requests specific"
                  />
                </label>
                <label className="nc-field">
                  <span>
                    Details <small>Optional</small>
                  </span>
                  <textarea
                    value={r.body}
                    maxLength={1000}
                    rows={2}
                    onChange={(e) =>
                      update(
                        "rules",
                        value.rules.map((item, j) =>
                          j === i ? { ...item, body: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            {!value.rules.length && (
              <p className="nc-muted">No rules added yet.</p>
            )}
          </section>
          <ErrorLine>{error}</ErrorLine>
          <div className="nc-form-actions">
            <button
              className="nc-btn nc-primary"
              disabled={busy || uploading}
              type="submit"
            >
              {busy ? "Saving…" : c ? "Save changes" : "Create community"}
            </button>
            <button
              className="nc-btn"
              type="button"
              disabled={busy}
              onClick={() => props.onNavigate(c ? routeTo(c) : "/communities")}
            >
              Cancel
            </button>
          </div>
          {c && (
            <section className="nc-form-section">
              <h2>
                {c.archived_at ? "Reopen community" : "Archive community"}
              </h2>
              <p>
                {c.archived_at
                  ? "Allow members to post and join again."
                  : "Stop new posts and membership requests. Existing discussions and files remain accessible to members."}
              </p>
              {c.archived_at ? (
                <button
                  className="nc-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => setArchived(false)}
                >
                  Reopen community
                </button>
              ) : archiveConfirm ? (
                <div className="nc-confirm">
                  <strong>Archive {c.name}?</strong>
                  <p>You can reopen it later.</p>
                  <div className="nc-actions">
                    <button
                      className="nc-btn"
                      type="button"
                      disabled={busy}
                      onClick={() => setArchived(true)}
                    >
                      Archive community
                    </button>
                    <button
                      className="nc-text-btn"
                      type="button"
                      onClick={() => setArchiveConfirm(false)}
                    >
                      Keep open
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="nc-text-btn"
                  type="button"
                  onClick={() => setArchiveConfirm(true)}
                >
                  Archive community
                </button>
              )}
            </section>
          )}
        </form>
        <aside className="nc-editor-preview">
          <span className="nc-eyebrow">Community preview</span>
          <section className="nc-panel">
            <div className="nc-preview-cover">
              {value.cover_url ? (
                <img src={value.cover_url} alt="" />
              ) : (
                <Users size={28} />
              )}
            </div>
            <div className="nc-preview-body">
              <div className="nc-host nc-host-small">
                <CompanyMark company={host} size={32} />
                <span>
                  Hosted by <strong>{host.name}</strong>
                </span>
              </div>
              <h2>{value.name || "Your community name"}</h2>
              <p>
                {value.description ||
                  "The purpose of your community will appear here."}
              </p>
              <span className="nc-access">
                {value.visibility === "private" ? (
                  <LockKeyhole size={14} />
                ) : (
                  <Globe2 size={14} />
                )}
                {value.visibility === "private"
                  ? "Private · approval required"
                  : value.join_policy === "approval"
                    ? "Public · approval to join"
                    : "Public · open to join"}
              </span>
            </div>
          </section>
          <p className="nc-preview-note">
            The community belongs to your company. People join and take part as
            themselves.
          </p>
        </aside>
      </div>
    </div>
  );
}
function ManageCommunity(
  props: CommunityProps & { community: Community; tab: string },
) {
  const c = props.community;
  const canAdmin = c.can_manage;
  if (!canAdmin && !c.can_moderate)
    return (
      <EmptyState
        title="Community team access required."
        action={
          <button
            className="nc-btn"
            onClick={() => props.onNavigate(routeTo(c))}
          >
            Back to community
          </button>
        }
      >
        Only this community’s admins and moderators can manage it.
      </EmptyState>
    );
  const tabs = [
    { id: "members", label: "Members" },
    { id: "posts", label: "Posts & reports" },
    ...(canAdmin
      ? [
          { id: "topics", label: "Topics & post fields" },
          { id: "settings", label: "Settings" },
        ]
      : []),
  ];
  const tab = tabs.some((t) => t.id === props.tab) ? props.tab : "members";
  return (
    <div className="nc-task">
      <button className="nc-back" onClick={() => props.onNavigate(routeTo(c))}>
        <ArrowLeft size={17} />
        Community
      </button>
      <header className="nc-manage-heading">
        <div>
          <h1>{c.name}</h1>
          <div className="nc-host nc-host-small">
            <CompanyMark company={c.company} size={30} />
            <span>
              Hosted by <CompanyLink company={c.company} />
            </span>
          </div>
        </div>
        <button className="nc-btn" onClick={() => props.onNavigate(routeTo(c))}>
          View community
          <ArrowRight size={16} />
        </button>
      </header>
      <div className="nc-manage-layout">
        <aside className="nc-manage-nav nc-panel">
          <nav aria-label="Manage community">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => props.onNavigate(`${routeTo(c)}/manage/${t.id}`)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <label>
            Manage community
            <select
              value={tab}
              onChange={(e) =>
                props.onNavigate(`${routeTo(c)}/manage/${e.target.value}`)
              }
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            Community owner<strong>{c.company.name}</strong>
          </p>
        </aside>
        <main className="nc-manage-content">
          {tab === "settings" ? (
            <CommunityEditor {...props} embedded />
          ) : tab === "topics" ? (
            <TopicEditor {...props} />
          ) : tab === "posts" ? (
            <ModerationPanel {...props} />
          ) : (
            <MembersPanel {...props} />
          )}
        </main>
      </div>
    </div>
  );
}
function MembersPanel(props: CommunityProps & { community: Community }) {
  const c = props.community,
    { toast, session } = useApp();
  const [members, setMembers] = useState<CommunityMember[]>([]),
    [requests, setRequests] = useState<CommunityMember[]>([]),
    [invitations, setInvitations] = useState<CommunityInvitation[]>([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null),
    [requestCursor, setRequestCursor] = useState<string | null>(null),
    [inviteCursor, setInviteCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [attempt, setAttempt] = useState(0),
    [removeId, setRemoveId] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<CommunityInvitation["role"]>("member"),
    [inviteUrl, setInviteUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      networkApi<CommunityList<CommunityMember>>(
        `/communities/${c.id}/members?status=joined&limit=30`,
        { signal: controller.signal },
      ),
      networkApi<CommunityList<CommunityMember>>(
        `/communities/${c.id}/members?status=pending&limit=30`,
        { signal: controller.signal },
      ),
      c.can_manage
        ? networkApi<CommunityList<CommunityInvitation>>(
            `/communities/${c.id}/invitations?limit=30`,
            { signal: controller.signal },
          )
        : Promise.resolve({ items: [], next_cursor: null }),
    ])
      .then(([m, r, i]) => {
        setMembers(m.items);
        setMemberCursor(m.next_cursor || null);
        setRequests(r.items);
        setRequestCursor(r.next_cursor || null);
        setInvitations(i.items);
        setInviteCursor(i.next_cursor || null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(communityError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [c.id, c.can_manage, props.revision, attempt]);
  async function memberAction(
    member: CommunityMember,
    action: string,
    nextRole?: string,
  ) {
    setBusy(member.user_id);
    setError("");
    try {
      await networkPost(`/communities/${c.id}/members/${member.user_id}`, {
        action,
        ...(nextRole ? { role: nextRole } : {}),
      });
      setRemoveId("");
      toast(
        action === "approve"
          ? `${member.name} is now a member.`
          : action === "reject"
            ? "Join request declined."
            : action === "remove"
              ? "Member removed."
              : "Role updated.",
      );
      props.onRefresh();
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  async function loadMore(kind: "members" | "requests" | "invitations") {
    const cursor =
      kind === "members"
        ? memberCursor
        : kind === "requests"
          ? requestCursor
          : inviteCursor;
    if (!cursor) return;
    setBusy(kind);
    setError("");
    try {
      if (kind === "invitations") {
        const r = await networkApi<CommunityList<CommunityInvitation>>(
          `/communities/${c.id}/invitations?cursor=${encodeURIComponent(cursor)}&limit=30`,
        );
        setInvitations((prev) => [...prev, ...r.items]);
        setInviteCursor(r.next_cursor || null);
      } else {
        const r = await networkApi<CommunityList<CommunityMember>>(
          `/communities/${c.id}/members?status=${kind === "members" ? "joined" : "pending"}&cursor=${encodeURIComponent(cursor)}&limit=30`,
        );
        if (kind === "members") {
          setMembers((prev) => [...prev, ...r.items]);
          setMemberCursor(r.next_cursor || null);
        } else {
          setRequests((prev) => [...prev, ...r.items]);
          setRequestCursor(r.next_cursor || null);
        }
      }
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  async function createInvitation(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy("invite");
    setError("");
    setInviteUrl("");
    try {
      const r = await networkPost<{
        invitation: CommunityInvitation;
        invite_url: string;
      }>(`/communities/${c.id}/invitations`, { email: email.trim(), role });
      setInviteUrl(new URL(r.invite_url, window.location.origin).href);
      setInvitations((prev) => [
        r.invitation,
        ...prev.filter((i) => i.id !== r.invitation.id),
      ]);
      setEmail("");
      toast("Invitation link created. Share it with the invited person.");
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  async function invitationAction(
    invite: CommunityInvitation,
    action: "renew" | "revoke",
  ) {
    setBusy(invite.id);
    setError("");
    try {
      const r = await networkPost<{
        invitation: CommunityInvitation;
        invite_url?: string;
      }>(`/communities/${c.id}/invitations/${invite.id}`, { action });
      setInvitations((prev) =>
        prev.map((i) => (i.id === invite.id ? r.invitation : i)),
      );
      if (r.invite_url)
        setInviteUrl(new URL(r.invite_url, window.location.origin).href);
      else setInviteUrl("");
      toast(
        action === "renew"
          ? "A new invitation link is ready. The previous link no longer works."
          : "Invitation cancelled.",
      );
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast("Invitation link copied.");
    } catch {
      setError("Copy the invitation link from the field below.");
    }
  }
  if (loading) return <BusyState label="Loading members and requests…" />;
  const lastAdmin =
    !memberCursor && members.filter((m) => m.role === "admin").length === 1
      ? members.find((m) => m.role === "admin")?.user_id
      : undefined;
  return (
    <div className="nc-management-panels">
      <ErrorLine>{error}</ErrorLine>
      {error && !members.length && !requests.length && (
        <button className="nc-btn" onClick={() => setAttempt((x) => x + 1)}>
          Try again
        </button>
      )}
      <section className="nc-panel nc-management-panel">
        <header className="nc-section-heading">
          <div>
            <h2>Join requests</h2>
            <p>
              {requests.length
                ? "Review who wants to join the conversation."
                : "You’re up to date. New requests will appear here."}
            </p>
          </div>
          <span className="nc-count">
            {requests.length}
            {requestCursor ? "+" : ""}
          </span>
        </header>
        {requests.map((m) => (
          <article className="nc-member-row nc-request" key={m.user_id}>
            <div className="nc-person">
              <span className="nc-person-initials">
                {m.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{m.name}</strong>
                <small>{m.company_name || m.email || "Colabb member"}</small>
              </div>
            </div>
            <small>Requested {communityDate(m.created_at)}</small>
            <div className="nc-actions">
              <button
                className="nc-btn nc-primary"
                disabled={!!busy}
                onClick={() => memberAction(m, "approve")}
              >
                Approve
              </button>
              <button
                className="nc-btn"
                disabled={!!busy}
                onClick={() => memberAction(m, "reject")}
              >
                Decline
              </button>
            </div>
          </article>
        ))}
        {requestCursor && (
          <button
            className="nc-btn"
            disabled={!!busy}
            onClick={() => loadMore("requests")}
          >
            More requests
          </button>
        )}
      </section>
      <section className="nc-panel nc-management-panel">
        <header className="nc-section-heading">
          <div>
            <h2>Members</h2>
            <p>Keep the right people involved.</p>
          </div>
          {c.can_manage && (
            <button
              className="nc-btn"
              onClick={() => setInviteOpen(!inviteOpen)}
            >
              <Plus size={16} />
              Invite someone
            </button>
          )}
        </header>
        {c.can_manage && inviteOpen && (
          <form className="nc-invite-form" onSubmit={createInvitation}>
            <h3>Create an invitation link</h3>
            <p>
              Only the person with this verified email can accept. Share the
              link with them directly.
            </p>
            <div className="nc-field-grid">
              <label className="nc-field">
                <span>Work email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </label>
              <label className="nc-field">
                <span>Community role</span>
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as CommunityInvitation["role"])
                  }
                >
                  <option value="member">Member</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <button
              className="nc-btn nc-primary"
              disabled={!!busy}
              type="submit"
            >
              {busy === "invite" ? "Creating…" : "Create invitation link"}
            </button>
          </form>
        )}
        {inviteUrl && (
          <div className="nc-invite-link" role="status">
            <strong>Invitation link ready</strong>
            <p>
              This link is tied to the invited email. An email has not been
              sent.
            </p>
            <div>
              <input
                aria-label="Invitation link"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="nc-btn" onClick={copyInvite}>
                Copy link
              </button>
            </div>
          </div>
        )}
        <div className="nc-members-labels">
          <span>Person</span>
          <span>Company</span>
          <span>Access</span>
        </div>
        {members.map((m) => (
          <div className="nc-member-block" key={m.user_id}>
            <div className="nc-member-row">
              <div className="nc-person">
                <span className="nc-person-initials">
                  {m.name
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <strong>
                    {m.name}
                    {m.user_id === session.user?.id ? " (you)" : ""}
                  </strong>
                  {m.email && <small>{m.email}</small>}
                </div>
              </div>
              <span className="nc-member-company">{m.company_name || "—"}</span>
              <div className="nc-member-role">
                {c.can_manage ? (
                  <>
                    <label className="nc-sr-only" htmlFor={`role-${m.user_id}`}>
                      Role for {m.name}
                    </label>
                    <select
                      id={`role-${m.user_id}`}
                      disabled={!!busy || lastAdmin === m.user_id}
                      title={
                        lastAdmin === m.user_id
                          ? "Add another admin before changing the last admin’s role."
                          : undefined
                      }
                      value={m.role}
                      onChange={(e) => memberAction(m, "role", e.target.value)}
                    >
                      <option value="member">Member</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className="nc-text-btn"
                      disabled={!!busy || lastAdmin === m.user_id}
                      title={
                        lastAdmin === m.user_id
                          ? "Add another admin before removing the last admin."
                          : undefined
                      }
                      onClick={() => setRemoveId(m.user_id)}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="nc-role-label">{m.role}</span>
                )}
              </div>
            </div>
            {removeId === m.user_id && (
              <div className="nc-confirm">
                <strong>
                  Remove {m.name} from {c.name}?
                </strong>
                <p>
                  They won’t be able to participate.
                  {c.visibility === "private"
                    ? " Private discussions and files will no longer be accessible to them."
                    : " Public discussions will remain visible."}
                </p>
                <div className="nc-actions">
                  <button
                    className="nc-btn"
                    disabled={!!busy}
                    onClick={() => memberAction(m, "remove")}
                  >
                    Remove member
                  </button>
                  <button
                    className="nc-text-btn"
                    disabled={!!busy}
                    onClick={() => setRemoveId("")}
                  >
                    Keep member
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {memberCursor && (
          <button
            className="nc-btn"
            disabled={!!busy}
            onClick={() => loadMore("members")}
          >
            More members
          </button>
        )}
        <p className="nc-help">
          Admins manage settings, roles and moderation. Moderators review join
          requests and posts. The last admin cannot be removed.
        </p>
      </section>
      {c.can_manage && (
        <section className="nc-panel nc-management-panel">
          <header className="nc-section-heading">
            <div>
              <h2>Invitations</h2>
              <p>Track shared links and manage access.</p>
            </div>
          </header>
          {!invitations.length ? (
            <p className="nc-muted">No invitations yet.</p>
          ) : (
            invitations.map((i) => {
              const expired =
                i.status === "pending" && Date.parse(i.expires_at) < Date.now();
              const final = ["accepted", "declined"].includes(i.status);
              return (
                <div className="nc-invitation-row" key={i.id}>
                  <div>
                    <strong>{i.email}</strong>
                    <small>
                      {i.role} · {expired ? "Expired" : i.status} ·{" "}
                      {expired ? "Expired" : "Expires"}{" "}
                      {communityDate(i.expires_at)}
                    </small>
                  </div>
                  {!final && (
                    <div className="nc-actions">
                      <button
                        className="nc-btn"
                        disabled={!!busy}
                        onClick={() => invitationAction(i, "renew")}
                      >
                        Renew link
                      </button>
                      {i.status === "pending" && !expired && (
                        <button
                          className="nc-text-btn"
                          disabled={!!busy}
                          onClick={() => invitationAction(i, "revoke")}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {inviteCursor && (
            <button
              className="nc-btn"
              disabled={!!busy}
              onClick={() => loadMore("invitations")}
            >
              More invitations
            </button>
          )}
        </section>
      )}
    </div>
  );
}
function TopicEditor(props: CommunityProps & { community: Community }) {
  const c = props.community,
    { toast } = useApp();
  const [topics, setTopics] = useState<CommunityTopic[]>(() =>
    structuredClone(c.topics),
  );
  const [selected, setSelected] = useState(c.topics[0]?.id || "");
  const [required, setRequired] = useState(c.require_topic);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const topic = topics.find((t) => t.id === selected);
  const change = (next: CommunityTopic[]) => {
    setTopics(next);
    setDirty(true);
    setError("");
  };
  function updateTopic(next: Partial<CommunityTopic>) {
    change(topics.map((t) => (t.id === selected ? { ...t, ...next } : t)));
  }
  function updateField(id: string, next: Partial<CommunityField>) {
    if (!topic) return;
    updateTopic({
      fields: topic.fields.map((f) => (f.id === id ? { ...f, ...next } : f)),
    });
  }
  function addTopic() {
    const next = { id: crypto.randomUUID(), label: "", fields: [] };
    change([...topics, next]);
    setSelected(next.id);
    setConfirmRemove(false);
  }
  function moveField(index: number, direction: number) {
    if (!topic) return;
    const fields = [...topic.fields],
      target = index + direction;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    updateTopic({ fields });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (busy) return;
    if (required && !topics.length) {
      setError(
        "Add at least one topic, or turn off the required topic option.",
      );
      return;
    }
    const topicLabels = new Set<string>();
    for (const t of topics) {
      if (!t.label.trim() || topicLabels.has(t.label.trim().toLowerCase())) {
        setSelected(t.id);
        setError("Give each topic a different name.");
        return;
      }
      topicLabels.add(t.label.trim().toLowerCase());
      const labels = new Set<string>();
      for (const f of t.fields) {
        if (!f.label.trim() || labels.has(f.label.trim().toLowerCase())) {
          setSelected(t.id);
          setError(`Give each field in ${t.label} a different label.`);
          return;
        }
        labels.add(f.label.trim().toLowerCase());
        if (f.type === "select") {
          const options = (f.options || [])
            .map((s) => s.trim())
            .filter(Boolean);
          if (
            options.length < 2 ||
            new Set(options.map((s) => s.toLowerCase())).size !== options.length
          ) {
            setSelected(t.id);
            setError(`Add at least two different options for “${f.label}”.`);
            return;
          }
        }
        if (
          f.type === "number" &&
          f.step !== undefined &&
          (!Number.isFinite(f.step) || f.step <= 0)
        ) {
          setSelected(t.id);
          setError(`Use a positive increment for “${f.label}”.`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      await networkPatch(`/communities/${c.id}`, {
        version: c.version,
        require_topic: required,
        topics: topics.map((t) => ({
          ...t,
          label: t.label.trim(),
          fields: t.fields.map((f) => ({
            ...f,
            label: f.label.trim(),
            options:
              f.type === "select"
                ? (f.options || []).map((o) => o.trim()).filter(Boolean)
                : [],
            unit: f.type === "number" ? (f.unit || "").trim() : "",
          })),
        })),
      });
      setDirty(false);
      props.onRefresh();
      toast("Topics and post fields saved.");
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setTopics(structuredClone(c.topics));
    setSelected(c.topics[0]?.id || "");
    setRequired(c.require_topic);
    setDirty(false);
    setError("");
    setConfirmRemove(false);
  }
  return (
    <form className="nc-topic-editor" onSubmit={save}>
      <header className="nc-section-heading">
        <div>
          <h2>Topics & post fields</h2>
          <p>Ask for details that help members give useful answers.</p>
        </div>
        <span className="nc-save-status">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </header>
      <ErrorLine>{error}</ErrorLine>
      <div className="nc-topic-layout">
        <section className="nc-panel nc-form-panel">
          <div className="nc-topic-select">
            <label className="nc-field">
              <span>Topic</span>
              <select
                value={selected}
                disabled={!topics.length}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setConfirmRemove(false);
                }}
              >
                {!topics.length && <option value="">No topics yet</option>}
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label || "Untitled topic"}
                  </option>
                ))}
              </select>
            </label>
            <button className="nc-btn" type="button" onClick={addTopic}>
              <Plus size={16} />
              Add topic
            </button>
          </div>
          <label className="nc-checkbox nc-topic-policy">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => {
                setRequired(e.target.checked);
                setDirty(true);
              }}
            />
            <span>Require a topic for new posts</span>
          </label>
          {topic ? (
            <>
              <div className="nc-topic-name">
                <label className="nc-field">
                  <span>Topic name</span>
                  <input
                    required
                    maxLength={60}
                    value={topic.label}
                    onChange={(e) => updateTopic({ label: e.target.value })}
                    placeholder="e.g. Modules"
                  />
                </label>
                <button
                  className="nc-icon-btn"
                  type="button"
                  aria-label="Remove this topic"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              {confirmRemove && (
                <div className="nc-confirm">
                  <strong>Remove {topic.label || "this topic"}?</strong>
                  <p>
                    Existing posts will retain their original topic and answers.
                  </p>
                  <div className="nc-actions">
                    <button
                      type="button"
                      className="nc-btn"
                      onClick={() => {
                        const next = topics.filter((t) => t.id !== selected);
                        change(next);
                        setSelected(next[0]?.id || "");
                        setConfirmRemove(false);
                      }}
                    >
                      Remove topic
                    </button>
                    <button
                      type="button"
                      className="nc-text-btn"
                      onClick={() => setConfirmRemove(false)}
                    >
                      Keep topic
                    </button>
                  </div>
                </div>
              )}
              <div className="nc-section-heading nc-fields-heading">
                <h3>Post fields</h3>
                <small>
                  {topic.fields.length}{" "}
                  {topic.fields.length === 1 ? "field" : "fields"}
                </small>
              </div>
              {topic.fields.map((f, i) => (
                <section className="nc-field-card" key={f.id}>
                  <header>
                    <strong>Field {i + 1}</strong>
                    <div className="nc-actions">
                      <button
                        type="button"
                        className="nc-icon-btn"
                        aria-label={`Move ${f.label || "field"} up`}
                        disabled={i === 0}
                        onClick={() => moveField(i, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="nc-icon-btn"
                        aria-label={`Move ${f.label || "field"} down`}
                        disabled={i === topic.fields.length - 1}
                        onClick={() => moveField(i, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        className="nc-icon-btn"
                        aria-label={`Remove ${f.label || "field"}`}
                        onClick={() =>
                          updateTopic({
                            fields: topic.fields.filter((x) => x.id !== f.id),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </header>
                  <label className="nc-field">
                    <span>Field label</span>
                    <input
                      required
                      maxLength={100}
                      value={f.label}
                      onChange={(e) =>
                        updateField(f.id, { label: e.target.value })
                      }
                      placeholder="e.g. Quantity needed"
                    />
                  </label>
                  <div className="nc-field-grid">
                    <label className="nc-field">
                      <span>Answer type</span>
                      <select
                        value={f.type}
                        onChange={(e) =>
                          updateField(f.id, {
                            type: e.target.value as CommunityField["type"],
                          })
                        }
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="select">Choose an option</option>
                      </select>
                    </label>
                    {f.type === "number" ? (
                      <label className="nc-field">
                        <span>
                          Unit <small>Optional</small>
                        </span>
                        <input
                          maxLength={24}
                          value={f.unit || ""}
                          onChange={(e) =>
                            updateField(f.id, { unit: e.target.value })
                          }
                          placeholder="e.g. modules, kW"
                        />
                      </label>
                    ) : f.type !== "date" ? (
                      <label className="nc-field">
                        <span>
                          Example answer <small>Optional</small>
                        </span>
                        <input
                          maxLength={100}
                          value={f.placeholder || ""}
                          onChange={(e) =>
                            updateField(f.id, { placeholder: e.target.value })
                          }
                          placeholder="e.g. Cleveland, OH"
                        />
                      </label>
                    ) : null}
                  </div>
                  {f.type === "number" && (
                    <div className="nc-field-grid">
                      <label className="nc-field">
                        <span>
                          Minimum <small>Optional</small>
                        </span>
                        <input
                          type="number"
                          step="any"
                          value={f.min ?? ""}
                          onChange={(e) =>
                            updateField(f.id, {
                              min:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="nc-field">
                        <span>
                          Increment <small>Optional</small>
                        </span>
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={f.step ?? ""}
                          onChange={(e) =>
                            updateField(f.id, {
                              step:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            })
                          }
                          placeholder="e.g. 1"
                        />
                      </label>
                    </div>
                  )}
                  {f.type === "select" && (
                    <label className="nc-field">
                      <span>Options</span>
                      <textarea
                        rows={4}
                        maxLength={2000}
                        value={(f.options || []).join("\n")}
                        onChange={(e) =>
                          updateField(f.id, {
                            options: e.target.value.split("\n"),
                          })
                        }
                        placeholder={"Monofacial\nBifacial"}
                      />
                      <small>
                        One option per line. Add at least two different options.
                      </small>
                    </label>
                  )}
                  <label className="nc-checkbox">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) =>
                        updateField(f.id, { required: e.target.checked })
                      }
                    />
                    <span>Require an answer</span>
                  </label>
                </section>
              ))}
              {!topic.fields.length && (
                <p className="nc-muted">
                  Members can post a title, message and attachments. Add a field
                  when extra details will help.
                </p>
              )}
              <button
                type="button"
                className="nc-btn nc-add-field"
                onClick={() =>
                  updateTopic({
                    fields: [
                      ...topic.fields,
                      {
                        id: crypto.randomUUID(),
                        label: "",
                        type: "text",
                        required: false,
                        options: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={16} />
                Add a field
              </button>
            </>
          ) : (
            <EmptyState
              title="Start with a topic."
              action={
                <button type="button" className="nc-btn" onClick={addTopic}>
                  Add your first topic
                </button>
              }
            >
              Group related discussions, then choose the details people should
              include.
            </EmptyState>
          )}
        </section>
        <aside className="nc-panel nc-topic-preview">
          <span className="nc-eyebrow">Member form preview</span>
          <h3>{topic?.label || "Your topic"}</h3>
          <p>This is what people will fill out when posting.</p>
          {topic?.fields.map((f) => (
            <label className="nc-field" key={f.id}>
              <span>
                {f.label || "Untitled field"}
                <small>{f.required ? "Required" : "Optional"}</small>
              </span>
              {f.type === "select" ? (
                <select disabled>
                  <option>{f.placeholder || "Choose an option"}</option>
                  {f.options?.filter(Boolean).map((o, i) => (
                    <option key={i}>{o}</option>
                  ))}
                </select>
              ) : (
                <div className="nc-input-unit">
                  <input
                    disabled
                    type={
                      f.type === "date"
                        ? "date"
                        : f.type === "number"
                          ? "number"
                          : "text"
                    }
                    placeholder={
                      f.placeholder ||
                      (f.type === "number" ? "0" : "Your answer")
                    }
                  />
                  {f.type === "number" && f.unit && <span>{f.unit}</span>}
                </div>
              )}
            </label>
          ))}
          {!topic?.fields.length && (
            <p className="nc-quiet-box">No extra details requested.</p>
          )}
        </aside>
      </div>
      <footer className="nc-topic-save">
        <p>
          Changes apply to new posts. Published posts keep their original
          details.
        </p>
        <div className="nc-actions">
          <button
            className="nc-btn"
            type="button"
            disabled={!dirty || busy}
            onClick={reset}
          >
            Discard changes
          </button>
          <button
            className="nc-btn nc-primary"
            type="submit"
            disabled={!dirty || busy}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </footer>
    </form>
  );
}
function ModerationPanel(props: CommunityProps & { community: Community }) {
  const c = props.community,
    { toast } = useApp();
  const [tab, setTab] = useState<"posts" | "open" | "resolved">("open");
  const [reports, setReports] = useState<CommunityReport[]>([]),
    [posts, setPosts] = useState<
      (CommunityPost & { pinned?: boolean; comments_open?: boolean })[]
    >([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState("");
  const [decision, setDecision] = useState<{
    id: string;
    decision: "keep" | "remove";
    post: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const path =
    tab === "posts"
      ? `/posts?community_id=${c.id}&limit=30`
      : `/communities/${c.id}/reports?status=${tab}&limit=30`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDecision(null);
    networkApi<CommunityList<CommunityReport & CommunityPost>>(path, {
      signal: controller.signal,
    })
      .then((r) => {
        if (tab === "posts") setPosts(r.items);
        else setReports(r.items);
        setCursor(r.next_cursor || null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(communityError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, tab, props.revision, attempt]);
  async function loadMore() {
    if (!cursor) return;
    setBusy("more");
    try {
      const r = await networkApi<
        CommunityList<CommunityReport & CommunityPost>
      >(`${path}&cursor=${encodeURIComponent(cursor)}`);
      if (tab === "posts") setPosts((prev) => [...prev, ...r.items]);
      else setReports((prev) => [...prev, ...r.items]);
      setCursor(r.next_cursor || null);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  async function postState(id: string, action: string, value: boolean) {
    setBusy(id);
    setError("");
    try {
      await networkPost(`/posts/${id}/state`, { action, value });
      setAttempt((x) => x + 1);
      toast(
        action === "pin"
          ? value
            ? "Post pinned."
            : "Post unpinned."
          : value
            ? "Replies reopened."
            : "Replies closed.",
      );
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  async function resolve(e: FormEvent) {
    e.preventDefault();
    if (!decision || busy) return;
    if (reason.trim().length < 5) {
      setError("Add a short reason for the decision (at least 5 characters).");
      return;
    }
    setBusy(decision.id);
    setError("");
    try {
      if (decision.post)
        await networkPost(`/posts/${decision.id}/state`, {
          action: "moderate",
          value: "remove",
          reason: reason.trim(),
        });
      else
        await networkPost(`/reports/${decision.id}/resolve`, {
          decision: decision.decision,
          reason: reason.trim(),
        });
      setDecision(null);
      setReason("");
      setAttempt((x) => x + 1);
      props.onRefresh();
      toast(
        decision.decision === "remove"
          ? "Post removed. The decision is saved in moderation history."
          : "Report resolved. The post remains visible.",
      );
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy("");
    }
  }
  const decisionForm = (id: string, isPost: boolean) =>
    decision?.id === id && decision.post === isPost ? (
      <form className="nc-decision-form" onSubmit={resolve}>
        <h3>
          {decision.decision === "remove"
            ? "Remove this post?"
            : "Keep this post?"}
        </h3>
        <p>
          {decision.decision === "remove"
            ? "It will no longer appear in the community. Its record is retained for moderation review."
            : "The report will be resolved and the post will remain visible."}
        </p>
        <label className="nc-field">
          <span>Reason for this decision</span>
          <textarea
            required
            minLength={5}
            maxLength={1000}
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain the relevant community rule or what you found."
          />
        </label>
        <div className="nc-actions">
          <button className="nc-btn nc-primary" type="submit" disabled={!!busy}>
            {busy
              ? "Saving…"
              : decision.decision === "remove"
                ? "Remove post"
                : "Keep post & resolve"}
          </button>
          <button
            className="nc-btn"
            type="button"
            disabled={!!busy}
            onClick={() => setDecision(null)}
          >
            Cancel
          </button>
        </div>
      </form>
    ) : null;
  return (
    <section className="nc-panel nc-management-panel">
      <header className="nc-section-heading">
        <div>
          <h2>Posts & reports</h2>
          <p>Keep this space useful, respectful and on topic.</p>
        </div>
        <ShieldCheck size={23} />
      </header>
      <nav className="nc-local-tabs" aria-label="Moderation views">
        {(
          [
            { id: "posts", name: "All posts" },
            { id: "open", name: "Reports" },
            { id: "resolved", name: "History" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </nav>
      <ErrorLine>{error}</ErrorLine>
      {loading ? (
        <BusyState label="Loading moderation activity…" />
      ) : error && !(tab === "posts" ? posts : reports).length ? (
        <button className="nc-btn" onClick={() => setAttempt((x) => x + 1)}>
          Try again
        </button>
      ) : tab === "posts" ? (
        !posts.length ? (
          <EmptyState title="No posts yet.">
            New discussions will appear here.
          </EmptyState>
        ) : (
          posts.map((p) => (
            <article className="nc-moderation-row" key={p.id}>
              <h3>
                <button onClick={() => props.onPost(p.id)}>
                  {p.title || p.body.split("\n")[0]}
                </button>
              </h3>
              <small>
                {p.author.name} · {p.company.name} ·{" "}
                {communityDate(p.created_at)}
              </small>
              <p className="nc-moderation-excerpt">{p.body}</p>
              <div className="nc-actions">
                <button
                  className="nc-btn"
                  disabled={!!busy}
                  onClick={() => postState(p.id, "pin", !p.pinned)}
                >
                  {p.pinned ? "Unpin post" : "Pin post"}
                </button>
                <button
                  className="nc-btn"
                  disabled={!!busy}
                  onClick={() =>
                    postState(p.id, "comments", p.comments_open === false)
                  }
                >
                  {p.comments_open === false
                    ? "Reopen replies"
                    : "Close replies"}
                </button>
                <button
                  className="nc-text-btn"
                  disabled={!!busy}
                  onClick={() => {
                    setDecision({ id: p.id, decision: "remove", post: true });
                    setReason("");
                  }}
                >
                  Remove post
                </button>
              </div>
              {decisionForm(p.id, true)}
            </article>
          ))
        )
      ) : !reports.length ? (
        <EmptyState
          title={tab === "open" ? "No reports to review." : "No decisions yet."}
        >
          {tab === "open"
            ? "Reports from community members will appear here."
            : "Moderation decisions and reasons will be saved here."}
        </EmptyState>
      ) : (
        reports.map((r) => (
          <article className="nc-moderation-row" key={r.id}>
            <div className="nc-inline-head">
              <h3>
                <button onClick={() => props.onPost(r.post_id)}>
                  {r.post_title || "Reported post"}
                </button>
              </h3>
              <span className="nc-chip">
                {r.status === "open" ? "Needs review" : r.status}
              </span>
            </div>
            <small>
              {r.reporter_name ? `Reported by ${r.reporter_name} · ` : ""}
              {communityDate(r.created_at)}
            </small>
            <dl className="nc-report-details">
              <div>
                <dt>Reason</dt>
                <dd>{r.reason}</dd>
              </div>
              {r.details && (
                <div>
                  <dt>Details</dt>
                  <dd>{r.details}</dd>
                </div>
              )}
              {r.resolution_reason && (
                <div>
                  <dt>Decision</dt>
                  <dd>
                    {r.resolution_reason}
                    <small>{communityDate(r.resolved_at)}</small>
                  </dd>
                </div>
              )}
            </dl>
            {tab === "open" && (
              <div className="nc-actions">
                <button
                  className="nc-btn"
                  onClick={() => props.onPost(r.post_id)}
                >
                  View post <ArrowRight size={15} />
                </button>
                <button
                  className="nc-btn"
                  disabled={!!busy}
                  onClick={() => {
                    setDecision({ id: r.id, decision: "keep", post: false });
                    setReason("");
                  }}
                >
                  Keep post
                </button>
                <button
                  className="nc-text-btn"
                  disabled={!!busy}
                  onClick={() => {
                    setDecision({ id: r.id, decision: "remove", post: false });
                    setReason("");
                  }}
                >
                  Remove post
                </button>
              </div>
            )}
            {decisionForm(r.id, false)}
          </article>
        ))
      )}
      {cursor && (
        <div className="nc-load-more">
          <button className="nc-btn" disabled={!!busy} onClick={loadMore}>
            {busy === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
function InvitationView(props: CommunityProps & { token: string }) {
  const [data, setData] = useState<{
    invitation: CommunityInvitation;
    community: Community;
    can_accept: boolean;
    email_matches: boolean;
  } | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0),
    [completed, setCompleted] = useState("");
  const { session } = useApp();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    networkApi<{
      invitation: CommunityInvitation;
      community: Community;
      can_accept: boolean;
      email_matches: boolean;
    }>(`/invitations/${encodeURIComponent(props.token)}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(communityError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [props.token, session.user?.id, session.activeCompanyId, attempt]);
  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setError("");
    try {
      await networkPost(`/invitations/${encodeURIComponent(props.token)}`, {
        action,
      });
      setCompleted(action);
      props.onRefresh();
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <BusyState label="Checking invitation…" />;
  if (!data)
    return (
      <EmptyState
        title="This invitation couldn’t open."
        action={
          <button className="nc-btn" onClick={() => setAttempt((x) => x + 1)}>
            Try again
          </button>
        }
      >
        {error ||
          "The link may no longer be valid. Ask the community host for a new invitation."}
      </EmptyState>
    );
  const c = data.community,
    invitation = data.invitation,
    expired = Date.parse(invitation.expires_at) < Date.now();
  return (
    <div className="nc-invitation-page">
      <button
        className="nc-back"
        onClick={() => props.onNavigate("/communities")}
      >
        <ArrowLeft size={17} />
        Communities
      </button>
      <section className="nc-panel nc-invitation-card">
        <div className="nc-host">
          <CompanyMark company={c.company} size={54} />
          <div>
            <span className="nc-eyebrow">Community invitation</span>
            <CompanyLink company={c.company} />
          </div>
        </div>
        <h1>
          {completed === "accept" ||
          (data.email_matches && invitation.status === "accepted")
            ? `Welcome to ${c.name}.`
            : completed === "decline" || invitation.status === "declined"
              ? "Invitation declined."
              : `You’re invited to ${c.name}.`}
        </h1>
        <p>{c.description}</p>
        <AccessLabel community={c} />
        {completed === "accept" ||
        (data.email_matches && invitation.status === "accepted") ? (
          <>
            <p>You can now take part in community discussions.</p>
            <button
              className="nc-btn nc-primary"
              onClick={() => props.onNavigate(routeTo(c))}
            >
              Open community
              <ArrowRight size={16} />
            </button>
          </>
        ) : completed === "decline" || invitation.status === "declined" ? (
          <>
            <p>
              No membership was added. You can ask the host for a new invitation
              later.
            </p>
            <button
              className="nc-btn"
              onClick={() => props.onNavigate("/communities")}
            >
              Discover communities
            </button>
          </>
        ) : (
          <>
            <dl className="nc-invitation-facts">
              <div>
                <dt>Your role</dt>
                <dd>{invitation.role}</dd>
              </div>
              {invitation.email && (
                <div>
                  <dt>Invited email</dt>
                  <dd>{invitation.email}</dd>
                </div>
              )}
              <div>
                <dt>Expires</dt>
                <dd>{communityDate(invitation.expires_at)}</dd>
              </div>
            </dl>
            {!!c.rules.length && (
              <details className="nc-rules">
                <summary>
                  <span>
                    <FileText size={16} />
                    Community rules
                  </span>
                  <ChevronDown size={16} />
                </summary>
                <ol>
                  {c.rules.map((r, i) => (
                    <li key={i}>
                      <strong>{r.title}</strong>
                      <p>{r.body}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <ErrorLine>{error}</ErrorLine>
            {data.can_accept && data.email_matches ? (
              <>
                <p className="nc-help">
                  You’ll join as {session.user?.name}. Your colleagues can join
                  separately.
                </p>
                <div className="nc-actions">
                  <button
                    className="nc-btn nc-primary"
                    disabled={busy}
                    onClick={() => respond("accept")}
                  >
                    {busy ? "Please wait…" : "Accept invitation"}
                  </button>
                  <button
                    className="nc-btn"
                    disabled={busy}
                    onClick={() => respond("decline")}
                  >
                    Decline
                  </button>
                </div>
              </>
            ) : (
              <div className="nc-quiet-box">
                <strong>
                  {!data.email_matches
                    ? "This invitation is for a different email."
                    : expired
                      ? "This invitation has expired."
                      : invitation.status !== "pending"
                        ? "This invitation is no longer available."
                        : "Verify your email to accept."}
                </strong>
                <p>
                  {!data.email_matches
                    ? "Sign in with the email the host invited. This won’t change your current account."
                    : expired || invitation.status !== "pending"
                      ? "Ask the community host to create a new invitation link."
                      : "Open your account settings and verify your email, then return to this link."}
                </p>
                {!data.email_matches ? (
                  <Link className="nc-btn" to={`/account`}>
                    View account
                  </Link>
                ) : !expired && invitation.status === "pending" ? (
                  <Link className="nc-btn" to="/account">
                    Account settings
                  </Link>
                ) : null}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
