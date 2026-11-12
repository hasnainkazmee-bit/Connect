import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import { AuthExperience, Onboarding } from "./accounts";
import { CompanyMatches } from "./company-matches";
import { FormError, useAction } from "./management";
import type { Company, Session } from "./types";
import "./directory.css";

type Claim = {
  company: Company;
  domains: string[];
  emailMatches: boolean;
  verified: boolean;
  claim: null | { id: string; status: string; review_note: string };
};
export function ClaimCompanyPage() {
  const { username } = useParams(),
    navigate = useNavigate();
  const {
    session,
    setSession,
    refresh,
    revision,
    toast,
    signIn,
    createCompany,
  } = useApp();
  const [data, setData] = useState<Claim | null>(null),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [manual, setManual] = useState(false);
  const task = useAction();
  useEffect(() => {
    if (!username) return;
    let active = true;
    setError("");
    api<Claim>("/companies/" + encodeURIComponent(username) + "/claim")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [username, session.user?.id, session.user?.email_verified_at, revision]);
  // An operator can approve a manual claim while this page is open.
  useEffect(() => {
    if (
      data?.claim?.status !== "approved" ||
      session.companies.some((c) => c.id === data.company.id)
    )
      return;
    let active = true;
    api<Session>("/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data, session.companies, setSession]);
  useEffect(() => {
    if (data?.claim?.status !== "pending") return;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [data?.claim?.status, refresh]);
  const signOut = async () => {
    await post("/auth/logout");
    setSession({ user: null, companies: [], activeCompanyId: null });
  };
  if (!username)
    return (
      <div className="claim-page profile-claim-page">
        <Link className="claim-back" to="/providers">
          <ArrowLeft size={14} />
          Back to companies
        </Link>
        <div className="claim-layout">
          <section className="claim-context">
            <span className="discovery-eyebrow">YOUR COMPANY ON CONNECT</span>
            <h1>Is your company already here?</h1>
            <p>
              Find your company and take control of its profile. Add the work
              you do, the areas you serve, and your availability so customers
              can find the right fit.
            </p>
            <ul>
              <li>
                <Building2 size={18} />
                Keep your existing company information and reviews.
              </li>
              <li>
                <Users size={18} />
                Invite employees with their own secure logins.
              </li>
            </ul>
          </section>
          <section className="claim-content">
            <h2>Find your company</h2>
            <p>
              It may already have a public listing. Search before creating a new
              profile.
            </p>
            <label className="claim-email">
              <Search size={19} />
              <input
                autoFocus
                aria-label="Find your company"
                placeholder="Your company’s name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </label>
            <CompanyMatches name={name} />
            <p style={{ marginTop: 24 }}>Not listed yet?</p>
            <button
              className="button primary"
              style={{ marginTop: 12 }}
              onClick={() =>
                session.user?.account_type === "individual"
                  ? void task.run(signOut)
                  : session.user
                    ? createCompany()
                    : signIn()
              }
            >
              {session.user?.account_type === "individual"
                ? "Use a company account"
                : "Add your company"}{" "}
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="claim-page profile-claim-page">
        <FormError error={error} />
        <Link className="button" to="/providers">
          Back to companies
        </Link>
      </div>
    );
  if (!data) return <div className="manage-loading">Loading company…</div>;
  const c = data.company,
    own = session.companies.some((v) => v.id === c.id),
    needsManual = manual || !data.emailMatches;
  return (
    <div className="claim-page profile-claim-page">
      <Link className="claim-back" to={"/" + (c.username || c.slug)}>
        <ArrowLeft size={14} />
        Back to {c.name}
      </Link>
      <ol className="claim-steps" aria-label="Claim progress">
        {["Your account", "Verify access", "Edit your profile"].map(
          (label, index) => {
            const step = own ? 2 : session.user && data.verified ? 1 : 0;
            return (
              <li
                key={label}
                className={
                  index === step ? "current" : index < step ? "complete" : ""
                }
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Check size={17} /> : index + 1}</span>
                <strong>{label}</strong>
              </li>
            );
          },
        )}
      </ol>
      <div className="claim-layout">
        <section className="claim-context">
          <Logo company={c} />
          <span className="discovery-eyebrow">CLAIM YOUR COMPANY</span>
          <h1>Claim {c.name}</h1>
          <p>
            {c.location}
            {c.location && " · "}
            {c.type}
          </p>
          {c.website && (
            <a
              className="claim-company-website"
              href={c.website}
              target="_blank"
              rel="noreferrer"
            >
              Company website <ArrowRight size={16} />
            </a>
          )}
          <p>
            Manage this company’s information and help the right customers find
            your services.
          </p>
          <ul>
            <li>
              <Building2 size={18} />
              Update your company details and service areas.
            </li>
            <li>
              <FileText size={18} />
              Add your services, project types, and completed work.
            </li>
            <li>
              <MessageSquare size={18} />
              Receive job inquiries and send quotes.
            </li>
            <li>
              <Users size={18} />
              Invite your team. Everyone gets their own login.
            </li>
          </ul>
        </section>
        <section className="claim-content">
          {own ? (
            <>
              <div className="claim-success-icon">
                <Check />
              </div>
              <h2>You’re part of {c.name}.</h2>
              <p>Your company profile is ready to manage.</p>
              <button
                className="button primary"
                style={{ marginTop: 22 }}
                onClick={() =>
                  void task.run(async () => {
                    setSession(
                      await post("/session/company", { companyId: c.id }),
                    );
                    refresh();
                    navigate("/settings/profile/overview");
                  })
                }
              >
                Edit company profile <ArrowRight size={15} />
              </button>
              <FormError error={task.error} />
            </>
          ) : c.listing_status !== "unclaimed" ? (
            <>
              <ShieldCheck size={28} />
              <h2>This profile is already managed.</h2>
              <p>
                Ask your company’s administrator to invite you. You’ll get your
                own login and the right permissions.
              </p>
              <Link
                className="button"
                style={{ marginTop: 20 }}
                to={"/" + (c.username || c.slug)}
              >
                View company
              </Link>
            </>
          ) : !session.user ? (
            <>
              <AuthExperience
                companyOnly
                initialMode="register"
                returnTo={"/claim/" + username}
                onSuccess={(value: Session) => {
                  setSession(value);
                  refresh();
                }}
              />
            </>
          ) : session.user.account_type === "individual" ? (
            <>
              <Building2 size={28} />
              <h2>Use a company account.</h2>
              <p>
                Individual accounts can follow, review and contact businesses.
                To manage this profile, sign in with the company account you use
                for work.
              </p>
              <button
                className="button primary"
                style={{ marginTop: 20 }}
                onClick={() => void task.run(signOut)}
              >
                Use another account
              </button>
              <FormError error={task.error} />
            </>
          ) : !data.verified ? (
            <Onboarding verificationOnly onDone={() => refresh()} />
          ) : data.claim?.status === "pending" ? (
            <>
              <div className="claim-success-icon">
                <Clock />
              </div>
              <h2>We’re checking your request.</h2>
              <p>
                We’ll check the company information and your role before
                granting access. You can return to this page to check its
                status.
              </p>
              <button
                className="button primary"
                style={{ marginTop: 20 }}
                onClick={() => refresh()}
              >
                Check status
              </button>
              <Link
                className="button"
                style={{ marginTop: 20 }}
                to={"/" + (c.username || c.slug)}
              >
                View company profile
              </Link>
            </>
          ) : (
            <>
              <h2>
                {needsManual
                  ? "Confirm your role"
                  : "Your work email is verified"}
              </h2>
              <p>
                {needsManual
                  ? "Tell us how you represent this business. We’ll review your request before giving you access."
                  : "Your verified work email matches this company’s official domain. Confirm your role to claim the profile."}
              </p>
              <div className="claim-email">
                <Mail size={17} />
                <span>{session.user.email}</span>
                <Check size={15} />
              </div>
              {data.claim?.status === "rejected" && (
                <FormError
                  error={
                    data.claim.review_note ||
                    "Your previous request was not approved. You can submit new information."
                  }
                />
              )}
              {needsManual && data.domains.length > 0 && (
                <p>
                  Have an @{data.domains[0]} work email?{" "}
                  <button
                    className="text-button"
                    onClick={() => void task.run(signOut)}
                  >
                    Use that account
                  </button>{" "}
                  to verify directly.
                </p>
              )}
              <form
                className="manage-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void task.run(async () => {
                    const r = await post("/companies/" + c.id + "/claim", {
                      method: needsManual ? "manual" : "work_email",
                      role: form.get("role"),
                      evidence: form.get("evidence") || "",
                    });
                    if (r.status === "approved") {
                      setSession(await api<Session>("/session"));
                      toast("You now manage " + c.name + ".");
                      navigate("/settings/profile/overview?claimed=1");
                    }
                    refresh();
                  });
                }}
              >
                <label>
                  Your role at {c.name}
                  <input
                    name="role"
                    placeholder="e.g. Owner or Marketing manager"
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                {needsManual && (
                  <label>
                    How can we confirm your role?
                    <textarea
                      name="evidence"
                      rows={4}
                      required
                      minLength={30}
                      maxLength={2000}
                      placeholder="Link to a company page that identifies you, or give us a public business contact who can confirm your role. Don’t include passwords or identity documents."
                    />
                  </label>
                )}
                <label className="claim-attest">
                  <input type="checkbox" required />
                  <span>
                    I’m authorized to manage this company’s public profile and
                    invite its employees.
                  </span>
                </label>
                <FormError error={task.error} />
                <button
                  className="button primary claim-action"
                  disabled={task.busy}
                >
                  {task.busy
                    ? "Submitting…"
                    : needsManual
                      ? "Request profile access"
                      : "Claim and edit profile"}
                  <ArrowRight size={15} />
                </button>
              </form>
              {!needsManual && (
                <button
                  className="text-button"
                  style={{ marginTop: 18 }}
                  onClick={() => setManual(true)}
                >
                  Request a manual review instead
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
