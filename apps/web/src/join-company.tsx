import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  LoaderCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import { FormError, useAction } from "./management";
import type { Company, Session } from "./types";
import "./join-company.css";

type Welcome = {
  company: Company;
  invitation: { role: string; expires_at: string } | null;
  member: boolean;
};

export function JoinCompanyPage() {
  const { username } = useParams(),
    navigate = useNavigate();
  const { session, setSession, refresh, revision, signIn, toast } = useApp();
  const [welcome, setWelcome] = useState<Welcome | null>(null),
    [error, setError] = useState("");
  const task = useAction();
  useEffect(() => {
    let cancelled = false;
    setWelcome(null);
    setError("");
    api<Welcome>("/join/" + encodeURIComponent(username || ""))
      .then((value) => {
        if (!cancelled) setWelcome(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [username, session.user?.id, revision]);
  if (error)
    return (
      <section className="company-welcome">
        <h1>This welcome link isn’t available.</h1>
        <p>{error}</p>
        <Link className="button" to="/directory">
          Explore companies
        </Link>
      </section>
    );
  if (!welcome)
    return (
      <section className="company-welcome">
        <LoaderCircle className="spin" aria-label="Loading invitation" />
      </section>
    );
  const { company, invitation, member } = welcome;
  const profile = company.username
    ? "/" + company.username
    : "/company/" + company.slug;
  return (
    <section className="company-welcome">
      <div className="welcome-company">
        <Logo company={company} size="large" />
        <span>
          <strong>{company.name}</strong>
          <small>{company.location}</small>
        </span>
      </div>
      <div className="welcome-body">
        <span className="welcome-eyebrow">GOOD WORK STARTS TOGETHER</span>
        <h1>
          {member ? (
            "You’re already part of the team."
          ) : (
            <>
              Your place at
              <br />
              {company.name}.
            </>
          )}
        </h1>
        <p>
          {member
            ? "Your company profile and shared workspace are ready."
            : "One company. Your own login. A place to connect, talk, and celebrate together."}
        </p>
        <div className="welcome-access">
          <Users size={23} />
          <div>
            <strong>
              {invitation?.role === "admin"
                ? "Administrator access"
                : invitation
                  ? "Shared inbox access"
                  : "A welcome for your team"}
            </strong>
            <p>
              {invitation?.role === "admin"
                ? "Publish stories, shape the company profile, and manage your team and conversations."
                : invitation
                  ? "Read and reply to company conversations with your teammates."
                  : "Sign in with the work email your company invited. New here? Create a company account with that same email."}
            </p>
          </div>
        </div>
        <FormError error={task.error} />
        {!session.user ? (
          <button className="button primary" onClick={signIn}>
            Sign in or create an account <ArrowRight size={17} />
          </button>
        ) : member ? (
          <button
            className="button primary"
            disabled={task.busy}
            onClick={() =>
              void task.run(async () => {
                setSession(
                  await post<Session>("/session/company", {
                    companyId: company.id,
                  }),
                );
                refresh();
                navigate(profile);
              })
            }
          >
            Open company profile <ArrowRight size={17} />
          </button>
        ) : session.user.account_type === "individual" ? (
          <div className="welcome-feedback">
            Employee access needs a company account. Sign out and use your
            invited work account to continue.
          </div>
        ) : invitation ? (
          <>
            <p className="welcome-signed-in">
              Joining as <strong>{session.user.email}</strong>
            </p>
            <button
              className="button primary"
              disabled={task.busy}
              onClick={() =>
                void task.run(async () => {
                  setSession(
                    await post<Session>(
                      "/join/" + encodeURIComponent(username || "") + "/accept",
                      {},
                    ),
                  );
                  refresh();
                  toast("Welcome to " + company.name + ". You’re all set.");
                  navigate(profile);
                })
              }
            >
              {task.busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Check size={17} />
              )}
              Join {company.name}
            </button>
          </>
        ) : (
          <div className="welcome-feedback">
            There’s no active invitation for{" "}
            <strong>{session.user.email}</strong>. Use your invited work email,
            or ask {company.name} to invite you again.
          </div>
        )}
        <small className="welcome-security">
          <ShieldCheck size={16} />
          Only invited, verified email addresses can get access.
        </small>
        <Link className="welcome-profile" to={profile}>
          Visit the company profile <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
