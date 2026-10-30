import { useEffect, useState, type ReactNode } from "react";
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
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import type { Company, Session } from "./types";
import { UsernameField } from "./management";
import "./accounts.css";

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
export function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="account-experience">
      <section className="account-panel">
        <div className="account-brand">
          <img
            className="account-wordmark"
            src="/assets/connect-logo.png"
            alt="Connect"
          />
          <p>Connect. Talk. Celebrate.</p>
        </div>
        {children}
      </section>
    </div>
  );
}
export function AuthExperience({
  initialMode = "login",
  onSuccess,
}: {
  initialMode?: "login" | "register";
  onSuccess: (session: Session) => void;
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
  const change = (value: typeof mode) => {
    setMode(value);
    task.setError("");
    setNotice("");
  };
  return (
    <AccountLayout>
      <div className="account-heading">
        <span className="account-eyebrow">
          {mode === "register"
            ? "START HERE"
            : mode === "login"
              ? "YOUR INDUSTRY IS HERE"
              : "LET’S GET YOU BACK IN"}
        </span>
        <h1>
          {mode === "login"
            ? "Welcome back."
            : mode === "register"
              ? "Welcome to Connect."
              : mode === "forgot"
                ? "Forgot your password?"
                : "A fresh start."}
        </h1>
        <p>
          {mode === "login"
            ? "Pick up where your last conversation left off."
            : mode === "register"
              ? "Meet the companies moving solar forward."
              : mode === "forgot"
                ? "We’ll email you a six-digit code to reset it."
                : `If an account exists for ${email}, a code is on its way.`}
        </p>
      </div>
      <form
        className="account-form"
        key={mode}
        onSubmit={(e) => {
          e.preventDefault();
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
                  accountType,
                }),
              );
          });
        }}
      >
        {mode === "register" && (
          <fieldset className="account-type">
            <legend>I’m here as</legend>
            <div>
              <button
                type="button"
                aria-pressed={accountType === "company"}
                onClick={() => setAccountType("company")}
              >
                <Building2 size={20} />
                <strong>A company</strong>
                <small>Publish, connect, and work as a team</small>
              </button>
              <button
                type="button"
                aria-pressed={accountType === "individual"}
                onClick={() => setAccountType("individual")}
              >
                <Users size={20} />
                <strong>An individual</strong>
                <small>Follow, review, and talk to companies</small>
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
            {accountType === "individual" ? "Email" : "Work email"}
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
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
        <button className="account-primary" disabled={task.busy}>
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
          {mode === "login" ? "New to Connect?" : "Already part of Connect?"}{" "}
          <button
            className="account-link"
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
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { session, company, setSession, refresh } = useApp();
  const task = useAction();
  const individual = session.user?.account_type === "individual";
  const [username, setUsername] = useState(company?.username || "");
  const needsVerification =
    session.verificationRequired !== false && !session.user?.email_verified_at;
  const [step, setStep] = useState<"company" | "follow">(
      individual ? "follow" : "company",
    ),
    [challengeId, setChallengeId] = useState(session.challengeId || ""),
    [cooldown, setCooldown] = useState(0),
    [sent, setSent] = useState(!!session.challengeId);
  const [type, setType] = useState(company?.type || "Installer"),
    [selected, setSelected] = useState<string[]>(company?.services || []),
    [companies, setCompanies] = useState<Company[]>([]),
    [follows, setFollows] = useState<string[]>([]);
  useEffect(() => {
    if (step === "follow")
      api<{ companies: Company[] }>("/companies")
        .then((r) =>
          setCompanies(
            r.companies.filter((c) => c.id !== company?.id).slice(0, 6),
          ),
        )
        .catch((e) => task.setError(e.message));
  }, [step, company?.id]);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const complete = async (ids: string[] = []) => {
    setSession(await post("/onboarding/complete", { followIds: ids }));
    refresh();
    onDone();
  };
  return (
    <AccountLayout>
      <div className="onboarding-progress" aria-label="Account setup">
        <span className={needsVerification ? "current" : "done"}>
          1 <i>Email</i>
        </span>
        {!individual && (
          <>
            <b />
            <span
              className={
                !needsVerification && step === "company"
                  ? "current"
                  : step === "follow"
                    ? "done"
                    : ""
              }
            >
              2 <i>Company</i>
            </span>
          </>
        )}
        <b />
        <span
          className={!needsVerification && step === "follow" ? "current" : ""}
        >
          {individual ? 2 : 3} <i>Community</i>
        </span>
      </div>
      {needsVerification ? (
        <>
          <div className="account-symbol">
            <Mail />
          </div>
          <div className="account-heading">
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
                setSession(
                  await post("/auth/verification/confirm", {
                    challengeId,
                    code,
                  }),
                );
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
        </>
      ) : step === "company" ? (
        <>
          <div className="account-heading">
            <span className="account-eyebrow">YOUR COMPANY</span>
            <h1>Introduce your company.</h1>
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
                  }),
                );
                setStep("follow");
              });
            }}
          >
            <label>
              Company name
              <input
                name="name"
                autoComplete="organization"
                defaultValue={company?.name}
                minLength={2}
                maxLength={120}
                required
                placeholder="Your company’s name"
              />
            </label>
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
            <button className="account-primary" disabled={task.busy}>
              {task.busy ? "Saving…" : "Continue"}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className="account-link back-link"
            disabled={task.busy}
            onClick={() => void task.run(() => complete())}
          >
            {company
              ? "Finish setup later"
              : "Invited by your company? Continue with your invitation link"}
          </button>
        </>
      ) : (
        <>
          <div className="account-symbol">
            <Users />
          </div>
          <div className="account-heading">
            <span className="account-eyebrow">YOUR FEED</span>
            <h1>Find your people.</h1>
            <p>
              Follow companies to see their updates in your feed. Connections
              start with a conversation.
            </p>
          </div>
          <div className="onboarding-companies">
            {companies.map((c) => (
              <div key={c.id}>
                <Logo company={c} />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.type} · {c.location}
                  </small>
                </span>
                <button
                  aria-pressed={follows.includes(c.id)}
                  onClick={() =>
                    setFollows(
                      follows.includes(c.id)
                        ? follows.filter((id) => id !== c.id)
                        : [...follows, c.id],
                    )
                  }
                >
                  {follows.includes(c.id) ? <Check size={16} /> : "+"}
                  <span>{follows.includes(c.id) ? "Following" : "Follow"}</span>
                </button>
              </div>
            ))}
          </div>
          <ErrorMessage message={task.error} />
          <button
            className="account-primary"
            disabled={task.busy}
            onClick={() => void task.run(() => complete(follows))}
          >
            {task.busy ? "Finishing up…" : "Let’s go"}
            <ArrowRight size={18} />
          </button>
          <button
            className="account-link back-link"
            disabled={task.busy}
            onClick={() => void task.run(() => complete())}
          >
            I’ll explore first
          </button>
        </>
      )}
      <div className="account-footnote">
        <Zap size={15} />
        Connect. Talk. Celebrate.
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
  const { session, toast } = useApp(),
    task = useAction();
  const [devices, setDevices] = useState<Device[]>([]),
    [revision, setRevision] = useState(0);
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
          <h3>Change password</h3>
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                d = Object.fromEntries(new FormData(form));
              void task.run(async () => {
                await post("/auth/password/change", d);
                form.reset();
                setRevision((v) => v + 1);
                toast("Password changed. Other devices have been signed out.");
              });
            }}
          >
            <Password name="currentPassword" label="Current password" />
            <Password creating label="New password" />
            <ErrorMessage message={task.error} />
            <button className="account-primary" disabled={task.busy}>
              Update password
            </button>
          </form>
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
      </div>
    </div>
  );
}
