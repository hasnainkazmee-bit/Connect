import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import {
  House,
  Sun,
  Building2,
  Search,
  MapPin,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Plus,
  Users,
  Send,
  Inbox,
  MessageSquare,
  Bell,
  MoreHorizontal,
  SlidersHorizontal,
  Globe,
  ShieldCheck,
  Paperclip,
  Download,
  LogOut,
  Settings,
  Clock,
  UserPlus,
  Ban,
  Unplug,
  CheckCheck,
  LoaderCircle,
  ExternalLink,
  FileText,
} from "lucide-react";
import { api, post } from "./api";
import {
  emptyNetwork,
  type Company,
  type Session,
  type Network,
  type Profile,
  type ConnectionRequest,
  type Connection,
  type Message,
  type Relationship,
  type Project,
} from "./types";
import { AppContext, useApp } from "./context";
import { Logo, Avatar } from "./identity";
import { AuthExperience, Onboarding, AccountSecurity } from "./accounts";
import {
  HomeFeed,
  PostPage,
  FollowButton,
  CompanyUpdates,
  SocialStats,
} from "./social";
import "./styles.css";
import "./shell.css";
import "./social.css";
import "./network.css";
import "./messaging.css";

const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const time = (s: string) =>
  new Date(s).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <span>Loading…</span>
    </div>
  );
}
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
function Empty({
  icon = <Users />,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
function useResource<T>(path: string | null) {
  const { revision } = useApp();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setLoading(true);
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    api<T>(path)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, revision]);
  return { data, error, loading, setData };
}
function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ref = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (ref.current) return;
    ref.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      ref.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

function App() {
  const [session, setSession] = useState<Session>({
      user: null,
      companies: [],
      activeCompanyId: null,
    }),
    [ready, setReady] = useState(false),
    [startupError, setStartupError] = useState(""),
    [network, setNetwork] = useState<Network>(emptyNetwork),
    [revision, setRevision] = useState(0),
    [modal, setModal] = useState<ReactNode>(null),
    [notice, setNotice] = useState(""),
    [deferredOnboarding, setDeferredOnboarding] = useState("");
  const navigate = useNavigate(),
    location = useLocation();
  const company = session.companies.find(
      (c) => c.id === session.activeCompanyId,
    ),
    admin = company?.role === "owner" || company?.role === "admin";
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    api<Session>("/session")
      .then(setSession)
      .catch((e) => setStartupError(e.message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    let cancel = false;
    if (!company) {
      setNetwork(emptyNetwork);
      return;
    }
    api<Network>("/network")
      .then((n) => {
        if (!cancel) setNetwork(n);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [company?.id, revision]);
  useEffect(() => {
    if (!company) return;
    const source = new EventSource("/api/events");
    source.addEventListener("changed", refresh);
    source.addEventListener("open", refresh);
    return () => source.close();
  }, [company?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  const auth = (after?: () => void) => setModal(<AuthModal after={after} />);
  const incompleteAccount = session.user && session.verificationRequired !== false && (!session.user.email_verified_at || (!session.user.onboarding_completed_at && !location.pathname.startsWith("/invite/")));
  const needsOnboarding = incompleteAccount && deferredOnboarding !== session.user?.id;
  const unread =
      network.connections.reduce((a, c) => a + c.unread, 0) +
      network.incoming.filter((r) => r.kind === "message").length,
    notifications = network.notifications.filter((n) => !n.read_at);
  if (!ready) return <Loading />;
  return (
    <AppContext.Provider
      value={{
        session,
        company,
        network,
        revision,
        refresh,
        setSession,
        open: setModal,
        close: () => setModal(null),
        toast: setNotice,
        admin,
        signIn: () => auth(),
        createCompany: () => setModal(<NewCompany />),
      }}
    >
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" to="/" aria-label="Connect home">
            <img src="/assets/connect-logo.png" alt="Connect" />
          </Link>
          <nav className="primary-nav" aria-label="Main navigation">
            <NavLink
              className={({ isActive }) =>
                "home-nav " + (isActive ? "active" : "")
              }
              to="/"
              end
              aria-label="Home"
            >
              <House size={15} />
              <span>Home</span>
            </NavLink>
            <Link
              to="/directory"
              className={
                location.pathname === "/directory" ||
                location.pathname.startsWith("/company/")
                  ? "active"
                  : ""
              }
              aria-current={
                location.pathname === "/directory" ||
                location.pathname.startsWith("/company/")
                  ? "page"
                  : undefined
              }
            >
              <Building2 size={15} />
              Directory
            </Link>
            <Link
              to="/network/connections"
              className={
                location.pathname.startsWith("/network") ? "active" : ""
              }
              aria-current={
                location.pathname.startsWith("/network") ? "page" : undefined
              }
              onClick={(e) => {
                if (!session.user) {
                  e.preventDefault();
                  auth(() => navigate("/network/connections"));
                }
              }}
            >
              <Users size={15} />
              My Network
            </Link>
            <NavLink
              to="/messages"
              onClick={(e) => {
                if (!session.user) {
                  e.preventDefault();
                  auth(() => navigate("/messages"));
                }
              }}
            >
              <MessageSquare size={15} />
              Messages{unread > 0 && <b className="count">{unread}</b>}
            </NavLink>
            {session.user && (
              <>
                {" "}
                <span className="nav-divider" />{" "}
                <details className="notifications">
                  <summary aria-label="Notifications" className="icon-button">
                    <Bell size={17} />
                    {notifications.length > 0 && (
                      <b className="notification-count">
                        {notifications.length > 9 ? "9+" : notifications.length}
                      </b>
                    )}
                  </summary>
                  <div className="dropdown notifications-panel">
                    <div className="between">
                      <strong>Notifications</strong>
                      <button
                        className="text-button"
                        onClick={async () => {
                          await post("/notifications/read");
                          refresh();
                        }}
                      >
                        Mark read
                      </button>
                    </div>
                    <Link
                      className="requests-notification-link"
                      to="/requests"
                      onClick={(e) =>
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open")
                      }
                    >
                      <UserPlus size={17} />
                      <span>Connection requests</span>
                      {network.incoming.length > 0 && (
                        <b className="count">{network.incoming.length}</b>
                      )}
                      <ChevronRight size={15} />
                    </Link>
                    {network.notifications.length ? (
                      network.notifications.slice(0, 8).map((n) => (
                        <Link
                          key={n.id}
                          to={
                            n.type === "request"
                              ? "/requests"
                              : n.type === "message_request"
                                ? "/messages/company/" + n.related_company_id
                                : n.type === "message"
                                  ? "/messages"
                                  : "/company/" + n.related_company_id
                          }
                          onClick={(e) =>
                            e.currentTarget
                              .closest("details")
                              ?.removeAttribute("open")
                          }
                        >
                          <span className={!n.read_at ? "unread-dot" : ""} />
                          <span>
                            {n.text}
                            <small>{date(n.created_at)}</small>
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="muted">You’re all caught up.</p>
                    )}
                  </div>
                </details>
              </>
            )}
          </nav>
          <div className="header-actions">
            {session.user ? (
              <>
                {company && (
                  <Link
                    className="my-company-link"
                    to={"/company/" + company.slug}
                  >
                    <Building2 size={15} />
                    <span>My company</span>
                  </Link>
                )}
                <details className="account-menu">
                  <summary
                    aria-label="Account and company menu"
                    title={
                      session.user.name +
                      " · " +
                      (company?.name || "Your account")
                    }
                  >
                    <Avatar name={session.user.name} />
                  </summary>
                  <div className="dropdown">
                    <div className="menu-heading">{session.user.name}</div>
                    {session.companies.map((c) => (
                      <button
                        key={c.id}
                        onClick={async () => {
                          setSession(
                            await post("/session/company", { companyId: c.id }),
                          );
                          refresh();
                          document
                            .querySelector(".account-menu")
                            ?.removeAttribute("open");
                          navigate("/network/connections");
                        }}
                      >
                        <Logo company={c} size="tiny" />
                        <span>{c.name}</span>
                        {c.id === company?.id && <Check size={15} />}
                      </button>
                    ))}
                    <Link to="/account" onClick={e => e.currentTarget.closest("details")?.removeAttribute("open")}><ShieldCheck />Account & security</Link>
                    <button onClick={() => setModal(<NewCompany />)}>
                      <Plus />
                      Create a company
                    </button>
                    {company && (
                      <Link to="/settings">
                        <Settings />
                        Company settings
                      </Link>
                    )}
                    <button
                      onClick={async () => {
                        await post("/auth/logout");
                        setSession({
                          user: null,
                          companies: [],
                          activeCompanyId: null,
                        });
                        navigate("/");
                      }}
                    >
                      <LogOut />
                      Sign out
                    </button>
                  </div>
                </details>
              </>
            ) : (
              <>
                <button
                  className="button ghost"
                  onClick={() => setModal(<AuthModal initialMode="register" />)}
                >
                  Join Connect
                </button>
                <button className="button primary" onClick={() => auth()}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main
        className={
          "app-main " +
          (location.pathname.startsWith("/messages")
            ? "workspace-view messages-view"
            : location.pathname.startsWith("/network")
              ? "workspace-view network-view"
              : "")
        }
      >
        <ErrorBox message={startupError} />
        <Routes>
          <Route path="/" element={<HomeFeed />} />
          <Route path="/directory" element={<Directory />} />
          <Route path="/posts/:id" element={<PostPage />} />
          <Route path="/company/:id" element={<CompanyProfile />} />
          <Route
            path="/network/incoming"
            element={<Navigate to="/requests" replace />}
          />
          <Route
            path="/network/sent"
            element={<Navigate to="/requests/sent" replace />}
          />
          <Route
            path="/network/blocked"
            element={<Navigate to="/settings/blocked" replace />}
          />
          <Route
            path="/network/messages"
            element={<Navigate to="/messages" replace />}
          />
          <Route
            path="/requests/:tab?"
            element={
              <Protected>
                <RequestsPage />
              </Protected>
            }
          />
          <Route
            path="/settings/blocked"
            element={
              <Protected>
                <BlockedCompaniesPage />
              </Protected>
            }
          />
          <Route
            path="/network/:tab?"
            element={
              <Protected>
                <NetworkPage />
              </Protected>
            }
          />
          <Route
            path="/messages/company/:companyId"
            element={
              <Protected>
                <MessagesPage />
              </Protected>
            }
          />
          <Route
            path="/messages/:id?"
            element={
              <Protected>
                <MessagesPage />
              </Protected>
            }
          />
          <Route
            path="/settings"
            element={
              <Protected>
                <SettingsPage />
              </Protected>
            }
          />
          <Route path="/account" element={<AccountSecurity />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route
            path="*"
            element={
              <Empty
                title="That page isn’t here."
                action={
                  <Link className="button primary" to="/directory">
                    Explore companies
                  </Link>
                }
              >
                Head back to the directory to keep exploring.
              </Empty>
            }
          />
        </Routes>
      </main>
      {incompleteAccount && !needsOnboarding && <div className="setup-reminder"><ShieldCheck size={18} /><span>Finish setting up your account to join the conversation.</span><button onClick={() => setDeferredOnboarding("")}>Continue setup <ArrowRight size={14} /></button></div>}
      <footer className="site-footer">
        <span>
          <img className="footer-logo" src="/assets/connect-logo.png" alt="Connect" />
        </span>
        <span>Find your people. Build what’s next.</span>
        <button onClick={() => setModal(<PhotoCredits />)}>
          Photo credits
        </button>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {needsOnboarding ? <ModalFrame close={() => { setDeferredOnboarding(session.user!.id); setModal(null); }}><Onboarding onDone={() => { setModal(null); navigate("/"); }} /></ModalFrame> : modal && <ModalFrame close={() => setModal(null)}>{modal}</ModalFrame>}
    </AppContext.Provider>
  );
}
function Protected({ children }: { children: ReactNode }) {
  const { session, company, open } = useApp();
  if (!session.user)
    return (
      <Empty
        title="Your company’s next chapter starts here."
        action={
          <button
            className="button primary"
            onClick={() => open(<AuthModal />)}
          >
            Sign in to continue
          </button>
        }
      >
        Sign in to connect with companies and manage your shared conversations.
      </Empty>
    );
  if (!company)
    return (
      <Empty
        title="Who do you represent?"
        action={
          <button
            className="button primary"
            onClick={() => open(<NewCompany />)}
          >
            Create your company
          </button>
        }
      >
        Create a company or accept an invitation from your team.
      </Empty>
    );
  return children;
}
function ModalFrame({
  children,
  close,
}: {
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-content">
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
function AuthModal({ after, initialMode = "login" }: { after?: () => void; initialMode?: "login" | "register" }) {
  const { setSession, close, refresh } = useApp();
  return <AuthExperience initialMode={initialMode} onSuccess={value => { setSession(value); refresh(); close(); after?.(); }} />;
}
function NewCompany() {
  const { setSession, close, refresh, toast } = useApp();
  const task = useTask();
  return (
    <>
      <h2>Create your company</h2>
      <p className="modal-description">
        Create a new profile for a company you’re authorized to represent.
        Existing companies invite teammates from their settings.
      </p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get("name");
          void task.run(async () => {
            await post("/companies", { name });
            setSession(await api("/session"));
            refresh();
            close();
            toast("Your company profile is ready to complete.");
          });
        }}
      >
        <label>
          Company name
          <input name="name" required minLength={2} />
        </label>
        <ErrorBox message={task.error} />
        <button className="button primary" disabled={task.busy}>
          Create company
        </button>
      </form>
    </>
  );
}

function Directory() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "",
    type = params.get("type") || "",
    service = params.get("service") || "",
    area = params.get("area") || "";
  const { data, error, loading } = useResource<{
    companies: Company[];
    total: number;
    services: string[];
    areas: string[];
    page: number;
    pageSize: number;
  }>("/companies?" + params.toString());
  const [more, setMore] = useState(false);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (key !== "page") next.delete("page");
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Discover companies</h1>
          <p>Find the right expertise. Start the right conversation.</p>
        </div>
      </div>
      <section className="directory-toolbar">
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            change("q", String(new FormData(e.currentTarget).get("q") || ""));
          }}
        >
          <Search size={19} />
          <input
            key={q}
            name="q"
            defaultValue={q}
            placeholder="Search companies, services, or locations…"
            aria-label="Search directory"
          />
          <button className="icon-button" aria-label="Search">
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="filter-row">
          <label className="filter-select">
            <Building2 size={16} />
            <select
              aria-label="Company type"
              value={type}
              onChange={(e) => change("type", e.target.value)}
            >
              <option value="">Company type</option>
              {[
                "Installer",
                "EPC",
                "Developer",
                "Distributor",
                "Manufacturer",
                "Service provider",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <Users size={16} />
            <select
              aria-label="Services"
              value={service}
              onChange={(e) => change("service", e.target.value)}
            >
              <option value="">Services</option>
              {(data?.services || []).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <MapPin size={16} />
            <select
              aria-label="Service area"
              value={area}
              onChange={(e) => change("area", e.target.value)}
            >
              <option value="">Service area</option>
              {(data?.areas || []).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button
            className={"button small " + (more ? "selected" : "")}
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            <SlidersHorizontal size={15} />
            Filters
          </button>
          {params.size > 0 && (
            <button className="text-button" onClick={() => setParams({})}>
              Clear all
            </button>
          )}
        </div>
        {more && (
          <form
            className="extra-filters"
            onSubmit={(e) => {
              e.preventDefault();
              change(
                "office",
                String(new FormData(e.currentTarget).get("office") || ""),
              );
            }}
          >
            <label>
              Office location
              <input
                key={params.get("office") || ""}
                name="office"
                defaultValue={params.get("office") || ""}
                placeholder="City or state, e.g. Austin"
              />
            </label>
            <button className="button small">Apply</button>
            <span>
              Service area is where they work. Office location is where they’re
              based.
            </span>
          </form>
        )}
      </section>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="results-heading">
            <span>
              {data?.total || 0} companies
              {q && (
                <>
                  {" "}
                  matching <strong>“{q}”</strong>
                </>
              )}
            </span>
            <span>Explore the industry</span>
          </div>
          <div className="directory-layout">
            <section className="company-list">
              {data?.companies.length ? (
                data.companies.map((c) => (
                  <CompanyCard key={c.id} company={c} />
                ))
              ) : (
                <Empty
                  icon={<Search />}
                  title="No companies found."
                  action={
                    <button
                      className="button primary"
                      onClick={() => setParams({})}
                    >
                      Clear filters
                    </button>
                  }
                >
                  Try another company name or a broader service area.
                </Empty>
              )}
              {data && data.total > data.pageSize && (
                <div className="directory-pagination">
                  <button
                    className="button small"
                    disabled={data.page === 1}
                    onClick={() => change("page", String(data.page - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page {data.page} of {Math.ceil(data.total / data.pageSize)}
                  </span>
                  <button
                    className="button small"
                    disabled={data.page * data.pageSize >= data.total}
                    onClick={() => change("page", String(data.page + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            <aside className="directory-aside">
              <div className="join-card">
                <div className="sun-orbit">
                  <Sun size={34} />
                </div>
                <h2>Great projects begin with a connection.</h2>
                <p>Meet the companies moving solar forward.</p>
                <div className="join-rule" />
                <span>
                  <Check size={15} />
                  Find complementary expertise
                </span>
                <span>
                  <Check size={15} />
                  Connect company to company
                </span>
                <span>
                  <Check size={15} />
                  Keep your team in the loop
                </span>
              </div>
              <div className="aside-note">
                <ShieldCheck size={18} />
                <p>
                  Your company owns its relationships. Your people make them
                  happen.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
function CompanyCard({
  company: c,
  children,
}: {
  company: Company;
  children?: ReactNode;
}) {
  return (
    <article className="company-card">
      <Link to={"/company/" + c.slug} className="company-card-main">
        <Logo company={c} />
        <div className="company-copy">
          <h2>{c.name}</h2>
          <p>{c.tagline || "Meet this solar industry company."}</p>
          <div className="tags">
            <span>{c.type}</span>
            {c.services.slice(0, 2).map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        </div>
        <div className="company-location">
          <span>
            <MapPin size={14} />
            {c.location || "Location not added"}
          </span>
          <span>
            Serves{" "}
            {c.service_areas.includes("United States")
              ? "US"
              : c.service_areas.slice(0, 2).join(", ") || "Not specified"}
          </span>
        </div>
        <ChevronRight className="card-arrow" size={20} />
      </Link>
      {children && <div className="company-card-actions">{children}</div>}
    </article>
  );
}

function ConnectButton({ profile }: { profile: Profile }) {
  const { session, company, admin, open } = useApp();
  const navigate = useNavigate();
  const { relationship: r, company: c } = profile;
  if (r.status === "self")
    return (
      <Link className="button primary" to="/settings">
        Manage company
      </Link>
    );
  if (r.status === "connected")
    return (
      <Link className="button primary" to={"/messages/" + r.connectionId}>
        <MessageSquare size={17} />
        Message
      </Link>
    );
  if (r.status === "sent")
    return (
      <button
        className="button"
        onClick={() =>
          open(
            <ConfirmAction
              company={c}
              action="withdraw"
              requestId={r.requestId}
            />,
          )
        }
      >
        <Clock size={16} />
        Request sent
      </button>
    );
  if (r.status === "incoming")
    return (
      <Link className="button primary" to="/requests">
        Respond to request
      </Link>
    );
  if (r.status === "blocked")
    return (
      <span className="pill muted">
        {r.blockedByMe ? "Blocked" : "Connection unavailable"}
      </span>
    );
  return (
    <button
      className="button primary"
      onClick={() => {
        if (!session.user) {
          open(<AuthModal after={() => navigate("/company/" + c.slug)} />);
          return;
        }
        if (!company) {
          open(<NewCompany />);
          return;
        }
        if (!admin) {
          open(
            <InfoModal
              title="An administrator can connect your company."
              text="Ask your company owner or administrator to send this connection request."
            />,
          );
          return;
        }
        open(<ConnectModal company={c} />);
      }}
    >
      <Plus size={16} />
      {r.status === "disconnected" ? "Reconnect" : "Connect"}
    </button>
  );
}
function CompanyProfile() {
  const { id } = useParams();
  const { data, error, loading } = useResource<Profile>("/companies/" + id);
  const [tab, setTab] = useState("Overview");
  const { open, session } = useApp();
  if (loading) return <Loading />;
  if (error || !data)
    return <ErrorBox message={error || "Company not found."} />;
  const c = data.company;
  return (
    <>
      <Link className="back-link" to="/directory">
        <ArrowLeft size={16} />
        All companies
      </Link>
      <article className="profile-panel">
        <div className="profile-cover">
          <img src={c.cover_url} alt="Solar energy installation" />
          <span>
            {c.type} · {c.location || "Solar industry"}
          </span>
        </div>
        <div className="profile-header">
          <Logo company={c} size="large" />
          <div className="profile-identity">
            <h1>{c.name}</h1>
            <p>{c.tagline}</p>
            <div className="profile-meta">
              <span>
                <MapPin />
                {c.location || "Location not added"}
              </span>
              <span>
                <Globe />
                Serves {c.service_areas.join(", ") || "Not specified"}
              </span>
              {c.website && (
                <a href={c.website} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  {new URL(c.website).hostname}
                </a>
              )}
            </div>
          </div>
          <div className="profile-controls">
            <FollowButton target={c} />
            <ConnectButton profile={data} />
            {session.user && data.relationship.status !== "self" && (
              <CompanyMenu company={c} relationship={data.relationship} />
            )}
          </div>
        </div>
        <SocialStats companyId={c.id} />
        <div
          className="profile-tabs"
          role="tablist"
          aria-label="Company details"
        >
          {[
            "Overview",
            "Updates",
            "Services",
            "Projects",
            "Team",
            "Credentials",
          ].map((x) => (
            <button
              role="tab"
              aria-selected={tab === x}
              className={tab === x ? "active" : ""}
              key={x}
              onClick={() => setTab(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="profile-body" role="tabpanel">
          {tab === "Overview" ? (
            <div className="profile-grid">
              <section>
                <h2>About</h2>
                <p className="about-copy">
                  {c.description ||
                    "This company is still completing its profile."}
                </p>
                <dl>
                  <dt>Company type</dt>
                  <dd>{c.type}</dd>
                  <dt>Services</dt>
                  <dd className="tags">
                    {c.services.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                    {!c.services.length && "Not added yet"}
                  </dd>
                  <dt>Areas served</dt>
                  <dd className="tags">
                    {c.service_areas.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                  </dd>
                  {c.established && (
                    <>
                      <dt>Established</dt>
                      <dd>{c.established}</dd>
                    </>
                  )}
                </dl>
              </section>
              <aside className="profile-gallery">
                <button
                  onClick={() =>
                    open(
                      <Gallery
                        image="/assets/office.jpg"
                        title="Company gallery"
                      />,
                    )
                  }
                >
                  <img src="/assets/office.jpg" alt="Modern office building" />
                </button>
                <div>
                  <button
                    onClick={() =>
                      open(
                        <Gallery
                          image="/assets/solar.jpg"
                          title="Solar installations"
                        />,
                      )
                    }
                  >
                    <img src="/assets/solar.jpg" alt="Solar panels" />
                  </button>
                  <button onClick={() => setTab("Projects")}>
                    <img src={c.cover_url} alt="View projects" />
                    <span>
                      View projects <ArrowRight size={15} />
                    </span>
                  </button>
                </div>
                <small>Illustrative stock photography</small>
              </aside>
            </div>
          ) : tab === "Updates" ? (
            <CompanyUpdates target={c} />
          ) : tab === "Services" ? (
            <>
              <h2>What we do</h2>
              <div className="service-grid">
                {c.services.map((x) => (
                  <div key={x}>
                    <span>
                      <Check size={18} />
                    </span>
                    <h3>{x}</h3>
                  </div>
                ))}
              </div>
              {!c.services.length && (
                <p className="muted">Services haven’t been added yet.</p>
              )}
            </>
          ) : tab === "Projects" ? (
            <>
              <div className="between">
                <h2>Our work</h2>
                {data.relationship.status === "self" && (
                  <button
                    className="button"
                    onClick={() => open(<ProjectModal />)}
                  >
                    <Plus size={16} />
                    Add project
                  </button>
                )}
              </div>
              <div className="projects-grid">
                {data.projects.map((p) => (
                  <button
                    key={p.id}
                    className="project-card"
                    onClick={() => open(<ProjectDetail project={p} />)}
                  >
                    <img src={p.image_url} alt={p.name} />
                    <div>
                      <h3>{p.name}</h3>
                      <p>
                        {p.location} · {p.size}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {!data.projects.length && (
                <Empty title="Projects will appear here.">
                  This company hasn’t shared its work yet.
                </Empty>
              )}
            </>
          ) : tab === "Team" ? (
            <>
              <h2>The people behind {c.name}</h2>
              <p className="muted section-intro">
                Your connection is with the company. These are the people who
                represent it.
              </p>
              <div className="team-grid">
                {data.team.map((u) => (
                  <div className="team-person" key={u.id}>
                    <Avatar name={u.name} />
                    <h3>{u.name}</h3>
                    <p>{u.title || "Company representative"}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty icon={<ShieldCheck />} title="No credentials published yet.">
              This company hasn’t added credentials. Contact them directly about
              qualifications required for your project.
            </Empty>
          )}
        </div>
      </article>
    </>
  );
}
function CompanyMenu({
  company,
  relationship,
}: {
  company: Company;
  relationship?: Relationship;
}) {
  const { open, admin } = useApp();
  if (!admin) return null;
  return (
    <details className="company-menu">
      <summary
        className="button icon-button"
        aria-label={"Actions for " + company.name}
      >
        <MoreHorizontal size={20} />
      </summary>
      <div className="dropdown">
        <Link to={"/company/" + company.slug}>
          <Building2 />
          View profile
        </Link>
        {relationship?.connectionId && (
          <Link to={"/messages/" + relationship.connectionId}>
            <MessageSquare />
            View conversation
          </Link>
        )}
        {relationship?.status === "connected" && (
          <button
            onClick={() =>
              open(<ConfirmAction company={company} action="disconnect" />)
            }
          >
            <Unplug />
            Disconnect
          </button>
        )}
        {relationship?.blockedByMe ? (
          <button
            onClick={() =>
              open(<ConfirmAction company={company} action="unblock" />)
            }
          >
            <ShieldCheck />
            Unblock
          </button>
        ) : (
          <button
            className="danger-text"
            onClick={() =>
              open(<ConfirmAction company={company} action="block" />)
            }
          >
            <Ban />
            Block company
          </button>
        )}
      </div>
    </details>
  );
}

function SettingsPage() {
  const { company, admin, refresh, setSession, open, session, toast } =
    useApp();
  const { data: team, error } =
    useResource<
      { id: string; name: string; email: string; role: string; title: string }[]
    >("/team");
  const task = useTask();
  if (!company) return null;
  return (
    <div className="settings-layout">
      <div className="page-heading">
        <div>
          <h1>Company settings</h1>
          <p>Keep your company’s home on Connect up to date.</p>
        </div>
        <Link className="button" to={"/company/" + company.slug}>
          View profile
          <ExternalLink size={15} />
        </Link>
      </div>
      <div className="settings-columns">
        <section className="panel">
          <h2>Company details</h2>
          <form
            key={company.id}
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              void task.run(async () => {
                await api("/companies/current", {
                  method: "PATCH",
                  body: JSON.stringify({
                    ...d,
                    services: String(d.services)
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    service_areas: String(d.service_areas)
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  }),
                });
                setSession(await api("/session"));
                refresh();
                toast("Company details updated.");
              });
            }}
          >
            <fieldset disabled={!admin || task.busy}>
              <label>
                Company name
                <input name="name" defaultValue={company.name} required />
              </label>
              <label>
                Tagline
                <input
                  name="tagline"
                  defaultValue={company.tagline}
                  maxLength={200}
                />
              </label>
              <label>
                About
                <textarea
                  name="description"
                  defaultValue={company.description}
                  maxLength={3000}
                  rows={5}
                />
              </label>
              <div className="form-grid">
                <label>
                  Company type
                  <select name="type" defaultValue={company.type}>
                    {[
                      "Installer",
                      "EPC",
                      "Developer",
                      "Distributor",
                      "Manufacturer",
                      "Service provider",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Office location
                  <input name="location" defaultValue={company.location} />
                </label>
              </div>
              <label>
                Services
                <input
                  name="services"
                  defaultValue={company.services.join(", ")}
                />
                <small>Separate services with commas.</small>
              </label>
              <label>
                Service areas
                <input
                  name="service_areas"
                  defaultValue={company.service_areas.join(", ")}
                />
                <small>Where you work, separated by commas.</small>
              </label>
              <label>
                Website
                <input
                  type="url"
                  name="website"
                  defaultValue={company.website}
                  placeholder="https://yourcompany.com"
                />
              </label>
            </fieldset>
            <ErrorBox message={task.error} />
            {admin && (
              <button className="button primary" disabled={task.busy}>
                {task.busy ? "Saving…" : "Save changes"}
              </button>
            )}
          </form>
        </section>
        <aside className="stack">
          <section className="panel">
            <div className="between">
              <h2>Your team</h2>
              {admin && (
                <button
                  className="button small"
                  onClick={() => open(<InviteModal />)}
                >
                  <UserPlus size={15} />
                  Invite
                </button>
              )}
            </div>
            <ErrorBox message={error} />
            {team?.map((u) => (
              <div className="team-member" key={u.id}>
                <Avatar name={u.name} />
                <div>
                  <strong>{u.name}</strong>
                  <small>{u.email}</small>
                  <span className="pill">{u.role}</span>
                </div>
                {admin && u.id !== session.user?.id && u.role !== "owner" && (
                  <button
                    className="icon-button"
                    aria-label={"Remove " + u.name}
                    onClick={() => open(<RemoveMember member={u} />)}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </section>
          <section className="panel tip-panel">
            <ShieldCheck size={22} />
            <h3>Your company keeps the connection.</h3>
            <p>
              Owners and administrators manage relationships. Members can read
              and reply in the shared inbox.
            </p>
            <Link className="text-button" to="/settings/blocked">
              Blocked companies
              <ArrowRight size={14} />
            </Link>
          </section>
          <section className="panel">
            <h3>Project portfolio</h3>
            <p className="muted small">Show what your team has built.</p>
            {admin && (
              <button className="button" onClick={() => open(<ProjectModal />)}>
                <Plus size={16} />
                Add project
              </button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
function InviteModal() {
  const task = useTask();
  const [url, setUrl] = useState("");
  const { toast } = useApp();
  return (
    <>
      <h2>Invite a teammate</h2>
      <p className="modal-description">
        Share a private invitation link with the teammate’s exact email address.
        It expires after three days.
      </p>
      {url ? (
        <>
          <div className="invite-url">{url}</div>
          <button
            className="button primary"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              toast("Invitation link copied.");
            }}
          >
            Copy invitation link
          </button>
          <p className="muted small">
            They’ll need to sign in or create an account using the invited email
            address.
          </p>
        </>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const body = Object.fromEntries(new FormData(e.currentTarget));
            void task.run(async () =>
              setUrl((await post("/team/invites", body)).url),
            );
          }}
        >
          <label>
            Work email
            <input type="email" name="email" required />
          </label>
          <label>
            Role
            <select name="role">
              <option value="member">Member — company messages</option>
              <option value="admin">
                Administrator — connections, team, profile
              </option>
            </select>
          </label>
          <ErrorBox message={task.error} />
          <button className="button primary" disabled={task.busy}>
            Create invitation
          </button>
        </form>
      )}
    </>
  );
}
function InvitePage() {
  const { token } = useParams();
  const { session, setSession, refresh, open } = useApp();
  const task = useTask();
  const navigate = useNavigate();
  return (
    <div className="invite-page panel">
      <span className="modal-icon">
        <UserPlus />
      </span>
      <h1>You’ve been invited to a company.</h1>
      <p className="muted">
        Join your team to manage relationships and conversations together.
      </p>
      <ErrorBox message={task.error} />
      {session.user ? (
        <button
          className="button primary"
          disabled={task.busy}
          onClick={() =>
            void task.run(async () => {
              setSession(await post("/team/invites/" + token + "/accept"));
              refresh();
              navigate("/network/connections");
            })
          }
        >
          Accept invitation as {session.user.email}
        </button>
      ) : (
        <button className="button primary" onClick={() => open(<AuthModal />)}>
          Sign in to accept
        </button>
      )}
    </div>
  );
}
function RemoveMember({ member }: { member: { id: string; name: string } }) {
  const { refresh, close } = useApp();
  const task = useTask();
  return (
    <>
      <h2>Remove {member.name}?</h2>
      <p className="modal-description">
        They will lose access to this company. Their previous messages and the
        company’s connections are retained.
      </p>
      <ErrorBox message={task.error} />
      <div className="modal-actions">
        <button className="button" onClick={close}>
          Cancel
        </button>
        <button
          className="button danger"
          onClick={() =>
            void task.run(async () => {
              await api("/team/" + member.id, { method: "DELETE" });
              refresh();
              close();
            })
          }
          disabled={task.busy}
        >
          Remove teammate
        </button>
      </div>
    </>
  );
}
function ProjectModal() {
  const { refresh, close, toast } = useApp();
  const task = useTask();
  return (
    <>
      <h2>Add a project</h2>
      <p className="modal-description">
        Help future partners understand your work.
      </p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const body = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            await post("/companies/current/projects", body);
            refresh();
            close();
            toast("Project added to your company profile.");
          });
        }}
      >
        <label>
          Project name
          <input name="name" required minLength={2} />
        </label>
        <label>
          Description
          <textarea name="description" required />
        </label>
        <label>
          Location
          <input name="location" required />
        </label>
        <label>
          System size
          <input name="size" placeholder="For example, 420 kW" />
        </label>
        <p className="muted small">
          A stock cover is used until project photo uploads are added.
        </p>
        <ErrorBox message={task.error} />
        <button className="button primary" disabled={task.busy}>
          Add project
        </button>
      </form>
    </>
  );
}
function ProjectDetail({ project: p }: { project: Project }) {
  return (
    <>
      <img className="modal-photo" src={p.image_url} alt={p.name} />
      <h2>{p.name}</h2>
      <p className="muted">
        {p.location} · {p.size}
      </p>
      <p className="project-description">{p.description}</p>
      <small className="muted">
        Company-submitted project · Image is illustrative
      </small>
    </>
  );
}
function Gallery({ image, title }: { image: string; title: string }) {
  return (
    <>
      <h2>{title}</h2>
      <img className="modal-photo" src={image} alt={title} />
      <small className="muted">Illustrative stock photography</small>
    </>
  );
}
function InfoModal({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="modal-description">{text}</p>
    </>
  );
}
function PhotoCredits() {
  return (
    <>
      <h2>Photo credits</h2>
      <p className="modal-description">
        Stock imagery illustrates sample company profiles, not evidence of
        completed work.
      </p>
      <p>
        Solar panels:{" "}
        <a
          href="https://unsplash.com/photos/a-close-up-view-of-a-solar-panel-zLJNseaiR4M"
          target="_blank"
          rel="noreferrer"
        >
          Siwawut Phoophinyo / Unsplash
        </a>
      </p>
      <p>
        Office:{" "}
        <a
          href="https://www.pexels.com/photo/modern-office-complex-with-green-landscape-37938674/"
          target="_blank"
          rel="noreferrer"
        >
          Jakub Zerdzicki / Pexels
        </a>
      </p>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);

function ConnectModal({ company: c }: { company: Company }) {
  const { company, session, close, refresh, open } = useApp();
  const task = useTask();
  if (!company) return null;
  return (
    <>
      <div className="modal-icon">
        <UserPlus />
      </div>
      <h2>Connect with {c.name}</h2>
      <p className="modal-description">
        A simple introduction can be the start of something great.
      </p>
      <div className="connection-parties">
        <div>
          <small>SENDING FROM</small>
          <div>
            <Logo company={company} />
            <span>
              <strong>{company.name}</strong>
              <small>{session.user?.name} · on behalf of your company</small>
            </span>
          </div>
        </div>
        <ArrowRight size={20} />
        <div>
          <small>TO</small>
          <div>
            <Logo company={c} />
            <span>
              <strong>{c.name}</strong>
              <small>{c.location}</small>
            </span>
          </div>
        </div>
      </div>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const note = new FormData(e.currentTarget).get("note");
          void task.run(async () => {
            await post("/requests", { companyId: c.id, note });
            refresh();
            open(<RequestSent company={c} />);
          });
        }}
      >
        <label>
          Add a message <span className="muted">(optional)</span>
          <textarea
            name="note"
            maxLength={500}
            rows={4}
            placeholder="Hi, we’re looking for an installation partner for an upcoming project. We’d love to connect."
          />
          <small>
            Your teams can message each other once the request is accepted.
          </small>
        </label>
        <ErrorBox message={task.error} />
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={task.busy}>
            {task.busy ? "Sending…" : "Send connection request"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </>
  );
}
function RequestSent({ company }: { company: Company }) {
  const { close } = useApp();
  const navigate = useNavigate();
  return (
    <div className="success-content">
      <span className="success-check">
        <Check size={36} />
      </span>
      <h2>Connection request sent</h2>
      <p>
        Your request is with {company.name}.<br />
        We’ll notify you when they respond.
      </p>
      <div className="row">
        <button className="button primary" onClick={close}>
          View company
        </button>
        <button
          className="button"
          onClick={() => {
            close();
            navigate("/requests/sent");
          }}
        >
          View sent requests
        </button>
      </div>
    </div>
  );
}
function ConfirmAction({
  company,
  action,
  requestId,
}: {
  company: Company;
  action: "disconnect" | "block" | "unblock" | "withdraw";
  requestId?: string;
}) {
  const { close, refresh, toast } = useApp();
  const task = useTask();
  const texts = {
    disconnect: [
      "Disconnect from",
      "New messages stop. Existing conversation history stays available. You can send a new connection request later.",
    ],
    block: [
      "Block",
      "This stops new messages and connection requests in both directions. Existing messages are kept. Unblocking won’t restore the connection.",
    ],
    unblock: [
      "Unblock",
      "This company can request a connection again. Your previous connection will remain disconnected.",
    ],
    withdraw: [
      "Withdraw your request to",
      "The pending request will be removed. You can send another request later.",
    ],
  };
  return (
    <>
      <div className={"modal-icon " + (action === "block" ? "red" : "")}>
        <Ban />
      </div>
      <h2>
        {texts[action][0]} {company.name}?
      </h2>
      <p className="modal-description">{texts[action][1]}</p>
      <ErrorBox message={task.error} />
      <div className="modal-actions">
        <button className="button" onClick={close}>
          Cancel
        </button>
        <button
          className={"button " + (action === "block" ? "danger" : "primary")}
          disabled={task.busy}
          onClick={() =>
            void task.run(async () => {
              action === "withdraw"
                ? await post("/requests/" + requestId + "/respond", {
                    action: "withdraw",
                  })
                : await post("/relationships/" + company.id, { action });
              refresh();
              close();
              toast(
                action === "withdraw"
                  ? "Connection request withdrawn."
                  : action === "block"
                    ? "Company blocked."
                    : action === "unblock"
                      ? "Company unblocked."
                      : "Company disconnected.",
              );
            })
          }
        >
          {task.busy
            ? "Please wait…"
            : action === "withdraw"
              ? "Withdraw request"
              : action[0].toUpperCase() + action.slice(1)}
        </button>
      </div>
    </>
  );
}

const businessTypes = [
  ["Installer", "Installers"],
  ["EPC", "EPCs"],
  ["Developer", "Developers"],
  ["Distributor", "Distributors"],
  ["Manufacturer", "Manufacturers"],
  ["Service provider", "Service providers"],
] as const;

function NetworkPage() {
  const { network } = useApp();
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const connected = network.connections
    .filter((c) => c.status === "connected" && !c.blocked)
    .sort((a, b) => a.company.name.localeCompare(b.company.name));
  const groups = businessTypes.map(([type, label]) => ({
    type,
    label,
    connections: connected.filter((c) => c.company.type === type),
  }));
  const query = search.trim().toLowerCase();
  const visibleGroups = groups
    .filter((g) => !selectedType || g.type === selectedType)
    .map((g) => ({
      ...g,
      connections: g.connections.filter((c) =>
        [c.company.name, c.company.location].some((text) =>
          text.toLowerCase().includes(query),
        ),
      ),
    }))
    .filter((g) => g.connections.length);
  return (
    <section className="connections-page">
      <div className="connections-heading">
        <div>
          <h1>My Network</h1>
          <p>
            {connected.length}{" "}
            {connected.length === 1 ? "connection" : "connections"}
          </p>
        </div>
        {connected.length > 0 && (
          <label className="compact-search">
            <Search size={16} />
            <input
              aria-label="Search connections"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search connections…"
            />
          </label>
        )}
      </div>
      <div
        className="connection-filters"
        role="group"
        aria-label="Business type"
      >
        <button
          aria-pressed={!selectedType}
          onClick={() => setSelectedType("")}
        >
          All <span>{connected.length}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.type}
            aria-pressed={selectedType === g.type}
            onClick={() => setSelectedType(g.type)}
          >
            {g.label} <span>{g.connections.length}</span>
          </button>
        ))}
      </div>
      <div className="connections-results">
        {visibleGroups.length ? (
          visibleGroups.map((g) => (
            <section
              className="connection-group"
              key={g.type}
              aria-label={g.label}
            >
              <h2>
                {g.label}
                <span>{g.connections.length}</span>
              </h2>
              <ul>
                {g.connections.map((c) => (
                  <li className="connection-row" key={c.id}>
                    <Link
                      className="connection-identity"
                      to={"/company/" + c.company.slug}
                    >
                      <Logo company={c.company} />
                      <div>
                        <h3>{c.company.name}</h3>
                        <p>{c.company.location || c.company.type}</p>
                      </div>
                    </Link>
                    <Link
                      className="button connection-message"
                      to={"/messages/" + c.id}
                      aria-label={"Message " + c.company.name}
                    >
                      <MessageSquare size={15} />
                      <span>Message</span>
                    </Link>
                    <CompanyMenu
                      company={c.company}
                      relationship={{ status: "connected", connectionId: c.id }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <Empty
            title={
              query
                ? "No matching connections"
                : selectedType
                  ? "No " +
                    groups
                      .find((g) => g.type === selectedType)
                      ?.label.toLowerCase() +
                    " connected yet"
                  : "No connections yet"
            }
            action={
              query ? (
                <button className="button" onClick={() => setSearch("")}>
                  Clear search
                </button>
              ) : (
                <Link className="button primary" to="/directory">
                  Find companies
                </Link>
              )
            }
          >
            {query
              ? "Try another company name or location."
              : "Companies appear here once a connection request is accepted."}
          </Empty>
        )}
      </div>
    </section>
  );
}

function RequestsPage() {
  const { network, admin } = useApp();
  const { tab } = useParams();
  const sent = tab === "sent";
  const requests = sent ? network.sent : network.incoming;
  return (
    <section className="requests-page">
      <div className="section-heading">
        <h1>Connection requests</h1>
      </div>
      <nav className="request-tabs" aria-label="Connection requests">
        <NavLink to="/requests" end>
          Received <span>{network.incoming.length}</span>
        </NavLink>
        <NavLink to="/requests/sent">
          Sent <span>{network.sent.length}</span>
        </NavLink>
      </nav>
      {!admin && (
        <div className="info-banner">
          Your company owners and administrators manage connection requests.
        </div>
      )}
      {requests.length ? (
        requests.map((r) => <RequestCard key={r.id} request={r} sent={sent} />)
      ) : (
        <Empty
          icon={sent ? <Send /> : <Inbox />}
          title={sent ? "No sent requests" : "You’re all caught up"}
        >
          {sent
            ? "Requests you send to other companies will appear here."
            : "New connection requests will appear here."}
        </Empty>
      )}
    </section>
  );
}

function BlockedCompaniesPage() {
  const { network, admin, open } = useApp();
  return (
    <section className="requests-page">
      <Link className="back-link" to="/settings">
        <ArrowLeft size={16} />
        Company settings
      </Link>
      <div className="section-heading">
        <h1>Blocked companies</h1>
      </div>
      {network.blocked.length ? (
        network.blocked.map((b) => (
          <CompanyCard key={b.blocked_id} company={b.company}>
            {admin && (
              <button
                className="button"
                onClick={() =>
                  open(<ConfirmAction company={b.company} action="unblock" />)
                }
              >
                Unblock company
              </button>
            )}
          </CompanyCard>
        ))
      ) : (
        <Empty icon={<ShieldCheck />} title="No blocked companies">
          Companies you block will appear here.
        </Empty>
      )}
    </section>
  );
}
function RequestCard({
  request: r,
  sent,
}: {
  request: ConnectionRequest;
  sent: boolean;
}) {
  const { open, refresh, toast, admin } = useApp();
  const task = useTask();
  const navigate = useNavigate();
  return (
    <article className="request-card">
      <div className="request-top">
        <Logo company={r.company} />
        <div>
          <Link to={"/company/" + r.company.slug}>
            <h2>{r.company.name}</h2>
          </Link>
          <p>
            {r.company.location} · {r.company.type}
          </p>
          <small>
            {sent ? "Sent by" : "Introduction from"} {r.author_name}
          </small>
        </div>
        <time>{date(r.created_at)}</time>
      </div>
      {r.kind === "message" && <span className="pill">Message request</span>}
      {r.note && <p className="request-message">{r.note}</p>}
      <ErrorBox message={task.error} />
      <div className="request-bottom">
        <Link className="text-button" to={"/company/" + r.company.slug}>
          View company
          <ArrowRight size={14} />
        </Link>
        <div className="row">
          {admin &&
            (sent ? (
              <button
                className="button"
                onClick={() =>
                  open(
                    <ConfirmAction
                      company={r.company}
                      action="withdraw"
                      requestId={r.id}
                    />,
                  )
                }
              >
                Withdraw request
              </button>
            ) : (
              <>
                <button
                  className="button"
                  disabled={task.busy}
                  onClick={() =>
                    void task.run(async () => {
                      await post("/requests/" + r.id + "/respond", {
                        action: "decline",
                      });
                      refresh();
                      toast("Request declined.");
                    })
                  }
                >
                  Decline
                </button>
                <button
                  className="button primary"
                  disabled={task.busy}
                  onClick={() =>
                    void task.run(async () => {
                      const result = await post(
                        "/requests/" + r.id + "/respond",
                        { action: "accept" },
                      );
                      refresh();
                      toast(
                        "You’re now connected with " + r.company.name + ".",
                      );
                      navigate("/messages/" + result.connectionId);
                    })
                  }
                >
                  <Check size={16} />
                  Accept
                </button>
              </>
            ))}
        </div>
      </div>
    </article>
  );
}

function MessagesPage() {
  const { id, companyId } = useParams();
  const { network, company } = useApp();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "chats" | "requests">("all");
  const [page, setPage] = useState(1);
  const directory = useResource<{
    companies: Company[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    filter === "all"
      ? "/messaging/companies?q=" +
          encodeURIComponent(search.trim()) +
          "&page=" +
          page
      : null,
  );
  const profile = useResource<Profile>(
    companyId ? "/companies/" + companyId : null,
  );
  const selected = network.connections.find(
    (c) => c.id === id || c.company.id === companyId,
  );
  const selectedProfile =
    profile.data?.company.id === companyId ? profile.data : null;
  const pending = [...network.incoming, ...network.sent];
  const selectedRequest = pending.find((r) => r.company.id === companyId);
  const selectedCompany =
    selectedProfile?.company || selected?.company || selectedRequest?.company;
  const query = search.trim().toLowerCase();
  const matches = (c: Company) =>
    [c.name, c.type, c.location].some((text) =>
      text.toLowerCase().includes(query),
    );
  const listed =
    filter === "all"
      ? directory.data?.companies || []
      : filter === "chats"
        ? network.connections.map((c) => c.company).filter(matches)
        : pending.map((r) => r.company).filter(matches);
  const showConversation =
    selected && (id || (selected.status === "connected" && !selected.blocked));
  return (
    <div
      className={
        "messaging-panel " + (id || companyId ? "has-conversation" : "")
      }
    >
      <aside className="conversation-list">
        <h1>Messages</h1>
        <label className="compact-search">
          <Search size={16} />
          <input
            aria-label="Search companies"
            placeholder="Search companies…"
            maxLength={100}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <div
          className="inbox-filters"
          role="group"
          aria-label="Message filters"
        >
          {(
            [
              ["all", "All companies"],
              ["chats", "Chats"],
              ["requests", "Requests"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
              {value === "requests" && network.incoming.length > 0 && (
                <span>{network.incoming.length}</span>
              )}
            </button>
          ))}
        </div>
        <div
          className="conversation-items"
          aria-busy={filter === "all" && directory.loading}
        >
          <ErrorBox message={filter === "all" ? directory.error : ""} />
          {filter === "all" && directory.loading ? (
            <Loading />
          ) : listed.length ? (
            listed.map((c) => {
              const connection = network.connections.find(
                (n) => n.company.id === c.id,
              );
              const request = pending.find((r) => r.company.id === c.id);
              const incoming = request?.to_id === company?.id;
              const active = c.id === selectedCompany?.id;
              const preview = request
                ? (incoming ? "Request: " : "Sent request: ") +
                  (request.note || "Let’s connect.")
                : connection?.last_message ||
                  [c.type, c.location].filter(Boolean).join(" · ");
              return (
                <Link
                  className={"conversation-link " + (active ? "active" : "")}
                  key={c.id}
                  to={"/messages/company/" + c.id}
                >
                  <Logo company={c} />
                  <span>
                    <span className="between">
                      <strong>{c.name}</strong>
                      {connection?.last_message_at && (
                        <time>{date(connection.last_message_at)}</time>
                      )}
                    </span>
                    <span
                      className={
                        "conversation-preview " +
                        (incoming ? "incoming-request-preview" : "")
                      }
                    >
                      {preview}
                    </span>
                  </span>
                  {incoming ? (
                    <span
                      className="request-dot"
                      aria-label="Incoming request"
                    />
                  ) : (
                    connection &&
                    connection.unread > 0 && (
                      <b className="unread-badge">{connection.unread}</b>
                    )
                  )}
                </Link>
              );
            })
          ) : (
            !directory.error && (
              <p className="list-empty">
                {search
                  ? "No companies match your search."
                  : filter === "requests"
                    ? "No pending requests."
                    : filter === "chats"
                      ? "Your conversations will appear here."
                      : "No other companies yet."}
              </p>
            )
          )}
        </div>
        {filter === "all" &&
          directory.data &&
          directory.data.total > directory.data.pageSize && (
            <div className="inbox-pagination">
              <button
                className="icon-button"
                aria-label="Previous companies"
                disabled={page === 1 || directory.loading}
                onClick={() => setPage(page - 1)}
              >
                <ArrowLeft size={16} />
              </button>
              <span>
                {page} of{" "}
                {Math.ceil(directory.data.total / directory.data.pageSize)}
              </span>
              <button
                className="icon-button"
                aria-label="Next companies"
                disabled={
                  page * directory.data.pageSize >= directory.data.total ||
                  directory.loading
                }
                onClick={() => setPage(page + 1)}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          )}
      </aside>
      <section className="conversation-pane">
        {showConversation ? (
          <Conversation key={selected.id} connection={selected} />
        ) : companyId ? (
          selectedProfile ? (
            <MessageRequestConversation
              key={company!.id + selectedProfile.company.id}
              profile={selectedProfile}
              request={selectedRequest}
            />
          ) : profile.error ? (
            <ErrorBox message={profile.error} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <header className="inbox-pane-heading">Conversations</header>
            <div className="inbox-empty">
              <MessageSquare size={28} />
              <h2>Start a conversation</h2>
              <p>Choose any company. Send a message request to connect.</p>
            </div>
          </>
        )}
      </section>
      <aside className="company-details-panel">
        {selectedCompany ? (
          <>
            <div className="company-details-heading">Company details</div>
            <div className="company-details-identity">
              <Logo company={selectedCompany} />
              <h2>{selectedCompany.name}</h2>
              <p>{selectedCompany.tagline || selectedCompany.type}</p>
            </div>
            <dl>
              <dt>Company type</dt>
              <dd>{selectedCompany.type}</dd>
              <dt>Location</dt>
              <dd>{selectedCompany.location || "Not specified"}</dd>
              <dt>Service area</dt>
              <dd>
                {selectedCompany.service_areas.join(", ") || "Not specified"}
              </dd>
            </dl>
            {selectedCompany.services.length > 0 && (
              <>
                <h3>Services</h3>
                <div className="tags">
                  {selectedCompany.services.map((service) => (
                    <span key={service}>{service}</span>
                  ))}
                </div>
              </>
            )}
            <Link
              className="button full"
              to={"/company/" + selectedCompany.slug}
            >
              View company profile
              <ArrowRight size={14} />
            </Link>
            <div className="details-connection-note">
              <Users size={15} />
              <span>This conversation is shared with both company teams.</span>
            </div>
          </>
        ) : (
          <div className="company-details-placeholder">
            <h2>Company details</h2>
            <p>Select a company to see what they do and where they work.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function MessageRequestConversation({
  profile,
  request,
}: {
  profile: Profile;
  request?: ConnectionRequest;
}) {
  const { company, session, admin, refresh, open, toast } = useApp();
  const navigate = useNavigate();
  const c = profile.company;
  const relationship = profile.relationship;
  const draftKey = "message-request:" + company!.id + ":" + c.id;
  const [draft, setDraft] = useState(
    () => sessionStorage.getItem(draftKey) || "",
  );
  const task = useTask();
  const incoming = request?.to_id === company!.id;
  const blocked = relationship.status === "blocked";
  useEffect(() => {
    sessionStorage.setItem(draftKey, draft);
  }, [draftKey, draft]);
  return (
    <>
      <header className="conversation-header">
        <Link
          className="icon-button mobile-back"
          to="/messages"
          aria-label="Back to companies"
        >
          <ArrowLeft size={20} />
        </Link>
        <Logo company={c} />
        <Link to={"/company/" + c.slug}>
          <h2>{c.name}</h2>
          <p>
            {blocked
              ? "Connection unavailable"
              : request
                ? request.kind === "message"
                  ? "Message request"
                  : "Connection request"
                : "Not connected"}{" "}
            · {c.location || c.type}
          </p>
        </Link>
        <CompanyMenu company={c} relationship={relationship} />
      </header>
      <div className="message-history request-history">
        {relationship.connectionId && (
          <Link
            className="text-button previous-conversation"
            to={"/messages/" + relationship.connectionId}
          >
            View previous conversation
            <ArrowRight size={14} />
          </Link>
        )}
        {request ? (
          <>
            <div className="date-divider">{date(request.created_at)}</div>
            <div className={"message " + (!incoming ? "own" : "")}>
              <Avatar name={request.author_name} />
              <div>
                <div className="message-author">
                  <strong>{request.author_name}</strong>
                  <span>· {incoming ? c.name : company!.name}</span>
                  <time>{time(request.created_at)}</time>
                </div>
                <div className="message-bubble">
                  <p>
                    {request.note || "We’d like to connect with your company."}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="request-introduction">
            <Logo company={c} size="large" />
            <h2>Message {c.name}</h2>
            <p>
              {c.type}
              {c.location ? " · " + c.location : ""}
            </p>
          </div>
        )}
      </div>
      <div className="request-response">
        <ErrorBox message={task.error} />
        {blocked ? (
          <p>New messages and requests are unavailable for this company.</p>
        ) : request ? (
          incoming ? (
            <>
              <h3>
                {request.kind === "message"
                  ? "Accept this message request?"
                  : "Connect with " + c.name + "?"}
              </h3>
              <p>Accept to connect your companies and start chatting.</p>
              {admin ? (
                <div className="row">
                  <button
                    className="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await post("/requests/" + request.id + "/respond", {
                          action: "decline",
                        });
                        refresh();
                        toast("Request declined.");
                      })
                    }
                  >
                    Decline
                  </button>
                  <button
                    className="button primary"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        const result = await post(
                          "/requests/" + request.id + "/respond",
                          { action: "accept" },
                        );
                        refresh();
                        toast("You’re now connected with " + c.name + ".");
                        navigate("/messages/" + result.connectionId);
                      })
                    }
                  >
                    <Check size={15} />
                    Accept &amp; connect
                  </button>
                </div>
              ) : (
                <p>
                  Your company owner or administrator can accept this request.
                </p>
              )}
            </>
          ) : (
            <>
              <h3>
                <Clock size={15} />
                Request sent
              </h3>
              <p>You can chat once {c.name} accepts.</p>
              {admin && (
                <button
                  className="text-button"
                  onClick={() =>
                    open(
                      <ConfirmAction
                        company={c}
                        action="withdraw"
                        requestId={request.id}
                      />,
                    )
                  }
                >
                  Withdraw request
                </button>
              )}
            </>
          )
        ) : relationship.status === "self" ? (
          <p>This is your company.</p>
        ) : !admin ? (
          <p>Your company owner or administrator can send a message request.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              void task.run(async () => {
                await post("/requests", {
                  companyId: c.id,
                  kind: "message",
                  note: draft,
                });
                setDraft("");
                refresh();
              });
            }}
          >
            <p>
              Your first message is a request. Once accepted, your companies
              connect and can chat.
            </p>
            <label className="request-compose-label">
              Message
              <textarea
                aria-label="Message request"
                placeholder="Say hello and share why you’d like to connect…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </label>
            <div className="request-compose-footer">
              <span>
                Sending as {session.user?.name} · {company!.name}
              </span>
              <button
                className="button primary"
                aria-label="Send message request"
                disabled={task.busy || !draft.trim()}
              >
                <Send size={15} />
                {task.busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
function Conversation({ connection: c }: { connection: Connection }) {
  const { company, session, refresh } = useApp();
  const { data, error, setData } = useResource<{
    messages: Message[];
    hasMore: boolean;
    peerReadSequence?: string;
  }>("/conversations/" + c.id + "/messages");
  const [draft, setDraft] = useState(
      () => sessionStorage.getItem("draft:" + company!.id + ":" + c.id) || "",
    ),
    [files, setFiles] = useState<File[]>([]),
    [loadingOlder, setLoadingOlder] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    history = useRef<HTMLDivElement>(null),
    previousHeight = useRef<number | null>(null),
    stickToBottom = useRef(true);
  const task = useTask();
  const pendingSend = useRef<{ fingerprint: string; id: string } | null>(null);
  const canSend = c.status === "connected" && !c.blocked;
  useEffect(() => {
    if (previousHeight.current !== null && history.current) {
      history.current.scrollTop +=
        history.current.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (data && stickToBottom.current) {
      bottom.current?.scrollIntoView({ block: "nearest" });
    }
  }, [data?.messages.length]);
  useEffect(() => {
    sessionStorage.setItem("draft:" + company!.id + ":" + c.id, draft);
  }, [draft, c.id, company!.id]);
  return (
    <>
      <header className="conversation-header">
        <Link
          className="icon-button mobile-back"
          to="/messages"
          aria-label="Back to conversations"
        >
          <ArrowLeft size={20} />
        </Link>
        <Logo company={c.company} />
        <Link to={"/company/" + c.company.slug}>
          <h2>{c.company.name}</h2>
          <p>
            <i className={canSend ? "status-dot" : "status-dot gray"} />
            {canSend
              ? "Connected"
              : c.blocked
                ? "Blocked"
                : "Disconnected"} · {c.company.location}
          </p>
        </Link>
        <CompanyMenu
          company={c.company}
          relationship={{
            status: c.blocked
              ? "blocked"
              : c.status === "connected"
                ? "connected"
                : "disconnected",
            connectionId: c.id,
            blockedByMe: false,
          }}
        />
      </header>
      <div className="shared-notice">
        <Users size={14} />
        Shared with authorized teammates at both companies.
      </div>
      <div
        className="message-history"
        ref={history}
        onScroll={() => {
          const el = history.current;
          if (el)
            stickToBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <ErrorBox message={error} />
        {data?.hasMore && (
          <button
            className="text-button load-older"
            disabled={loadingOlder}
            onClick={async () => {
              setLoadingOlder(true);
              try {
                const more = await api<{
                  messages: Message[];
                  hasMore: boolean;
                }>(
                  "/conversations/" +
                    c.id +
                    "/messages?before=" +
                    encodeURIComponent(data.messages[0].sequence),
                );
                previousHeight.current = history.current?.scrollHeight ?? null;
                setData({
                  ...data,
                  messages: [...more.messages, ...data.messages],
                  hasMore: more.hasMore,
                });
              } catch (e) {
                task.setError((e as Error).message);
              } finally {
                setLoadingOlder(false);
              }
            }}
          >
            Load earlier messages
          </button>
        )}
        <div className="conversation-start">
          <span>
            <Check size={13} />
            Company connection established
          </span>
        </div>
        {data?.messages.map((m, i) => (
          <React.Fragment key={m.id}>
            {(i === 0 ||
              date(data.messages[i - 1].created_at) !== date(m.created_at)) && (
              <div className="date-divider">{date(m.created_at)}</div>
            )}
            <div
              className={
                "message " + (m.sender_company_id === company?.id ? "own" : "")
              }
            >
              <Avatar name={m.author_name} />
              <div>
                <div className="message-author">
                  <strong>{m.author_name}</strong>
                  <span>· {m.sender_company_name}</span>
                  <time>{time(m.created_at)}</time>
                </div>
                <div className="message-bubble">
                  {m.body && <p>{m.body}</p>}
                  {m.attachments.map((a) => (
                    <a
                      key={a.id}
                      className="attachment"
                      href={"/api/attachments/" + a.id}
                    >
                      {a.mime.startsWith("image/") ? <img className="chat-image" src={"/api/attachments/" + a.id + "?inline=1"} alt={a.name} loading="lazy" /> : <FileText size={20} />}
                      <span>
                        {a.name}
                        <small>{Math.ceil(a.size / 1024)} KB</small>
                      </span>
                      <Download size={16} />
                    </a>
                  ))}
                </div>
                {m.sender_company_id === company?.id && i === data.messages.length - 1 && <span className="message-receipt"><CheckCheck size={13} />{BigInt(data.peerReadSequence || "0") >= BigInt(m.sequence) ? "Read" : "Sent"}</span>}
              </div>
            </div>
          </React.Fragment>
        ))}
        {data && !data.messages.length && (
          <div className="first-message">
            <Logo company={c.company} />
            <h3>You’re connected with {c.company.name}.</h3>
            <p>A quick introduction is a good place to start.</p>
            {canSend && (
              <button
                className="button small"
                onClick={() =>
                  setDraft(
                    "Hi, thanks for connecting! I’m " +
                      session.user?.name +
                      " from " +
                      company?.name +
                      ". We’d love to learn more about your team’s work.",
                  )
                }
              >
                Introduce your company
              </button>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      {canSend ? (
        <form
          className="message-composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim() && !files.length) return;
            void task.run(async () => {
              const body = new FormData();
              body.set("body", draft);
              const fingerprint = JSON.stringify([draft, ...files.map(f => [f.name, f.size, f.lastModified])]);
              if (pendingSend.current?.fingerprint !== fingerprint) pendingSend.current = { fingerprint, id: crypto.randomUUID() };
              body.set("clientId", pendingSend.current.id);
              files.forEach((f) => body.append("files", f));
              await api("/conversations/" + c.id + "/messages", {
                method: "POST",
                body,
              });
              pendingSend.current = null;
              setDraft("");
              stickToBottom.current = true;
              setFiles([]);
              if (input.current) input.current.value = "";
              refresh();
            });
          }}
        >
          <div className="sending-as">
            Replying as <strong>{session.user?.name}</strong> · {company?.name}
          </div>
          <ErrorBox message={task.error} />
          {files.length > 0 && (
            <div className="file-chips">
              {files.map((f, i) => (
                <span key={i}>
                  <Paperclip size={13} />
                  {f.name}
                  <button
                    type="button"
                    aria-label={"Remove " + f.name}
                    onClick={() => setFiles(files.filter((_, x) => x !== i))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-input">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a message…"
              aria-label="Message"
              maxLength={10000}
              rows={2}
            />
            <input
              ref={input}
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              multiple
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                if (
                  selected.length > 3 ||
                  selected.some((f) => f.size > 10 * 1024 * 1024)
                ) {
                  task.setError(
                    "Choose up to 3 files, no larger than 10 MB each.",
                  );
                  return;
                }
                task.setError("");
                setFiles(selected);
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Attach files"
              onClick={() => input.current?.click()}
            >
              <Paperclip size={19} />
            </button>
            <button
              className="button primary send-button"
              disabled={task.busy || (!draft.trim() && !files.length)}
              aria-label="Send message"
            >
              <Send size={19} />
            </button>
          </div>
          <small className="attachment-help">
            JPG, PNG, WebP or PDF · Up to 3 files, 10 MB each
          </small>
        </form>
      ) : (
        <div className="conversation-paused">
          <Unplug size={18} />
          <p>
            {c.blocked
              ? "New messages are blocked."
              : "This connection has been disconnected."}{" "}
            Your history is still available.
          </p>
          <Link className="button small" to={"/company/" + c.company.slug}>
            View company
          </Link>
        </div>
      )}
    </>
  );
}
