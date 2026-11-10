import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  FileText,
  MapPin,
  Search,
  Wrench,
  Zap,
  House,
  PenTool,
} from "lucide-react";
import { api } from "./api";
import type { Company } from "./types";

type Provider = Company & {
  trades: string[];
  project_types: string[];
  availability: string;
  crew_size: string;
  capacity: string;
  project_count: number;
  completed_jobs: number;
};
type Result = { providers: Provider[]; total: number; page: number };
const trades = ["Installation", "Electrical", "Roofing", "Service", "Design"];
const kinds = [
  "Installer",
  "EPC",
  "Contractor",
  "Service provider",
  "Manufacturer",
  "Distributor",
  "Developer",
];
const url = (c: Provider) => "/" + encodeURIComponent(c.username || c.slug);

export function ProviderDirectory() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [location, setLocation] = useState(params.get("location") || "");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const sample = params.get("sample") === "true";
  useEffect(() => {
    setQuery(params.get("q") || "");
    setLocation(params.get("location") || "");
  }, [params]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    api<Result>("/jobs/providers?" + params.toString(), {
      signal: controller.signal,
    })
      .then(setResult)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, retry]);
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    for (const [key, value] of [
      ["q", query.trim()],
      ["location", location.trim()],
    ])
      value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next);
  };
  return (
    <div className="jobs-page provider-directory">
      <div className="jobs-heading">
        <div>
          <h1>Find your next project partner.</h1>
          <p>
            Solar companies with the services, experience, and coverage you
            need.
          </p>
        </div>
      </div>
      <form className="provider-search" onSubmit={search}>
        <label>
          <Search size={19} />
          <input
            aria-label="Company or service"
            placeholder="Company or service"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <MapPin size={19} />
          <input
            aria-label="City or state"
            placeholder="City or state"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <button className="jobs-button jobs-primary" type="submit">
          Find companies <ArrowRight size={16} />
        </button>
      </form>
      <div className="provider-filters">
        <div className="provider-trades">
          <select
            aria-label="Service"
            value={params.get("trade") || ""}
            onChange={(e) => filter("trade", e.target.value)}
          >
            <option value="">All services</option>
            {trades.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Company type"
            value={params.get("kind") || ""}
            onChange={(e) => filter("kind", e.target.value)}
          >
            <option value="">All company types</option>
            {kinds.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {["q", "location", "trade", "kind"].some((k) => params.has(k)) && (
            <button
              className="job-text-button"
              onClick={() => setParams(sample ? { sample: "true" } : {})}
            >
              Clear filters
            </button>
          )}
        </div>
        <label className="sample-toggle">
          <input
            type="checkbox"
            checked={sample}
            onChange={(e) => filter("sample", e.target.checked ? "true" : "")}
          />
          Show demo companies
        </label>
      </div>
      <div className="provider-results-head" aria-live="polite">
        <span>
          {loading
            ? "Finding companies…"
            : `${result?.total.toLocaleString() || 0} ${sample ? "demo " : ""}companies`}
        </span>
        <span>
          {sample
            ? "Fictional companies for testing"
            : "Explore services, projects, and credentials"}
        </span>
      </div>
      {error ? (
        <div className="job-empty">
          <p role="alert" className="job-error">
            {error}
          </p>
          <button
            className="jobs-button jobs-secondary"
            onClick={() => setRetry((v) => v + 1)}
          >
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="provider-grid" aria-label="Loading companies">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="provider-card market-skeleton" key={i}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : result?.providers.length ? (
        <div className="provider-grid">
          {result.providers.map((c) => (
            <Link to={url(c)} className="provider-card" key={c.id}>
              <div className="provider-card-head">
                <span className="provider-card-logo">
                  {c.logo_url && (
                    <img
                      src={c.logo_url}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  )}
                </span>
                <span className="provider-card-type">{c.type}</span>
              </div>
              <h2>{c.name}</h2>
              <p className="provider-card-tagline">
                {c.tagline || c.description || c.type}
              </p>
              <div className="provider-card-meta">
                {c.location && (
                  <span>
                    <MapPin size={15} />
                    {c.location}
                  </span>
                )}
                <span>
                  <Wrench size={15} />
                  {(c.trades.length ? c.trades : c.services)
                    .slice(0, 3)
                    .join(" · ") || c.type}
                </span>
              </div>
              <div className="provider-card-bottom">
                <span>
                  {c.availability ? (
                    <>
                      <CalendarDays size={14} />
                      {c.availability}
                    </>
                  ) : c.project_count > 0 ? (
                    <>
                      <BriefcaseBusiness size={14} />
                      {c.project_count} projects
                    </>
                  ) : c.is_demo ? (
                    "Demo company"
                  ) : (
                    "Company profile"
                  )}
                </span>
                <b>
                  View profile <ArrowRight size={15} />
                </b>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="job-empty">
          <Search size={26} />
          <h2>No companies match yet</h2>
          <p>Try a nearby city, a broader service, or clear your filters.</p>
          <button
            className="jobs-button jobs-secondary"
            onClick={() => setParams(sample ? { sample: "true" } : {})}
          >
            Clear filters
          </button>
        </div>
      )}
      {!loading && result && result.total > 24 && (
        <nav className="market-pagination" aria-label="Company pages">
          <button
            className="jobs-button jobs-secondary"
            disabled={result.page === 1}
            onClick={() => filter("page", String(result.page - 1))}
          >
            <ArrowLeft size={16} />
            Previous
          </button>
          <span>
            Page {result.page} of {Math.ceil(result.total / 24)}
          </span>
          <button
            className="jobs-button jobs-secondary"
            disabled={result.page * 24 >= result.total}
            onClick={() => filter("page", String(result.page + 1))}
          >
            Next
            <ArrowRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}

const services = [
  {
    title: "Solar installation",
    detail: "Residential rooftops to commercial arrays",
    trade: "Installation",
    icon: House,
  },
  {
    title: "Electrical work",
    detail: "Wiring, interconnection, and commissioning",
    trade: "Electrical",
    icon: Zap,
  },
  {
    title: "Roofing",
    detail: "Prepare, repair, and protect the roof",
    trade: "Roofing",
    icon: Building2,
  },
  {
    title: "Service & maintenance",
    detail: "Keep systems performing at their best",
    trade: "Service",
    icon: Wrench,
  },
  {
    title: "Design & engineering",
    detail: "Plans, permits, and technical expertise",
    trade: "Design",
    icon: PenTool,
  },
  {
    title: "Explore all companies",
    detail: "Find the right specialist for your project",
    trade: "",
    icon: Search,
  },
];
export function MarketplaceLanding() {
  return (
    <div className="market-landing">
      <section className="market-hero">
        <div className="market-hero-copy">
          <span className="provider-overline">
            THE SOLAR INDUSTRY, WORKING TOGETHER
          </span>
          <h1>
            Good projects.
            <br />
            Great partners.
          </h1>
          <p>
            Find solar companies for the work ahead. Compare quotes, choose your
            team, and keep the project moving—all in one place.
          </p>
          <div className="market-hero-actions">
            <Link to="/providers" className="jobs-button jobs-primary">
              Find a company <ArrowRight size={18} />
            </Link>
            <Link to="/jobs" className="jobs-button jobs-secondary">
              Find work
            </Link>
          </div>
          <span className="market-byline">
            Built by Sunhub. Made for solar businesses.
          </span>
        </div>
        <div className="market-hero-visual">
          <img
            src="/assets/solar.jpg"
            alt="Solar panels catching the afternoon sun"
            fetchPriority="high"
          />
          <div className="market-photo-caption">
            <span className="market-photo-icon">
              <BriefcaseBusiness size={22} />
            </span>
            <div>
              <strong>From the first quote to the final panel.</strong>
              <span>The right people. A clear way forward.</span>
            </div>
          </div>
        </div>
      </section>
      <section className="market-services">
        <div className="market-section-heading">
          <div>
            <span className="provider-overline">FIND YOUR SPECIALIST</span>
            <h2>What needs to get done?</h2>
          </div>
          <Link to="/providers">
            Browse companies <ArrowRight size={16} />
          </Link>
        </div>
        <div className="market-service-grid">
          {services.map(({ title, detail, trade, icon: Icon }) => (
            <Link
              key={title}
              to={
                "/providers" +
                (trade ? "?trade=" + encodeURIComponent(trade) : "")
              }
            >
              <Icon size={25} />
              <h3>{title}</h3>
              <p>{detail}</p>
              <ArrowRight size={18} className="service-arrow" />
            </Link>
          ))}
        </div>
      </section>
      <section className="market-how" id="how-it-works">
        <div className="market-section-heading">
          <div>
            <span className="provider-overline">
              LESS BACK AND FORTH. MORE PROGRESS.
            </span>
            <h2>One place to get the job done.</h2>
          </div>
          <p>
            From finding the right company to agreeing on the final details,
            everyone knows what comes next.
          </p>
        </div>
        <div className="market-steps">
          {[
            {
              n: "01",
              icon: FileText,
              title: "Tell us about the work",
              text: "Share the scope, location, and timing. Add plans or photos so companies know exactly what you need.",
            },
            {
              n: "02",
              icon: UsersIcon,
              title: "Choose your company",
              text: "Compare prices, approaches, and availability. Explore past projects and ask questions before deciding.",
            },
            {
              n: "03",
              icon: Check,
              title: "Keep work moving",
              text: "Agree on the job, share progress, and review the finished work. Keep messages and files with the project.",
            },
          ].map(({ n, icon: Icon, title, text }) => (
            <article key={n}>
              <div>
                <span>{n}</span>
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <Link className="jobs-button jobs-primary" to="/jobs/new">
          Post your first job <ArrowRight size={16} />
        </Link>
      </section>
      <section className="market-provider-cta">
        <div>
          <span className="provider-overline">FOR COMPANIES READY TO GROW</span>
          <h2>
            Your next project
            <br />
            starts with being found.
          </h2>
          <p>
            Put your services, project experience, and coverage in front of
            companies looking for a team like yours.
          </p>
          <div className="market-hero-actions">
            <Link to="/claim" className="jobs-button jobs-primary">
              Find and claim your profile <ArrowRight size={17} />
            </Link>
            <Link to="/jobs" className="market-light-link">
              Explore available work <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="market-value-list">
          <p>
            <Wrench size={22} />
            <span>
              <b>Show what you do best</b>Bring your work, services, and
              credentials together.
            </span>
          </p>
          <p>
            <MapPin size={22} />
            <span>
              <b>Find work that fits</b>Search by the services you offer and
              where you work.
            </span>
          </p>
          <p>
            <BriefcaseBusiness size={22} />
            <span>
              <b>Turn a quote into a project</b>Have the conversation directly
              with the hiring company.
            </span>
          </p>
        </div>
      </section>
      <section className="market-faq">
        <div>
          <span className="provider-overline">A FEW THINGS TO KNOW</span>
          <h2>
            Built around
            <br />
            how you work.
          </h2>
        </div>
        <div>
          {[
            [
              "Who is Connect for?",
              "Solar businesses hiring other companies or looking for work: installers, EPCs, electrical and roofing contractors, and specialist service providers.",
            ],
            [
              "Can I both hire and find work?",
              "Yes. Use the same company account to post jobs and send quotes. My jobs keeps the work you hire for and the work you take on together.",
            ],
            [
              "Is my company already listed?",
              "It may be. Search for your company and claim its profile to manage the information. If it isn’t listed, you can create a company profile when you join.",
            ],
            [
              "How do quotes and payments work?",
              "Quotes are private between the hiring company and the provider. Payments happen directly between the companies; Connect lets you record payment stages and confirm their status.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <footer className="market-footer">
        <Link to="/" className="market-footer-brand">
          <img src="/assets/connect-icon.png" alt="" />
          connect <small>by Sunhub</small>
        </Link>
        <nav aria-label="Footer">
          <Link to="/providers">Find companies</Link>
          <Link to="/jobs">Find work</Link>
          <Link to="/jobs/new">Post a job</Link>
          <Link to="/claim">Claim a profile</Link>
        </nav>
        <span>Connect. Talk. Build.</span>
      </footer>
    </div>
  );
}
const UsersIcon = Building2;
