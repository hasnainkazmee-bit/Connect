import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Bookmark,
  Building2,
  Check,
  Compass,
  FilePenLine,
  Flag,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react";
import { useApp } from "../context";
import { CompanyMessageLink } from "../company-message-link";
import { api } from "../api";
import {
  CompanyLogo,
  NetworkState,
  companyPath,
  useNetworkResource,
} from "./common";
import { networkPost, networkError } from "./client";
import { NetworkFeed, CompanySuggestions, type PostActions } from "./feed";
import { NetworkComposer } from "./composer";
import { PostDetail } from "./post-detail";
import { NetworkDrafts } from "./drafts";
import { NetworkNotifications } from "./notifications";
import { NetworkFileViewer } from "./media";
import { PostLifecycle, SourcingJobDraft, PlatformReports } from "./lifecycle";
import {
  CommunityMain,
  CommunityAside,
  communityIsTask,
  type CommunityProps,
} from "./communities";
import type {
  NetworkAttachment,
  NetworkBootstrap,
  NetworkCompany,
} from "./types";
import "./styles.css";

export function NetworkPage() {
  const { session, signIn } = useApp(),
    location = useLocation(),
    navigate = useNavigate(),
    [params] = useSearchParams(),
    [revision, setRevision] = useState(0);
  const bootstrap = useNetworkResource<NetworkBootstrap>(
      session.user ? "/bootstrap" : null,
      session.activeCompanyId || "",
    ),
    path = location.pathname.replace(/^\/network/, "") || "/";
  const content = useRef<HTMLDivElement>(null),
    scrolls = useRef(new Map<string, number>()),
    [companyContext, setCompanyContext] = useState<NetworkCompany | null>(null);
  useEffect(() => {
    document.body.classList.add("nw-enabled");
    const header = document.querySelector(".jobs-site-header");
    const measure = () =>
      document.documentElement.style.setProperty(
        "--nw-header-height",
        `${header?.getBoundingClientRect().height || 88}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    return () => {
      document.body.classList.remove("nw-enabled");
      observer.disconnect();
    };
  }, []);
  function remember() {
    if (content.current) scrolls.current.set(path, content.current.scrollTop);
  }
  function go(suffix: string, replace = false) {
    remember();
    navigate(
      suffix.startsWith("/network")
        ? suffix
        : `/network${suffix === "/" ? "" : suffix}`,
      {
        replace,
        state: { networkOrigin: location.pathname + location.search },
      },
    );
  }
  function back() {
    if (location.state?.networkOrigin) {
      remember();
      navigate(-1);
    } else go("/");
  }
  const refresh = () => {
      setRevision((n) => n + 1);
      bootstrap.retry();
    },
    sidebarRefresh = () => bootstrap.retry();
  const onCompose = ({
    communityId,
    topicId,
  }: { communityId?: string; topicId?: string } = {}) => {
    const q = new URLSearchParams({
      ...(communityId ? { community_id: communityId } : {}),
      ...(topicId ? { topic_id: topicId } : {}),
    });
    go(`/compose/${crypto.randomUUID()}${q.size ? `?${q}` : ""}`);
  };
  const onFile = (file: NetworkAttachment) => {
    remember();
    navigate(
      `/network/files/${file.id}?${new URLSearchParams({ name: file.name, type: file.mime_type })}`,
      { state: { networkFileOrigin: location.pathname + location.search } },
    );
  };
  const actions: PostActions = {
    onNavigate: go,
    onPost: (id) => go(`/posts/${id}`),
    onFile,
    onChanged: refresh,
  };
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const desired = scrolls.current.get(path) || 0;
    let restored = false;
    const restore = () => {
      if (!el || restored) return;
      if (desired === 0 || el.scrollHeight - el.clientHeight >= desired) {
        el.scrollTop = desired;
        restored = true;
      }
    };
    restore();
    const observer = new MutationObserver(restore);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [path, bootstrap.loading]);
  useEffect(() => {
    if (path === "/compose") onCompose();
  }, [path]);
  if (!session.user)
    return (
      <div className="nw-root">
        <div className="nw-task-page nw-small-task">
          <NetworkState title="Your network in solar">
            <p>
              Sign in to follow companies, join communities and share what
              you’re working on.
            </p>
            <button
              className="nw-button nw-primary"
              onClick={() => signIn(location.pathname + location.search)}
            >
              Sign in
              <ArrowRight size={17} />
            </button>
          </NetworkState>
        </div>
      </div>
    );
  if (
    (bootstrap.loading && !bootstrap.data) ||
    (bootstrap.error && !bootstrap.data)
  )
    return (
      <div className="nw-root">
        <div className="nw-task-page">
          <NetworkState
            loading={bootstrap.loading}
            error={bootstrap.error}
            retry={bootstrap.retry}
          />
        </div>
      </div>
    );
  if (!bootstrap.data) return null;
  const data = bootstrap.data,
    parts = path.split("/").filter(Boolean),
    communityArea = parts[0] === "communities" || parts[0] === "invitations",
    task =
      communityIsTask(path) || ["compose", "posts", "files"].includes(parts[0]);
  const communityProps: CommunityProps = {
    path,
    onNavigate: go,
    onCompose,
    onPost: actions.onPost,
    onRefresh: refresh,
    revision,
  };
  let main: ReactNode;
  if (parts[0] === "files") main = <NetworkFileViewer id={parts[1]} />;
  else if (parts[0] === "compose")
    main = (
      <NetworkComposer
        key={parts[1]}
        draftId={parts[1]}
        initialCommunityId={params.get("community_id") || undefined}
        initialTopicId={params.get("topic_id") || undefined}
        bootstrap={data}
        onBack={back}
        onPublished={(id) => {
          refresh();
          go(`/posts/${id}`, true);
        }}
        onDraftChanged={sidebarRefresh}
        onFile={onFile}
      />
    );
  else if (parts[0] === "posts" && parts[2] === "edit")
    main = (
      <NetworkComposer
        key={`edit-${parts[1]}`}
        editId={parts[1]}
        bootstrap={data}
        onBack={back}
        onPublished={(id) => {
          refresh();
          go(`/posts/${id}`, true);
        }}
        onDraftChanged={sidebarRefresh}
        onFile={onFile}
      />
    );
  else if (parts[0] === "posts" && ["delete", "report"].includes(parts[2]))
    main = (
      <PostLifecycle
        id={parts[1]}
        mode={parts[2] as "delete" | "report"}
        onBack={back}
        onDone={() => {
          refresh();
          go("/", true);
        }}
      />
    );
  else if (parts[0] === "posts" && parts[2] === "job-draft")
    main = <SourcingJobDraft id={parts[1]} onBack={back} />;
  else if (parts[0] === "posts")
    main = (
      <PostDetail
        key={parts[1]}
        id={parts[1]}
        actions={actions}
        bootstrap={data}
        onBack={back}
      />
    );
  else if (communityArea) main = <CommunityMain {...communityProps} />;
  else if (parts[0] === "drafts")
    main = (
      <NetworkDrafts
        bootstrap={data}
        onNavigate={go}
        onRefresh={sidebarRefresh}
        revision={revision}
      />
    );
  else if (parts[0] === "notifications")
    main = (
      <NetworkNotifications
        settings={parts[1] === "settings"}
        onNavigate={go}
        onRead={sidebarRefresh}
      />
    );
  else if (parts[0] === "reports" && data.viewer.is_platform_admin)
    main = <PlatformReports onPost={actions.onPost} />;
  else if (parts[0] === "companies" && parts[1])
    main = (
      <CompanyPosts
        key={parts[1]}
        id={parts[1]}
        bootstrap={data}
        revision={revision}
        actions={actions}
        onCompose={() => onCompose()}
        onCompany={setCompanyContext}
      />
    );
  else
    main = (
      <NetworkFeed
        bootstrap={data}
        mode={parts[0] === "saved" ? "saved" : "all"}
        revision={revision}
        actions={actions}
        onCompose={() => onCompose()}
      />
    );
  const navItems = [
    { to: "/", label: "Feed", icon: MessageSquare },
    { to: "/communities", label: "Discover communities", icon: Compass },
    { to: "/saved", label: "Saved posts", icon: Bookmark },
    {
      to: "/drafts",
      label: "Drafts",
      icon: FilePenLine,
      count: data.draft_count,
    },
    {
      to: "/notifications",
      label: "Notifications",
      icon: Bell,
      count: data.unread_count,
    },
  ];
  const active = (to: string) =>
    to === "/"
      ? path === "/"
      : to === "/communities"
        ? path === "/communities"
        : path.startsWith(to);
  const defaultContext = <NetworkContext data={data} go={go} />;
  if (task)
    return (
      <div
        className={`nw-root nw-task-root ${parts[0] === "files" ? "nw-full-file" : ""}`}
      >
        <div className="nw-task-scroll" ref={content}>
          {communityArea ? (
            <div className="nw-task-page">
              <CommunityMain {...communityProps} />
            </div>
          ) : (
            main
          )}
        </div>
      </div>
    );
  const isFeed = path === "/" || parts[0] === "saved";
  return (
    <div className="nw-root">
      <div className={`nw-workspace ${isFeed ? "nw-feed-workspace" : ""}`}>
        <aside className="nw-sidebar nw-panel">
          <h2>Network</h2>
          <nav aria-label="Network">
            {navItems.map(({ to, label, icon: Icon, count }) => (
              <button
                key={to}
                className="nw-side-link"
                aria-current={active(to) ? "page" : undefined}
                onClick={() => go(to)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {!!count && <small>{count}</small>}
              </button>
            ))}
          </nav>
          <div className="nw-side-section">
            <h3>Your communities</h3>
            {data.communities.length ? (
              data.communities.map((c) => (
                <button
                  className="nw-side-link"
                  key={c.id}
                  aria-current={
                    path.startsWith(`/communities/${c.id}`) ? "page" : undefined
                  }
                  onClick={() => go(`/communities/${c.id}`)}
                >
                  <Users size={18} />
                  <span>
                    {c.name}
                    {c.membership?.status === "pending" && (
                      <small>Request pending</small>
                    )}
                  </span>
                </button>
              ))
            ) : (
              <p className="nw-muted">
                Join a community to find your conversations here.
              </p>
            )}
          </div>
          <div className="nw-side-section">
            {data.viewer.can_host && (
              <button
                className="nw-side-link"
                onClick={() => go("/communities/new")}
              >
                <Plus size={18} />
                Create a community
              </button>
            )}
            {data.viewer.company && (
              <Link
                className="nw-side-link"
                to={companyPath(data.viewer.company)}
              >
                <Building2 size={18} />
                Your company profile
              </Link>
            )}
            {data.viewer.is_platform_admin && (
              <button
                className="nw-side-link"
                aria-current={path === "/reports" ? "page" : undefined}
                onClick={() => go("/reports")}
              >
                <Flag size={18} />
                Reported posts
              </button>
            )}
          </div>
        </aside>
        <div className="nw-main">
          <div className="nw-mobile-nav">
            <label className="nw-sr" htmlFor="network-section">
              Network section
            </label>
            <select
              id="network-section"
              value={
                navItems.find((i) => active(i.to))?.to ||
                (data.communities.find((c) =>
                  path.startsWith(`/communities/${c.id}`),
                ) &&
                  `/communities/${data.communities.find((c) => path.startsWith(`/communities/${c.id}`))?.id}`) ||
                "/"
              }
              onChange={(e) => go(e.target.value)}
            >
              {navItems.map((i) => (
                <option key={i.to} value={i.to}>
                  {i.to === "/" ? "Network" : i.label}
                  {i.count ? ` (${i.count})` : ""}
                </option>
              ))}
              {data.communities.map((c) => (
                <option key={c.id} value={`/communities/${c.id}`}>
                  {c.name}
                </option>
              ))}
              {data.viewer.can_host && (
                <option value="/communities/new">Create a community</option>
              )}
            </select>
          </div>
          <div className="nw-columns">
            {isFeed && (
              <aside className="nw-wide-suggestions">
                <CompanySuggestions
                  bootstrap={data}
                  onRefresh={sidebarRefresh}
                />
              </aside>
            )}
            <main
              className="nw-content"
              ref={content}
              tabIndex={-1}
              aria-label="Network content"
            >
              {main}
            </main>
            <aside className="nw-context">
              {communityArea ? (
                <CommunityAside {...communityProps} />
              ) : parts[0] === "companies" && companyContext ? (
                <CompanyContext company={companyContext} />
              ) : (
                <>
                  {isFeed && (
                    <div className="nw-regular-suggestions">
                      <CompanySuggestions
                        bootstrap={data}
                        onRefresh={sidebarRefresh}
                      />
                    </div>
                  )}
                  {defaultContext}
                </>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
function NetworkContext({
  data,
  go,
}: {
  data: NetworkBootstrap;
  go: (path: string) => void;
}) {
  return (
    <>
      <section className="nw-panel">
        <h2>Find your conversations</h2>
        <p className="nw-muted">Spaces hosted by companies in solar.</p>
        {data.communities.slice(0, 4).map((c) => (
          <button
            className="nw-context-community"
            key={c.id}
            onClick={() => go(`/communities/${c.id}`)}
          >
            <Users size={19} />
            <span>
              <strong>{c.name}</strong>
              <small>{c.member_count} members</small>
            </span>
            <ArrowRight size={15} />
          </button>
        ))}
        <button className="nw-text" onClick={() => go("/communities")}>
          Explore communities
          <ArrowRight size={16} />
        </button>
      </section>
      <p className="nw-rail-note">
        Following a company adds its posts to your feed. Joining a community
        lets you take part in its discussions.
      </p>
    </>
  );
}
function CompanyContext({ company }: { company: NetworkCompany }) {
  return (
    <section className="nw-panel">
      <h2>About {company.name}</h2>
      <p>
        {company.description ||
          company.tagline ||
          "See this company’s services, work and credentials on its profile."}
      </p>
      {company.location && <p className="nw-muted">{company.location}</p>}
      <Link className="nw-text" to={companyPath(company)}>
        View company profile
        <ArrowRight size={16} />
      </Link>
    </section>
  );
}
function CompanyPosts({
  id,
  bootstrap,
  revision,
  actions,
  onCompose,
  onCompany,
}: {
  id: string;
  bootstrap: NetworkBootstrap;
  revision: number;
  actions: PostActions;
  onCompose: () => void;
  onCompany: (company: NetworkCompany) => void;
}) {
  const [company, setCompany] = useState<NetworkCompany | null>(null),
    [error, setError] = useState(""),
    [follow, setFollow] = useState(
      bootstrap.following_company_ids.includes(id),
    ),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api<{ company: NetworkCompany; team: { id: string }[] }>(`/companies/${encodeURIComponent(id)}`, {
      signal: c.signal,
    })
      .then((r) => {
        const maintained = {
          ...r.company,
          on_colabb: r.company.listing_status === "managed" && r.team.length > 0,
        };
        setCompany(maintained);
        onCompany(maintained);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(networkError(e));
      });
    return () => c.abort();
  }, [id]);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await networkPost(`/companies/${id}/follow`, { following: !follow });
      setFollow((v) => !v);
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  if (error && !company) return <NetworkState error={error} />;
  if (!company) return <NetworkState loading />;
  return (
    <>
      <header className="nw-panel nw-company-header">
        <CompanyLogo company={company} size={64} />
        <div>
          <h1>{company.name}</h1>
          <p>{company.tagline || company.location}</p>
        </div>
        <div className="nw-company-actions">
          {bootstrap.viewer.company?.id !== id && (
            <button className="nw-button" onClick={toggle} disabled={busy}>
              {follow ? (
                <>
                  <Check size={15} />
                  Following
                </>
              ) : (
                "+ Follow"
              )}
            </button>
          )}
          {company.on_colabb && (
            <CompanyMessageLink company={company} className="nw-button" />
          )}
          <Link className="nw-text" to={companyPath(company)}>
            Company profile
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <div className="nw-tabs">
        <span aria-current="page">Posts</span>
        <Link to={companyPath(company)}>
          Overview, services & reviews
          <ArrowRight size={14} />
        </Link>
      </div>
      <NetworkFeed
        bootstrap={bootstrap}
        companyId={id}
        revision={revision}
        actions={actions}
        onCompose={onCompose}
      />
      {error && <p className="nw-error">{error}</p>}
    </>
  );
}
