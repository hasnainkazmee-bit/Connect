import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
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
  BriefcaseBusiness,
  Layers3,
  Mail,
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
import { sunhubReturnTo } from "./sunhub-auth";
import {
  HomeFeed,
  PostPage,
  FollowButton,
  CompanyUpdates,
  SocialStats,
} from "./social";
import { WebUpdateNotice } from "./app-updates";
import { useDesktopNotifications } from "./desktop-notifications";
import {
  NotificationContext,
  NotificationContents,
  useNotificationInbox,
  useNotificationReadContext,
} from "./notifications";
import {
  disconnectWebPush,
  notificationDestination,
  useNotificationConversation,
  useWebPushLifecycle,
} from "./web-push";
import { useMobileNavigation } from "./mobile-navigation";
import {
  InboxChannels,
  PersonalInbox,
  PersonalMessageButton,
} from "./personal-messages";
import { JoinCompanyPage } from "./join-company";
import { Directory } from "./directory";
import { ClaimCompanyPage } from "./claim-company";
import { CompanyMatches } from "./company-matches";
import { CompanyProfileView } from "./company-profile";
import { CompanySettings, EmployeeInvite } from "./management";
import { JobsPage, NewJobPage, JobDetailPage } from "./jobs";
import { JobInboxPage } from "./job-inbox";
import { MarketplaceLanding, ProviderDirectory } from "./providers";
import { ProviderProfilePage } from "./provider-profile";
import { Publisher, DraftsDialog, preloadPublisher } from "./composer";
import {
  DesktopPanel,
  useDesktopApp,
  desktopCommandEvent,
  type DesktopCommand,
} from "./mac-app";
import {
  FullPage,
  LeavePage,
  PageGuardProvider,
  PageScopeProvider,
  usePageNavigation,
} from "./page-navigation";
import { CompanyProfileEditorPage } from "./profile-editor-page";
import "./styles.css";
import "./shell.css";
import "./network.css";
import "./messaging.css";
import "./design-system.css";
import "./social.css";
import "./desktop-app.css";
import "./mac-app.css";
import "./windows-app.css";
import "./web-frame.css";
import "./marketplace.css";
import "./marketplace-brand.css";
import "./provider-dossier.css";
import "./job-workspace.css";
import "./job-inbox.css";
import "./profile-workspace.css";

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
  const [jobSection, setJobSection] = useState<"jobs" | "mine" | null>(null);
  const [session, setSession] = useState<Session>({
      user: null,
      companies: [],
      activeCompanyId: null,
    }),
    [ready, setReady] = useState(false),
    [startupError, setStartupError] = useState(""),
    [network, setNetwork] = useState<Network>(emptyNetwork),
    [revision, setRevision] = useState(0),
    [sessionExpired, setSessionExpired] = useState(false),
    [reauthenticate, setReauthenticate] = useState(false),
    [notice, setNotice] = useState(""),
    [deferredOnboarding, setDeferredOnboarding] = useState(""),
    [desktopIntentAfterSignIn, setDesktopIntentAfterSignIn] =
      useState<DesktopCommand | null>(null);
  const navigate = useNavigate(),
    location = useLocation();
  const pageNavigation = usePageNavigation();
  const modal = pageNavigation.active?.content || null;
  const setModal = (content: ReactNode) =>
    content ? pageNavigation.open(content) : pageNavigation.close(true);
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
    if (!session.user) return;
    let checking = false,
      cancelled = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const current = await api<Session>("/session");
        if (!cancelled && !current.user) {
          setSessionExpired(true);
          setReauthenticate(true);
        } else if (!cancelled && current.user?.id !== session.user?.id) {
          setSession(current);
          setModal(null);
          refresh();
        }
      } catch {
        // An unavailable network is not evidence that the user has signed out.
      } finally {
        checking = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("connect:session-expired", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      window.removeEventListener("connect:session-expired", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [session.user?.id, sessionExpired]);
  useEffect(() => {
    let cancel = false;
    if (!company || sessionExpired) {
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
  }, [company?.id, revision, sessionExpired]);
  useEffect(() => {
    if (!company || sessionExpired) return;
    const source = new EventSource("/api/events");
    source.addEventListener("changed", refresh);
    source.addEventListener("open", refresh);
    return () => source.close();
  }, [company?.id, sessionExpired]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  useEffect(() => {
    if (!ready || (location.pathname === "/account" && session.user)) return;
    const code = new URLSearchParams(location.search).get("sso_error");
    if (!code) return;
    const returnTo = sunhubReturnTo(
      location.pathname + location.search + location.hash,
    );
    setModal(<AuthModal sunhubErrorCode={code} returnTo={returnTo} />);
    navigate(returnTo, { replace: true });
  }, [
    ready,
    location.pathname,
    location.search,
    location.hash,
    session.user?.id,
    navigate,
  ]);
  const auth = (after?: () => void, returnTo?: string) =>
    sessionExpired
      ? setReauthenticate(true)
      : setModal(<AuthModal after={after} returnTo={returnTo} />);
  const incompleteAccount =
    session.user &&
    session.verificationRequired !== false &&
    !/^\/claim(?:\/|$)/.test(location.pathname) &&
    (!session.user.email_verified_at ||
      (!session.user.onboarding_completed_at &&
        !/^\/(invite|join)\//.test(location.pathname)));
  const needsOnboarding =
    incompleteAccount && deferredOnboarding !== session.user?.id;
  const mobileNavigation = useMobileNavigation(
    session.user?.account_type === "individual",
    !!session.user,
    !!modal || !!needsOnboarding || reauthenticate,
    () => auth(),
  );
  const unread =
      network.connections.reduce((a, c) => a + c.unread, 0) +
      network.incoming.filter((r) => r.kind === "message").length,
    notificationInbox = useNotificationInbox(
      sessionExpired ? null : session.user?.id || null,
      revision,
    );
  const notificationUser = useRef(session.user?.id);
  notificationUser.current = session.user?.id;
  const notificationNavigation = useRef(0);
  function openNotification(url: string, contextCompany?: string | null) {
    const destination = notificationDestination(url, contextCompany);
    if (!destination) return;
    const returnUrl = new URL(url, window.location.origin);
    if (destination.companyId)
      returnUrl.searchParams.set("notificationCompany", destination.companyId);
    if (!session.user || sessionExpired) {
      auth(undefined, returnUrl.pathname + returnUrl.search);
      return;
    }
    const owner = session.user.id,
      attempt = ++notificationNavigation.current;
    const perform = async () => {
      try {
        if (destination.companyId && destination.companyId !== company?.id) {
          const next = await post<Session>("/session/company", {
            companyId: destination.companyId,
          });
          if (next.user?.id !== owner) {
            setSession(next);
            return;
          }
          if (
            notificationUser.current !== owner ||
            attempt !== notificationNavigation.current
          )
            return;
          setSession(next);
          refresh();
        }
        if (
          notificationUser.current === owner &&
          attempt === notificationNavigation.current
        ) {
          const notificationId = returnUrl.searchParams.get("notification");
          if (notificationId && /^[a-f0-9-]{36}$/i.test(notificationId))
            void notificationInbox.markRead([notificationId]);
          navigate(destination.path, {
            replace: !!new URLSearchParams(location.search).get(
              "notificationCompany",
            ),
          });
        }
      } catch (error) {
        if (notificationUser.current !== owner) return;
        setNotice((error as Error).message);
        navigate("/account#notifications", { replace: true });
      }
    };
    pageNavigation.requestLeave(() => void perform());
  }
  useWebPushLifecycle(
    sessionExpired ? null : session.user?.id || null,
    company?.id || null,
    ready,
    refresh,
    openNotification,
  );
  useDesktopNotifications(
    ready,
    sessionExpired ? null : session.user?.id || null,
    company?.id || null,
    notificationInbox.items,
    notificationInbox.loadedUser,
    openNotification,
  );
  useEffect(() => {
    if (!ready || !session.user || sessionExpired) return;
    const query = new URLSearchParams(location.search);
    if (
      query.has("notificationCompany") ||
      query.has("conversation") ||
      query.has("personal") ||
      query.has("company") ||
      query.has("notification") ||
      location.pathname === "/account/updates"
    )
      openNotification(location.pathname + location.search);
  }, [
    ready,
    session.user?.id,
    sessionExpired,
    location.pathname,
    location.search,
  ]);
  useEffect(() => {
    if (!ready || !session.user || session.user.account_type === "individual")
      return;
    const timer = setTimeout(
      () => void preloadPublisher().catch(() => {}),
      250,
    );
    return () => clearTimeout(timer);
  }, [ready, session.user?.id, session.user?.account_type]);
  const desktopHost = useDesktopApp(
    {
      ready,
      path: location.pathname,
      signedIn: !!session.user && !sessionExpired,
      accountType: session.user?.account_type || "",
      userName: session.user?.name || "",
      companyName: company?.name || "",
      canPublish: !!company && admin && !sessionExpired && !incompleteAccount,
      unreadCount: notificationInbox.unread,
    },
    (command: DesktopCommand) => {
      if (!ready) return;
      if (needsOnboarding || reauthenticate) {
        setNotice("Finish the open account step to continue.");
        return;
      }
      const perform = () => {
        if (command.type === "navigate") {
          if (
            session.user?.account_type === "individual" &&
            command.path.startsWith("/network")
          ) {
            setNotice("Company connections are managed by company accounts.");
            return;
          }
          if (
            (!session.user || sessionExpired) &&
            (command.path.startsWith("/network") ||
              command.path === "/messages")
          ) {
            // Select the real destination before opening sign-in. Native
            // sidebar state follows the URL, including cancellation and Back.
            navigate(command.path);
            auth(undefined, command.path);
          } else navigate(command.path);
        } else if (command.type === "compose") {
          if (!session.user || sessionExpired)
            auth(() => setDesktopIntentAfterSignIn(command));
          else if (session.user.account_type === "individual")
            setNotice("Publishing is for company accounts.");
          else if (!company) setModal(<NewCompany />);
          else if (!admin)
            setNotice("Only company owners and administrators can publish.");
          else setModal(<Publisher />);
        } else if (command.type === "account") {
          if (!session.user || sessionExpired) auth();
          else
            setModal(
              <DesktopPanel title="Your account">
                <AccountMenuContents desktop closeMenu={() => setModal(null)} />
              </DesktopPanel>,
            );
        } else if (command.type === "notifications") {
          if (!session.user || sessionExpired)
            auth(() => setDesktopIntentAfterSignIn(command));
          else
            setModal(
              <DesktopPanel title="Notifications">
                <NotificationContents
                  heading={false}
                  closeMenu={() => setModal(null)}
                />
              </DesktopPanel>,
            );
        } else if (command.type === "profile") {
          if (company) navigate("/company/" + company.slug);
          else if (!session.user || sessionExpired) auth();
          else if (session.user.account_type === "individual")
            navigate("/account");
          else setModal(<NewCompany />);
        }
      };
      pageNavigation.requestLeave(perform);
    },
  );
  useEffect(() => {
    if (
      !desktopHost ||
      !desktopIntentAfterSignIn ||
      !ready ||
      !session.user ||
      sessionExpired ||
      needsOnboarding ||
      reauthenticate ||
      modal
    )
      return;
    // Resume against the current account after React commits sign-in. Reusing
    // the old auth callback would read the signed-out render's permissions.
    setDesktopIntentAfterSignIn(null);
    window.dispatchEvent(
      new CustomEvent(desktopCommandEvent(desktopHost), {
        detail: desktopIntentAfterSignIn,
      }),
    );
  }, [
    desktopHost,
    desktopIntentAfterSignIn,
    ready,
    session.user,
    sessionExpired,
    needsOnboarding,
    reauthenticate,
    modal,
  ]);
  if (!ready) return <Loading />;
  const workspace = (
    <AppContext.Provider
      value={{
        session,
        company,
        network,
        revision,
        refresh,
        setSession,
        setJobSection,
        open: setModal,
        close: pageNavigation.close,
        toast: setNotice,
        leave: (action) =>
          pageNavigation.requestLeave(() => {
            Promise.resolve()
              .then(action)
              .catch((e) => setNotice(e.message));
          }),
        admin,
        signIn: () => auth(),
        createCompany: () => setModal(<NewCompany />),
      }}
    >
      {!desktopHost && (
        <header className="jobs-site-header">
          <div className="jobs-header-inner">
            <Link
              to="/"
              className="jobs-brand"
              aria-label="Connect by Sunhub home"
            >
              <img
                src="/assets/connect-logo.png"
                alt="Connect"
                width={1465}
                height={276}
              />
              <small>by Sunhub</small>
            </Link>
            <nav className="jobs-top-nav" aria-label="Main navigation">
              <Link
                to="/jobs"
                className={
                  (jobSection === "jobs" &&
                    /^\/jobs\/[0-9a-f-]{36}$/.test(location.pathname)) ||
                  location.pathname === "/jobs" ||
                  (location.pathname === "/" && !!session.user)
                    ? "active"
                    : ""
                }
                aria-current={
                  (jobSection === "jobs" &&
                    /^\/jobs\/[0-9a-f-]{36}$/.test(location.pathname)) ||
                  location.pathname === "/jobs" ||
                  (location.pathname === "/" && !!session.user)
                    ? "page"
                    : undefined
                }
              >
                <BriefcaseBusiness size={17} /> Jobs
              </Link>
              {session.user && (
                <Link
                  to="/jobs/mine"
                  aria-current={
                    location.pathname === "/jobs/mine" ||
                    (jobSection === "mine" &&
                      /^\/jobs\/[0-9a-f-]{36}$/.test(location.pathname))
                      ? "page"
                      : undefined
                  }
                  className={
                    location.pathname === "/jobs/mine" ||
                    (jobSection === "mine" &&
                      /^\/jobs\/[0-9a-f-]{36}$/.test(location.pathname))
                      ? "active"
                      : ""
                  }
                >
                  <Layers3 size={17} />
                  My jobs
                </Link>
              )}
              <NavLink
                to="/providers"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <Building2 size={17} />
                Companies
              </NavLink>
              {session.user ? (
                <NavLink
                  to="/jobs/inbox"
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <Mail size={17} />
                  Inbox
                </NavLink>
              ) : (
                <Link to="/#how-it-works">How it works</Link>
              )}
            </nav>
            <div className="jobs-header-actions">
              {(!session.user || (company && admin)) &&
                location.pathname !== "/jobs/new" &&
                !/^\/jobs\/[^/]+\/edit$/.test(location.pathname) && (
                  <Link
                    to="/jobs/new"
                    className="jobs-button jobs-primary header-post-job"
                  >
                    <Plus size={18} /> Post a job
                  </Link>
                )}
              {session.user && (
                <details className="notifications">
                  <summary
                    aria-label="Notifications"
                    className="jobs-icon-button"
                  >
                    <Bell size={19} />
                    {notificationInbox.unread > 0 && (
                      <b className="notification-count">
                        {notificationInbox.unread > 9
                          ? "9+"
                          : notificationInbox.unread}
                      </b>
                    )}
                  </summary>
                  <div className="dropdown notifications-panel">
                    <NotificationContents />
                  </div>
                </details>
              )}
              {session.user ? (
                <details className="account-menu">
                  <summary
                    aria-label="Account and company menu"
                    title={session.user.name}
                  >
                    <Avatar name={session.user.name} />
                  </summary>
                  <div className="dropdown">
                    <AccountMenuContents />
                  </div>
                </details>
              ) : (
                <button
                  className="jobs-button jobs-secondary header-sign-in"
                  onClick={() => auth()}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </header>
      )}
      <main
        {...(desktopHost ? {} : mobileNavigation)}
        className={
          "app-main " +
          (desktopHost ? `desktop-app ${desktopHost}-app ` : "") +
          (location.pathname.startsWith("/messages")
            ? "workspace-view messages-view"
            : location.pathname.startsWith("/network")
              ? "workspace-view network-view"
              : "")
        }
      >
        <ErrorBox message={startupError} />
        <div
          className="app-route-container"
          hidden={
            !!modal ||
            !!needsOnboarding ||
            reauthenticate ||
            pageNavigation.blocker.state === "blocked" ||
            !!pageNavigation.pendingLeave
          }
        >
          <Routes location={pageNavigation.active?.background || location}>
            <Route
              path="/"
              element={session.user ? <JobsPage /> : <MarketplaceLanding />}
            />
            <Route
              path="/directory"
              element={<Navigate to="/providers" replace />}
            />
            <Route path="/providers" element={<ProviderDirectory />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/mine" element={<JobsPage mine />} />
            <Route path="/jobs/inbox" element={<JobInboxPage />} />
            <Route path="/jobs/new" element={<NewJobPage />} />
            <Route
              path="/jobs/companies/:slug"
              element={<ProviderProfilePage />}
            />
            <Route path="/jobs/:id/edit" element={<NewJobPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route
              path="/directory/installers/:place"
              element={<Navigate to="/providers" replace />}
            />
            <Route path="/claim/:username?" element={<ClaimCompanyPage />} />
            <Route
              path="/posts/:id"
              element={<Navigate to="/providers" replace />}
            />
            <Route path="/company/:id" element={<ProviderProfilePage />} />
            <Route
              path="/network/*"
              element={<Navigate to="/jobs/mine" replace />}
            />
            <Route
              path="/requests/*"
              element={<Navigate to="/jobs/mine" replace />}
            />
            <Route
              path="/messages/*"
              element={<Navigate to="/jobs/mine" replace />}
            />
            <Route
              path="/settings/blocked"
              element={<Navigate to="/settings" replace />}
            />
            <Route
              path="/settings"
              element={
                <Protected>
                  <CompanySettings />
                </Protected>
              }
            />
            <Route
              path="/settings/profile/:section?"
              element={
                <Protected>
                  <CompanyProfileEditorPage />
                </Protected>
              }
            />
            <Route
              path="/actions/:id"
              element={
                <Navigate
                  to={
                    (location.state as { returnTo?: string })?.returnTo ||
                    "/providers"
                  }
                  replace
                />
              }
            />
            <Route path="/account" element={<AccountSecurity />} />
            <Route
              path="/account/updates"
              element={<Navigate to="/account#updates" replace />}
            />
            <Route path="/join/:username" element={<JoinCompanyPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/:username" element={<ProviderProfilePage />} />
            <Route
              path="*"
              element={
                <Empty
                  title="That page isn’t here."
                  action={
                    <Link className="button primary" to="/providers">
                      Explore companies
                    </Link>
                  }
                >
                  Explore service providers and open jobs.
                </Empty>
              }
            />
          </Routes>
        </div>
        {pageNavigation.pages.map((page) => (
          <div
            className="app-action-container"
            key={page.id}
            hidden={
              page.id !== pageNavigation.active?.id ||
              !!needsOnboarding ||
              reauthenticate ||
              pageNavigation.blocker.state === "blocked" ||
              !!pageNavigation.pendingLeave
            }
          >
            <PageScopeProvider value={"/actions/" + page.id}>
              <FullPage back={() => pageNavigation.close()}>
                {page.content}
              </FullPage>
            </PageScopeProvider>
          </div>
        ))}
        {needsOnboarding && (
          <FullPage
            back={() => {
              setDeferredOnboarding(session.user!.id);
              setModal(null);
            }}
            backLabel="Finish later"
          >
            <Onboarding
              onDone={() => {
                setModal(null);
                refresh();
              }}
            />
          </FullPage>
        )}
        {reauthenticate && (
          <FullPage
            back={() => setReauthenticate(false)}
            backLabel="Back to your work"
          >
            <div className="session-recovery-message" role="status">
              Sign in again to continue. Your unsaved changes are still here.
            </div>
            <AuthExperience
              onSuccess={(value) => {
                if (
                  value.user?.id !== session.user?.id ||
                  value.activeCompanyId !== session.activeCompanyId
                )
                  setModal(null);
                setSession(value);
                setSessionExpired(false);
                setReauthenticate(false);
                refresh();
              }}
            />
          </FullPage>
        )}
        {(pageNavigation.blocker.state === "blocked" ||
          !!pageNavigation.pendingLeave) && (
          <LeavePage
            busy={!!pageNavigation.guard?.busy}
            keep={pageNavigation.keep}
            discard={pageNavigation.discard}
          />
        )}
      </main>
      {sessionExpired && !reauthenticate && (
        <div className="session-recovery-notice" role="status">
          <span>
            Your session has ended. Your unsaved changes are still here.
          </span>
          <button
            className="button primary"
            onClick={() => setReauthenticate(true)}
          >
            Sign in again
          </button>
        </div>
      )}
      {incompleteAccount && !needsOnboarding && (
        <div className="setup-reminder">
          <ShieldCheck size={18} />
          <span>
            Finish setting up your account to find work and hire providers.
          </span>
          <button onClick={() => setDeferredOnboarding("")}>
            Continue setup <ArrowRight size={14} />
          </button>
        </div>
      )}
      {!desktopHost &&
        !modal &&
        !needsOnboarding &&
        !reauthenticate &&
        !location.pathname.startsWith("/settings/profile") &&
        location.pathname !== "/jobs/new" &&
        location.pathname !== "/jobs/inbox" &&
        !/^\/jobs\/[^/]+\/edit$/.test(location.pathname) &&
        (location.pathname !== "/" || !!session.user) && (
          <footer className="site-footer">
            <span>
              <img
                className="footer-logo"
                src="/assets/connect-logo.png"
                alt="Connect"
              />
            </span>
            <span>Connect. Talk. Build.</span>
            <button onClick={() => setModal(<PhotoCredits />)}>
              Photo credits
            </button>
          </footer>
        )}
      <WebUpdateNotice />
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
    </AppContext.Provider>
  );
  return (
    <NotificationContext.Provider
      value={{ ...notificationInbox, openNotification }}
    >
      <PageGuardProvider value={pageNavigation.register}>
        {workspace}
      </PageGuardProvider>
    </NotificationContext.Provider>
  );
}

function AccountMenuContents({
  closeMenu,
  desktop = false,
}: {
  closeMenu?: () => void;
  desktop?: boolean;
}) {
  const { session, company, admin, setSession, refresh, open, leave } =
    useApp();
  const navigate = useNavigate();
  if (!session.user) return null;
  return (
    <>
      <div className="menu-heading">{session.user.name}</div>
      {session.companies.map((c) => (
        <button
          key={c.id}
          onClick={() =>
            leave(async () => {
              setSession(await post("/session/company", { companyId: c.id }));
              refresh();
              document.querySelector(".account-menu")?.removeAttribute("open");
              closeMenu?.();
              navigate("/jobs/mine");
            })
          }
        >
          <Logo company={c} size="tiny" />
          <span>{c.name}</span>
          {c.id === company?.id && <Check size={15} />}
        </button>
      ))}
      <Link
        to="/account"
        onClick={(e) => {
          e.currentTarget.closest("details")?.removeAttribute("open");
          closeMenu?.();
        }}
      >
        <ShieldCheck />
        Account & security
      </Link>
      {session.user.account_type !== "individual" && (
        <button onClick={() => open(<NewCompany />)}>
          <Plus />
          Create a company
        </button>
      )}
      {company && (
        <Link to="/settings" onClick={closeMenu}>
          <Settings />
          Company settings
        </Link>
      )}
      <button
        onClick={() =>
          leave(async () => {
            await disconnectWebPush().catch(() => {});
            await post("/auth/logout");
            setSession({
              user: null,
              companies: [],
              activeCompanyId: null,
            });
            closeMenu?.();
            navigate("/");
          })
        }
      >
        <LogOut />
        Sign out
      </button>
      {desktop && company && admin && (
        <button onClick={() => open(<DraftsDialog />)}>
          <FileText />
          Your drafts
        </button>
      )}
    </>
  );
}

function Protected({
  children,
  allowIndividual = false,
}: {
  children: ReactNode;
  allowIndividual?: boolean;
}) {
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
  if (session.user.account_type === "individual")
    return allowIndividual ? (
      children
    ) : (
      <Empty
        title="Built around companies"
        action={
          <Link className="button primary" to="/messages">
            Talk to a company
          </Link>
        }
      >
        Company profiles and employee access are managed by company accounts.
        You can explore, follow, review, and message companies.
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
function AuthModal({
  after,
  initialMode = "login",
  returnTo,
  sunhubErrorCode,
}: {
  after?: () => void;
  initialMode?: "login" | "register";
  returnTo?: string;
  sunhubErrorCode?: string;
}) {
  const { setSession, close, refresh } = useApp();
  return (
    <AuthExperience
      initialMode={initialMode}
      returnTo={returnTo}
      sunhubErrorCode={sunhubErrorCode}
      onSuccess={(value) => {
        setSession(value);
        refresh();
        close();
        after?.();
      }}
    />
  );
}
function NewCompany() {
  const { setSession, close, refresh, toast } = useApp();
  const task = useTask();
  const [name, setName] = useState("");
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
          <input
            name="name"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <CompanyMatches name={name} onSelect={close} />
        <ErrorBox message={task.error} />
        <button className="button primary" disabled={task.busy}>
          Create company
        </button>
      </form>
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
  if (c.listing_status === "unclaimed")
    return (
      <a
        className="button primary"
        href={c.website}
        target="_blank"
        rel="noopener noreferrer"
      >
        Visit website <ExternalLink size={15} />
      </a>
    );
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
  const { session } = useApp();
  const { username } = useParams();
  return (
    <CompanyProfileView
      username={username}
      controls={(data) => (
        <>
          {session.user?.account_type === "individual" ? (
            <PersonalMessageButton company={data.company} />
          ) : (
            <ConnectButton profile={data} />
          )}
          {session.user &&
            session.user.account_type !== "individual" &&
            data.relationship.status !== "self" && (
              <CompanyMenu
                company={data.company}
                relationship={data.relationship}
              />
            )}
        </>
      )}
    />
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

function InvitePage() {
  const { token } = useParams(),
    { session, setSession, refresh, open } = useApp(),
    task = useTask(),
    navigate = useNavigate();
  const { data, error, loading } = useResource<{
    name: string;
    role: string;
    emailHint: string;
    emailMatches: boolean | null;
  }>("/team/invites/preview/" + token);
  return (
    <div className="invite-page panel">
      <span className="modal-icon">
        <UserPlus />
      </span>
      {loading ? (
        <Loading />
      ) : error ? (
        <>
          <h1>This invitation isn’t available.</h1>
          <ErrorBox message={error} />
        </>
      ) : (
        data && (
          <>
            <h1>You’re invited to {data.name}.</h1>
            <p className="muted">
              {data.role === "admin"
                ? "Manage publishing, the profile, connections, employees, and messages."
                : "Read and reply in the company’s shared inbox."}
            </p>
            <p className="muted small">
              Invitation for {data.emailHint}. Sign in with your own company
              account.
            </p>
            <ErrorBox message={task.error} />
            {session.user?.account_type === "individual" ? (
              <div className="error">
                This is an employee invitation. Individual accounts cannot join
                company teams. Sign out and use your work account to continue.
              </div>
            ) : session.user ? (
              <>
                <p className="muted small">Signed in as {session.user.email}</p>
                <button
                  className="button primary"
                  disabled={task.busy || !data.emailMatches}
                  onClick={() =>
                    void task.run(async () => {
                      setSession(
                        await post("/team/invites/" + token + "/accept"),
                      );
                      refresh();
                      navigate("/settings");
                    })
                  }
                >
                  Join {data.name}
                </button>
                {!data.emailMatches && (
                  <p className="error">
                    Sign in with the email address this invitation was created
                    for.
                  </p>
                )}
              </>
            ) : (
              <button
                className="button primary"
                onClick={() => open(<AuthModal />)}
              >
                Sign in or create an account
              </button>
            )}
          </>
        )
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
  <RouterProvider
    router={createBrowserRouter([{ path: "*", element: <App /> }])}
  />,
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
                <Link className="button primary" to="/providers">
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

function MessagesRoute() {
  const { session } = useApp();
  return session.user?.account_type === "individual" ? (
    <PersonalInbox />
  ) : (
    <>
      <InboxChannels />
      <MessagesPage />
    </>
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
              <span>
                {selectedCompany.listing_status === "unclaimed"
                  ? "Public directory listing. This company has not joined Connect yet."
                  : "Company conversations are shared with both teams."}
              </span>
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
  if (c.listing_status === "unclaimed")
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
          <div>
            <h2>{c.name}</h2>
            <p>Directory listing</p>
          </div>
        </header>
        <div className="unclaimed-conversation">
          <div className="unclaimed-company-state">
            <Logo company={c} size="large" />
            <span className="directory-status">Not on Connect yet</span>
            <h2>Reach {c.name} directly</h2>
            <p>
              You can contact this company through its website. Chat will be
              available when its team joins Connect.
            </p>
            <div className="unclaimed-company-actions">
              {c.website && (
                <a
                  className="button primary"
                  href={c.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit website <ExternalLink size={16} />
                </a>
              )}
              <Link className="button" to={"/" + (c.username || c.slug)}>
                View company profile <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </>
    );
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
  useNotificationConversation("/messages/" + c.id);
  const { company, session, refresh } = useApp();
  const { data, error, setData } = useResource<{
    messages: Message[];
    hasMore: boolean;
    peerReadSequence?: string;
  }>("/conversations/" + c.id + "/messages");
  useNotificationReadContext("company_conversation", data ? c.id : null);
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
                      {a.mime.startsWith("image/") ? (
                        <img
                          className="chat-image"
                          src={"/api/attachments/" + a.id + "?inline=1"}
                          alt={a.name}
                          loading="lazy"
                        />
                      ) : (
                        <FileText size={20} />
                      )}
                      <span>
                        {a.name}
                        <small>{Math.ceil(a.size / 1024)} KB</small>
                      </span>
                      <Download size={16} />
                    </a>
                  ))}
                </div>
                {m.sender_company_id === company?.id &&
                  i === data.messages.length - 1 && (
                    <span className="message-receipt">
                      <CheckCheck size={13} />
                      {BigInt(data.peerReadSequence || "0") >=
                      BigInt(m.sequence)
                        ? "Read"
                        : "Sent"}
                    </span>
                  )}
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
              const fingerprint = JSON.stringify([
                draft,
                ...files.map((f) => [f.name, f.size, f.lastModified]),
              ]);
              if (pendingSend.current?.fingerprint !== fingerprint)
                pendingSend.current = { fingerprint, id: crypto.randomUUID() };
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
