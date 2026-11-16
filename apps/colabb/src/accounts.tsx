import { AccountUpdates, NotificationPreferences } from "./notifications";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  Mail,
  ShieldCheck,
  Monitor,
  Smartphone,
  Users,
  MessageCircle,
  Building2,
  Sun,
  Zap,
  BriefcaseBusiness,
  LockKeyhole,
  MapPin,
  Search,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import type { Company, Session } from "./types";
import { UsernameField } from "./management";
import { CompanyMatches } from "./company-matches";
import {
  SunhubAuthLink,
  SunhubPopupStatus,
  useSunhubPopup,
  sunhubAuthError,
  sunhubReturnTo,
  useSunhubAuth,
} from "./sunhub-auth";
import "./brand/access.css";

function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="account-error" role="alert">
      {message}
    </div>
  ) : null;
}
function Password({
  label = "Password",
  name = "password",
  creating = false,
}: {
  label?: string;
  name?: string;
  creating?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label>
      {label}
      <span className="password-field">
        <input
          aria-label={label}
          name={name}
          type={show ? "text" : "password"}
          required
          minLength={creating ? 12 : 1}
          maxLength={128}
          autoComplete={creating ? "new-password" : "current-password"}
        />
        <button
          type="button"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {creating && (
        <small>At least 12 characters. A memorable phrase works well.</small>
      )}
    </label>
  );
}
export function AccountLayout({
  children,
  className = "",
  context,
}: {
  children: ReactNode;
  className?: string;
  context?: ReactNode;
}) {
  return (
    <div className={`account-experience colabb-access ${className}`}>
      <div className="access-topline">
        <span>Your sign-in. Your company. Your work.</span>
      </div>
      <div className="access-layout">
        {context}
        <section className="account-panel">{children}</section>
      </div>
    </div>
  );
}

function AccountContext({ returning }: { returning: boolean }) {
  return (
    <aside className="access-context">
      <p className="access-eyebrow">A working network for solar</p>
      <h2>
        {returning
          ? "Pick up where you left off."
          : "Your next working relationship starts here."}
      </h2>
      <p className="access-context-lead">
        Find the right work. Meet the right company. Keep the details together.
      </p>
      <ul className="access-context-list">
        <li>
          <BriefcaseBusiness size={23} />
          <div>
            <strong>Work that fits your company.</strong>
            <p>
              Find opportunities by the service, area and timing you can offer.
            </p>
          </div>
        </li>
        <li>
          <Building2 size={23} />
          <div>
            <strong>A company profile. Individual sign-ins.</strong>
            <p>
              Keep the company’s work together while each teammate uses their
              own login.
            </p>
          </div>
        </li>
        <li>
          <MessageCircle size={23} />
          <div>
            <strong>One conversation around the work.</strong>
            <p>Keep proposals, files and progress connected to the job.</p>
          </div>
        </li>
      </ul>
      <div className="access-context-foot">
        <LockKeyhole size={17} />
        <p>Your company owns its profile. You keep your own sign-in.</p>
      </div>
    </aside>
  );
}
export function AuthExperience({
  initialMode = "login",
  onSuccess,
  companyOnly = false,
  returnTo,
  sunhubErrorCode = "",
}: {
  initialMode?: "login" | "register";
  onSuccess: (session: Session) => void;
  companyOnly?: boolean;
  returnTo?: string;
  sunhubErrorCode?: string;
}) {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(
      initialMode,
    ),
    [email, setEmail] = useState(""),
    [challengeId, setChallengeId] = useState(""),
    [notice, setNotice] = useState("");
  const [accountType, setAccountType] = useState<"company" | "individual">(
    "company",
  );
  const task = useAction();
  const sunhubEnabled = useSunhubAuth();
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id === "notifications" || id === "updates")
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ block: "start" }),
      );
  }, [location.hash]);
  const [sunhubError, setSunhubError] = useState(
    sunhubErrorCode ? sunhubAuthError(sunhubErrorCode) : "",
  );
  const sunhubPopup = useSunhubPopup({ onSuccess });
  useEffect(() => {
    if (sunhubPopup.pending) setSunhubError("");
  }, [sunhubPopup.pending]);
  const destination = sunhubReturnTo(returnTo);
  const forCompany =
    companyOnly || /^\/(claim|invite|join)(?:\/|$)/.test(destination);
  const change = (value: typeof mode) => {
    setMode(value);
    task.setError("");
    setNotice("");
    setSunhubError("");
  };
  return (
    <AccountLayout
      className="account-authentication"
      context={<AccountContext returning={destination !== "/"} />}
    >
      <div className="account-heading">
        <span className="account-eyebrow">
          {mode === "register"
            ? "JOIN COLABB"
            : mode === "login"
              ? "YOUR ACCOUNT"
              : "LET’S GET YOU BACK IN"}
        </span>
        <h1>
          {mode === "login"
            ? "Welcome back."
            : mode === "register"
              ? "Create your account."
              : mode === "forgot"
                ? "Forgot your password?"
                : "Choose a new password."}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in to your work on Colabb."
            : mode === "register"
              ? forCompany
                ? "Confirm your email, then continue with your selected company."
                : accountType === "individual"
                  ? "Explore companies and solar work with your own account."
                  : "You’ll find or add your company next."
              : mode === "forgot"
                ? "We’ll email you a six-digit code to reset it."
                : `If an account exists for ${email}, a code is on its way.`}
        </p>
      </div>
      {sunhubError && <ErrorMessage message={sunhubError} />}
      <form
        className="account-form"
        aria-busy={task.busy || sunhubPopup.pending}
        key={mode}
        onSubmit={(e) => {
          e.preventDefault();
          if (sunhubPopup.pending) return;
          const data = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            if (mode === "forgot") {
              const r = await post("/auth/password/request", { email });
              setChallengeId(r.challengeId);
              setMode("reset");
            } else if (mode === "reset") {
              await post("/auth/password/reset", { ...data, challengeId });
              setMode("login");
              setNotice("Password updated. Sign in with your new password.");
            } else
              onSuccess(
                await post<Session>("/auth/" + mode, {
                  ...data,
                  email,
                  accountType: forCompany ? "company" : accountType,
                }),
              );
          });
        }}
      >
        {mode === "register" && !forCompany && (
          <fieldset className="account-type" disabled={sunhubPopup.pending}>
            <legend>I’m here as</legend>
            <div>
              <button
                type="button"
                aria-pressed={accountType === "company"}
                onClick={() => setAccountType("company")}
              >
                <Building2 size={20} />
                <strong>A company</strong>
                <small>Post jobs, send quotes, and manage projects</small>
              </button>
              <button
                type="button"
                aria-pressed={accountType === "individual"}
                onClick={() => setAccountType("individual")}
              >
                <Users size={20} />
                <strong>An individual</strong>
                <small>Explore companies and available work</small>
              </button>
            </div>
          </fieldset>
        )}
        {mode === "register" && (
          <label>
            Your name
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              placeholder="Your full name"
            />
          </label>
        )}
        {mode !== "reset" && (
          <label>
            Email address
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@company.com"
            />
          </label>
        )}
        {mode === "reset" && (
          <label>
            Email code
            <input
              className="code-input"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              placeholder="000000"
            />
          </label>
        )}
        {mode !== "forgot" && (
          <Password
            creating={mode !== "login"}
            label={mode === "reset" ? "New password" : "Password"}
          />
        )}
        {mode === "login" && (
          <button
            className="account-link forgot-link"
            type="button"
            disabled={sunhubPopup.pending}
            onClick={() => change("forgot")}
          >
            Forgot password?
          </button>
        )}
        {notice && (
          <div className="account-success" role="status">
            <Check size={18} />
            {notice}
          </div>
        )}
        <ErrorMessage message={task.error} />
        <button
          className="account-primary"
          disabled={task.busy || sunhubPopup.pending}
        >
          {task.busy
            ? "Just a moment…"
            : mode === "login"
              ? "Sign in"
              : mode === "register"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset code"
                  : "Reset password"}
          <ArrowRight size={18} />
        </button>
      </form>
      {mode === "login" || mode === "register" ? (
        <div className="account-switch">
          {mode === "login" ? "New to Colabb?" : "Already have an account?"}{" "}
          <button
            className="account-link"
            disabled={sunhubPopup.pending}
            onClick={() => change(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </div>
      ) : (
        <button
          className="account-link back-link"
          onClick={() => change("login")}
        >
          <ArrowLeft size={15} />
          Back to sign in
        </button>
      )}
      {sunhubEnabled && (mode === "login" || mode === "register") && (
        <div className="sunhub-auth-options">
          <div className="sunhub-auth-divider">or</div>
          {!sunhubPopup.pending && (
            <>
              <SunhubAuthLink
                intent="login"
                accountType={forCompany ? "company" : accountType}
                returnTo={destination}
                disabled={task.busy || sunhubPopup.pending}
                popup={sunhubPopup}
              />
              <SunhubAuthLink
                intent="signup"
                accountType={forCompany ? "company" : accountType}
                returnTo={destination}
                disabled={task.busy || sunhubPopup.pending}
                popup={sunhubPopup}
                subtle
              />
            </>
          )}
          <SunhubPopupStatus popup={sunhubPopup} />
        </div>
      )}
      <div className="account-footnote">
        <ShieldCheck size={15} />
        One login, your own. Never share a password.
      </div>
    </AccountLayout>
  );
}

const types = [
  "Installer",
  "EPC",
  "Contractor",
  "Developer",
  "Distributor",
  "Manufacturer",
  "Service provider",
];
const services = [
  "Installation",
  "Design",
  "Engineering",
  "O&M",
  "Energy storage",
  "Equipment supply",
];

function CompanyFinder({
  onCreate,
  onSelect,
  busy,
}: {
  onCreate: (name: string) => void;
  onSelect: (company: Company) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Company[] | null>(null);
  const search = useAction();
  return (
    <>
      <div className="account-heading">
        <span className="account-eyebrow">LET’S GET YOUR COMPANY SET UP</span>
        <h1>Find your company.</h1>
        <p>
          Search first. If your company is already listed, continue with its
          profile.
        </p>
      </div>
      <form
        className="account-form"
        aria-busy={search.busy}
        onSubmit={(event) => {
          event.preventDefault();
          void search.run(async () => {
            const data = await api<{ companies: Company[] }>(
              "/directory/matches?q=" + encodeURIComponent(query.trim()),
            );
            setResults(data.companies);
          });
        }}
      >
        <label>
          Company name
          <span className="access-search-field">
            <Search size={19} />
            <input
              type="search"
              autoComplete="organization"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setResults(null);
                search.setError("");
              }}
              minLength={2}
              maxLength={120}
              required
              placeholder="Enter your company name"
              disabled={search.busy || busy}
            />
          </span>
        </label>
        <ErrorMessage message={search.error} />
        <button className="account-primary" disabled={search.busy || busy}>
          {search.busy ? "Searching…" : "Search companies"}
          <ArrowRight size={18} />
        </button>
      </form>
      {results && (
        <div className="access-company-results" aria-live="polite">
          {results.length ? (
            results.map((match) => (
              <article className="access-company-result" key={match.id}>
                <div className="access-company-heading">
                  <Logo company={match} size="tiny" />
                  <div>
                    <h2>{match.name}</h2>
                    {match.location && (
                      <p>
                        <MapPin size={14} />
                        {match.location}
                      </p>
                    )}
                  </div>
                </div>
                <p className="access-company-kind">{match.type}</p>
                <div className="access-company-state">
                  <strong>
                    {match.listing_status === "unclaimed"
                      ? "Public company profile"
                      : "This company has a team"}
                  </strong>
                  <p>
                    {match.listing_status === "unclaimed"
                      ? "Confirm your connection to the company before managing its profile."
                      : "Ask a company administrator for an invitation to join. Everyone keeps their own sign-in."}
                  </p>
                </div>
                <button
                  type="button"
                  className="access-secondary"
                  disabled={busy}
                  onClick={() => onSelect(match)}
                >
                  {match.listing_status === "unclaimed"
                    ? "Claim this company"
                    : "View company profile"}
                  <ArrowRight size={17} />
                </button>
              </article>
            ))
          ) : (
            <div className="access-empty">
              <Building2 size={23} />
              <div>
                <strong>No matching company found.</strong>
                <p>
                  Try another name, or add a profile for the business you
                  represent.
                </p>
              </div>
            </div>
          )}
          <div className="access-company-create">
            <p>Can’t find your company?</p>
            <button
              className="account-link"
              type="button"
              disabled={busy}
              onClick={() => onCreate(query.trim())}
            >
              Add a new company <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
      <p className="access-inline-note">
        Already invited? Open the invitation link from your company
        administrator to join the existing team.
      </p>
    </>
  );
}

function OnboardingContext({
  company,
  email,
  needsVerification,
  current,
  individual,
  verificationOnly,
}: {
  company: Company | undefined;
  email: string;
  needsVerification: boolean;
  current: "company" | "ready";
  individual: boolean;
  verificationOnly: boolean;
}) {
  const stages = verificationOnly
    ? ["Confirm your email"]
    : individual
      ? ["Confirm your email", "Your work"]
      : ["Confirm your email", "Your company", "Your work"];
  const stage = needsVerification
    ? 0
    : current === "company"
      ? 1
      : stages.length - 1;
  return (
    <aside className="access-onboarding-context">
      {company && (
        <div className="access-company-summary">
          <Logo company={company} size="tiny" />
          <div>
            <small>Your company</small>
            <strong>{company.name}</strong>
          </div>
        </div>
      )}
      <h2>{verificationOnly ? "Your account" : "Account setup"}</h2>
      <ol className="access-steps" aria-label="Account setup progress">
        {stages.map((label, index) => (
          <li
            key={label}
            className={
              index === stage ? "is-current" : index < stage ? "is-done" : ""
            }
            aria-current={index === stage ? "step" : undefined}
          >
            <span className="access-step-number">
              {index < stage ? <Check size={16} /> : index + 1}
            </span>
            <span>{label}</span>
            {index === stage && <small>Current step</small>}
          </li>
        ))}
      </ol>
      <div className="access-signed-in">
        <span>Signed in as</span>
        <strong>{email}</strong>
      </div>
      <p className="access-side-note">
        {individual
          ? "Your own account to explore companies and solar work."
          : "One company profile. Separate sign-ins for everyone on the team."}
      </p>
    </aside>
  );
}

export function Onboarding({
  onDone,
  verificationOnly = false,
}: {
  onDone: () => void;
  verificationOnly?: boolean;
}) {
  const { session, company, setSession, refresh } = useApp();
  const task = useAction();
  const navigate = useNavigate();
  const individual = session.user?.account_type === "individual";
  const [username, setUsername] = useState(company?.username || "");
  const [companyName, setCompanyName] = useState(company?.name || "");
  const [addingCompany, setAddingCompany] = useState(!!company);
  const needsVerification =
    (verificationOnly || session.verificationRequired !== false) &&
    !session.user?.email_verified_at;
  const [step, setStep] = useState<"company" | "ready">(
      individual || company?.role === "member" ? "ready" : "company",
    ),
    [challengeId, setChallengeId] = useState(session.challengeId || ""),
    [cooldown, setCooldown] = useState(0),
    [sent, setSent] = useState(!!session.challengeId);
  const [type, setType] = useState(company?.type || "Installer"),
    [selected, setSelected] = useState<string[]>(company?.services || []);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const complete = async (destination?: string) => {
    setSession(await post("/onboarding/complete", { followIds: [] }));
    refresh();
    onDone();
    if (destination) navigate(destination);
  };
  return (
    <AccountLayout
      className="account-onboarding"
      context={
        <OnboardingContext
          company={company || undefined}
          email={session.user?.email || ""}
          needsVerification={needsVerification}
          current={step}
          individual={individual}
          verificationOnly={verificationOnly}
        />
      }
    >
      {needsVerification ? (
        <>
          <div className="account-symbol">
            <Mail />
          </div>
          <div className="account-heading">
            <span className="account-eyebrow">CONFIRM YOUR EMAIL</span>
            <h1>Check your inbox.</h1>
            <p>
              {sent
                ? "We sent a six-digit code to"
                : "Verify the email for your account."}
              <br />
              <strong>{session.user?.email}</strong>
            </p>
          </div>
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault();
              const code = new FormData(e.currentTarget).get("code");
              void task.run(async () => {
                const verified = await post("/auth/verification/confirm", {
                  challengeId,
                  code,
                });
                setSession(verified);
                if (verificationOnly) onDone();
              });
            }}
          >
            <label>
              Verification code
              <input
                name="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                required
              />
            </label>
            <ErrorMessage message={task.error} />
            <button
              className="account-primary"
              disabled={task.busy || !challengeId}
            >
              {task.busy ? "Verifying…" : "Verify email"}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className="account-link back-link"
            disabled={task.busy || cooldown > 0}
            onClick={() =>
              void task.run(async () => {
                const r = await post("/auth/verification/request");
                if (r.verified) setSession(await api("/session"));
                else setChallengeId(r.challengeId);
                setSent(true);
                setCooldown(60);
              })
            }
          >
            {cooldown
              ? `Resend in ${cooldown}s`
              : sent
                ? "Resend code"
                : "Send verification code"}
          </button>
          <p className="account-note">
            Codes expire after 10 minutes. Check your spam folder too.
          </p>
          <div className="access-verification-note">
            <ShieldCheck size={20} />
            <p>
              Verifying an email confirms that the inbox belongs to you. Company
              access is a separate check.
            </p>
          </div>
        </>
      ) : step === "company" && !addingCompany ? (
        <>
          <CompanyFinder
            busy={task.busy}
            onCreate={(name) => {
              setCompanyName(name);
              setAddingCompany(true);
            }}
            onSelect={(match) => {
              const destination =
                (match.listing_status === "unclaimed" ? "/claim/" : "/") +
                (match.username || match.slug);
              if (match.listing_status === "unclaimed") {
                navigate(destination);
                onDone();
              } else void task.run(() => complete(destination));
            }}
          />
          <ErrorMessage message={task.error} />
        </>
      ) : step === "company" ? (
        <>
          <div className="account-heading">
            <span className="account-eyebrow">YOUR COMPANY</span>
            <h1>
              {company ? "Make your capabilities clear." : "Add your company."}
            </h1>
            <p>
              Help the right people find you. You can refine your profile
              anytime.
            </p>
          </div>
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              void task.run(async () => {
                setSession(
                  await post("/onboarding/company", {
                    ...d,
                    username: username || undefined,
                    type,
                    services: selected,
                    serviceAreas: company?.service_areas || [],
                    tagline: company?.tagline || "",
                  }),
                );
                setStep("ready");
              });
            }}
          >
            <label>
              Company name
              <input
                name="name"
                autoComplete="organization"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                minLength={2}
                maxLength={120}
                required
                placeholder="Your company’s name"
              />
            </label>
            <CompanyMatches
              name={companyName}
              exceptId={company?.id}
              onSelect={() => void task.run(() => complete())}
            />
            <UsernameField
              value={username}
              onChange={setUsername}
              current={company?.username}
            />
            <fieldset>
              <legend>What best describes your business?</legend>
              <div className="business-choices">
                {types.map((t) => (
                  <button
                    type="button"
                    key={t}
                    aria-pressed={type === t}
                    onClick={() => setType(t)}
                  >
                    {type === t ? <Check size={15} /> : <Building2 size={15} />}
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              Based in
              <input
                name="location"
                autoComplete="address-level2"
                defaultValue={company?.location}
                placeholder="City, state or country"
                minLength={2}
                maxLength={160}
                required
              />
            </label>
            <fieldset>
              <legend>
                Your services <small>optional</small>
              </legend>
              <div className="service-choices">
                {services.map((s) => (
                  <button
                    type="button"
                    key={s}
                    aria-pressed={selected.includes(s)}
                    onClick={() =>
                      setSelected(
                        selected.includes(s)
                          ? selected.filter((v) => v !== s)
                          : [...selected, s],
                      )
                    }
                  >
                    {selected.includes(s) && <Check size={12} />}
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>
            <ErrorMessage message={task.error} />
            {!company && (
              <label className="access-authority">
                <input type="checkbox" required />
                <span>
                  I’m authorized to create and manage this company’s profile.
                </span>
              </label>
            )}
            <p className="account-note">
              Your company gets a public directory profile. Add the services and
              areas you cover so people can find you.
            </p>
            <button className="account-primary" disabled={task.busy}>
              {task.busy
                ? "Saving…"
                : company
                  ? "Save and continue"
                  : "Create company"}
              <ArrowRight size={18} />
            </button>
          </form>
          {!company && (
            <button
              type="button"
              className="account-link back-link"
              disabled={task.busy}
              onClick={() => {
                setAddingCompany(false);
                task.setError("");
              }}
            >
              <ArrowLeft size={15} />
              Search existing companies
            </button>
          )}
          <button
            className="account-link back-link"
            disabled={task.busy}
            onClick={() => void task.run(() => complete())}
          >
            Finish setup later
          </button>
        </>
      ) : (
        <>
          <div className="account-symbol">
            <CheckCheck />
          </div>
          <div className="account-heading">
            <span className="account-eyebrow">YOU’RE READY</span>
            <h1>
              {individual
                ? "Explore the work ahead."
                : "What’s next for your company?"}
            </h1>
            <p>
              {individual
                ? "Discover solar businesses and see the projects looking for a team."
                : "Find projects that fit your team, or find a company to get your next job done. You can do both with this account."}
            </p>
          </div>
          <ErrorMessage message={task.error} />
          <button
            className="account-primary"
            disabled={task.busy}
            onClick={() => void task.run(() => complete("/jobs"))}
          >
            {task.busy ? "Finishing up…" : "Find work"}
            <ArrowRight size={18} />
          </button>
          <button
            className="account-link back-link"
            disabled={task.busy}
            onClick={() =>
              void task.run(() =>
                complete(individual ? "/providers" : "/jobs/new"),
              )
            }
          >
            {individual ? "Explore companies" : "I need to hire a company"}
          </button>
        </>
      )}
      <div className="account-footnote">
        <Zap size={15} />
        The working network for solar.
      </div>
    </AccountLayout>
  );
}

type Device = {
  id: string;
  user_agent: string;
  current: boolean;
  last_seen_at: string;
};
export function AccountSecurity() {
  const { session, setSession, refresh, toast } = useApp(),
    task = useAction();
  const [devices, setDevices] = useState<Device[]>([]),
    [revision, setRevision] = useState(0);
  const location = useLocation(),
    navigate = useNavigate();
  const sunhubEnabled = useSunhubAuth();
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id === "notifications" || id === "updates")
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ block: "start" }),
      );
  }, [location.hash]);
  const [sunhubError, setSunhubError] = useState(() => {
    const code = new URLSearchParams(location.search).get("sso_error");
    return code ? sunhubAuthError(code) : "";
  });
  const [sunhubLinked, setSunhubLinked] = useState(
    () =>
      new URLSearchParams(location.search).get("sunhub_linked") === "1" &&
      session.user?.sunhubLinked,
  );
  const sunhubPopup = useSunhubPopup({
    expectedUserId: session.user?.id,
    onSuccess: (value) => {
      setSession(value);
      refresh();
      setSunhubLinked(true);
      setSunhubError("");
      setRevision((v) => v + 1);
    },
  });
  useEffect(() => {
    if (sunhubPopup.pending) setSunhubError("");
  }, [sunhubPopup.pending]);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.has("sso_error") || query.has("sunhub_linked"))
      navigate(
        sunhubReturnTo(location.pathname + location.search + location.hash),
        { replace: true },
      );
  }, [location.pathname, location.search, location.hash, navigate]);
  useEffect(() => {
    api<{ sessions: Device[] }>("/auth/sessions")
      .then((r) => setDevices(r.sessions))
      .catch((e) => task.setError(e.message));
  }, [revision]);
  if (!session.user)
    return <div className="security-page">Sign in to manage your account.</div>;
  return (
    <div className="security-page">
      <div className="account-heading">
        <span className="account-eyebrow">YOUR ACCOUNT</span>
        <h1>Safe. Signed in. In control.</h1>
        <p>Manage your password and where you’re signed in.</p>
      </div>
      <ErrorMessage message={sunhubError} />
      {sunhubLinked && (
        <div className="account-success" role="status">
          <Check size={18} />
          Sunhub is linked. You can now sign in with either account.
        </div>
      )}
      <div className="security-grid">
        <section>
          <h2>
            <ShieldCheck size={20} />
            Account details
          </h2>
          <strong>{session.user.name}</strong>
          <p>{session.user.email}</p>
          <span className="verified-label">
            {session.user.email_verified_at ? (
              <>
                <Check size={14} />
                Email verified
              </>
            ) : (
              "Email verification pending"
            )}
          </span>
          {(sunhubEnabled || session.user.sunhubLinked) && (
            <div className="sunhub-account-linking">
              <h3>Sunhub account</h3>
              {session.user.sunhubLinked ? (
                <div className="sunhub-account-linked">
                  <CheckCheck size={19} />
                  Linked to Sunhub
                </div>
              ) : (
                <>
                  <p>
                    Link the Sunhub account that uses {session.user.email}. Your
                    Colabb profile and conversations stay with you.
                  </p>
                  <SunhubAuthLink
                    intent="link"
                    accountType={session.user.account_type || "company"}
                    returnTo="/account"
                    disabled={task.busy || sunhubPopup.pending}
                    popup={sunhubPopup}
                  />
                </>
              )}
              <SunhubPopupStatus popup={sunhubPopup} />
            </div>
          )}
          {session.user.hasPassword === false ? (
            <div className="sunhub-password-note">
              <h3>Password</h3>
              <p>
                You sign in with Sunhub. To add a separate Colabb password, use
                Forgot password on the Colabb sign-in screen.
              </p>
            </div>
          ) : (
            <>
              <h3>Change password</h3>
              <form
                className="account-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sunhubPopup.pending) return;
                  const form = e.currentTarget,
                    d = Object.fromEntries(new FormData(form));
                  void task.run(async () => {
                    await post("/auth/password/change", d);
                    form.reset();
                    setRevision((v) => v + 1);
                    toast(
                      "Password changed. Other devices have been signed out.",
                    );
                  });
                }}
              >
                <Password name="currentPassword" label="Current password" />
                <Password creating label="New password" />
                <ErrorMessage message={task.error} />
                <button
                  className="account-primary"
                  disabled={task.busy || sunhubPopup.pending}
                >
                  Update password
                </button>
              </form>
            </>
          )}
        </section>
        <section>
          <h2>
            <Monitor size={20} />
            Your devices
          </h2>
          <p>Only keep sessions you recognize.</p>
          <div className="device-list">
            {devices.map((d) => (
              <div key={d.id}>
                {/Android|iPhone/i.test(d.user_agent) ? (
                  <Smartphone size={22} />
                ) : (
                  <Monitor size={22} />
                )}
                <span>
                  <strong>
                    {/Android|sunhub|connect|reqwest/i.test(d.user_agent)
                      ? "Connect for Android"
                      : /Firefox/i.test(d.user_agent)
                        ? "Firefox"
                        : /Chrome/i.test(d.user_agent)
                          ? "Chrome"
                          : /Safari/i.test(d.user_agent)
                            ? "Safari"
                            : "Connect session"}
                  </strong>
                  <small>
                    {d.current
                      ? "This device"
                      : "Active " + new Date(d.last_seen_at).toLocaleString()}
                  </small>
                </span>
                {d.current ? (
                  <span className="current-device">Current</span>
                ) : (
                  <button
                    className="account-link"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await post("/auth/sessions/revoke", { id: d.id });
                        setRevision((v) => v + 1);
                      })
                    }
                  >
                    Sign out
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="button"
            disabled={task.busy || devices.length < 2}
            onClick={() =>
              void task.run(async () => {
                await post("/auth/sessions/revoke", { others: true });
                setRevision((v) => v + 1);
                toast("Other devices signed out.");
              })
            }
          >
            Sign out other devices
          </button>
        </section>
        <NotificationPreferences />
        <AccountUpdates />
      </div>
    </div>
  );
}
