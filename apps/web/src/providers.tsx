import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  MapPin,
  Search,
  Star,
  Wrench,
} from "lucide-react";
import { api } from "./api";
import type { Company } from "./types";
import "./providers.css";

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
  const sample = params.get("sample") === "true";
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api<Result>("/jobs/providers?" + params.toString(), {
      signal: controller.signal,
    })
      .then(setResult)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [params]);
  const search = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    for (const [key, value] of [
      ["q", query],
      ["location", location],
    ])
      value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next);
  };
  const chooseTrade = (trade: string) => {
    const next = new URLSearchParams(params);
    trade ? next.set("trade", trade) : next.delete("trade");
    next.delete("page");
    setParams(next);
  };
  const chooseKind = (kind: string) => {
    const next = new URLSearchParams(params);
    kind ? next.set("kind", kind) : next.delete("kind");
    next.delete("page");
    setParams(next);
  };
  const chooseSample = (value: boolean) => {
    const next = new URLSearchParams();
    if (value) next.set("sample", "true");
    setQuery("");
    setLocation("");
    setParams(next);
  };
  return (
    <div className="jobs-page provider-directory">
      <div className="provider-intro">
        <div>
          <span className="provider-overline">THE PEOPLE WHO GET IT BUILT</span>
          <h1>Find the right crew for the work.</h1>
          <p>
            Explore solar installers, EPCs, specialist contractors and
            suppliers. See what they do, where they work and the projects behind
            their profile.
          </p>
        </div>
        <Link className="jobs-button jobs-primary" to="/jobs/new">
          Post a job <ArrowRight size={17} />
        </Link>
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
          {["", ...trades].map((trade) => (
            <button
              key={trade}
              className={(params.get("trade") || "") === trade ? "active" : ""}
              onClick={() => chooseTrade(trade)}
            >
              {trade || "All services"}
            </button>
          ))}
          <select
            aria-label="Company type"
            value={params.get("kind") || ""}
            onChange={(e) => chooseKind(e.target.value)}
          >
            <option value="">All company types</option>
            {kinds.map((kind) => (
              <option value={kind} key={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
        <div className="provider-sample-switch">
          <button
            className={!sample ? "active" : ""}
            onClick={() => chooseSample(false)}
          >
            Real providers
          </button>
          <button
            className={sample ? "active" : ""}
            onClick={() => chooseSample(true)}
          >
            Demo examples
          </button>
        </div>
      </div>
      <div className="provider-results-head">
        <span>
          {result ? result.total.toLocaleString() : "…"}{" "}
          {sample ? "demo" : "solar"} companies
        </span>
        {sample && <strong>Sample profiles for product testing</strong>}
      </div>
      {error ? (
        <p className="job-error">{error}</p>
      ) : !result ? (
        <div className="job-loading">Finding providers…</div>
      ) : result.providers.length ? (
        <div className="provider-grid">
          {result.providers.map((c) => (
            <Link to={url(c)} className="provider-card" key={c.id}>
              <div className="provider-card-head">
                <span className="provider-card-logo">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" />
                  ) : (
                    <Building2 size={25} />
                  )}
                </span>
                <span className="provider-card-type">
                  {c.is_demo ? "DEMO" : c.type}
                </span>
              </div>
              <h2>{c.name}</h2>
              <p className="provider-card-tagline">
                {c.tagline || c.description || "Solar services"}
              </p>
              <div className="provider-card-meta">
                <span>
                  <MapPin size={15} />
                  {c.location || "Location on request"}
                </span>
                <span>
                  <Wrench size={15} />
                  {(c.trades.length ? c.trades : c.services)
                    .slice(0, 2)
                    .join(" · ") || c.type}
                </span>
              </div>
              <div className="provider-card-bottom">
                {c.availability ? (
                  <span>
                    <CheckCircle2 size={15} />
                    {c.availability}
                  </span>
                ) : c.project_count > 0 ? (
                  <span>
                    <BriefcaseBusiness size={15} />
                    {c.project_count} project{c.project_count === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span>View services and coverage</span>
                )}
                <b>
                  View profile <ArrowRight size={15} />
                </b>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="job-empty">
          <Search size={27} />
          <h3>No providers found</h3>
          <p>Try another service or location.</p>
        </div>
      )}
      {result && result.total > result.page * 24 && (
        <button
          className="jobs-button jobs-secondary provider-more"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set("page", String(result.page + 1));
            setParams(next);
          }}
        >
          Next page <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}

export function MarketplaceLanding() {
  return (
    <div className="market-landing">
      <section className="market-hero">
        <div className="market-hero-copy">
          <span className="provider-overline">CONNECT BY SUNHUB</span>
          <h1>Find the people who move solar projects forward.</h1>
          <p>
            Post work, compare quotes and hire trusted solar service providers
            in one clear place.
          </p>
          <div className="market-hero-actions">
            <Link to="/jobs" className="jobs-button jobs-primary">
              Find work <ArrowRight size={18} />
            </Link>
            <Link to="/providers" className="jobs-button jobs-secondary">
              Find a company
            </Link>
          </div>
          <div className="market-hero-proof">
            <span>
              <CheckCircle2 size={17} /> Built for solar work
            </span>
            <span>
              <CheckCircle2 size={17} /> Company to company
            </span>
            <span>
              <CheckCircle2 size={17} /> Clear quotes and updates
            </span>
          </div>
        </div>
        <div className="market-hero-preview">
          <div className="market-preview-top">
            <span>OPEN PROJECT</span>
            <BriefcaseBusiness size={23} />
          </div>
          <h2>Commercial rooftop installation</h2>
          <p>Installation crews needed for a multi-site rollout.</p>
          <div>
            <span>
              <MapPin size={15} /> Austin, TX
            </span>
            <span>Installation</span>
          </div>
          <div className="market-preview-footer">
            <span>Compare companies and quotes</span>
            <ArrowRight size={20} />
          </div>
        </div>
      </section>
      <section className="market-paths">
        <article>
          <span>01 / HIRE</span>
          <h2>Need work done?</h2>
          <p>
            Describe the job once. Invite companies or compare the quotes that
            come in.
          </p>
          <Link to="/jobs/new">
            Post a job <ArrowRight size={16} />
          </Link>
        </article>
        <article>
          <span>02 / FIND WORK</span>
          <h2>Have a crew?</h2>
          <p>
            Find projects that fit your services and area. Send a detailed quote
            directly to the hiring company.
          </p>
          <Link to="/jobs">
            Explore jobs <ArrowRight size={16} />
          </Link>
        </article>
        <article>
          <span>03 / GET FOUND</span>
          <h2>Show your work.</h2>
          <p>
            Your provider profile brings together services, projects, coverage
            and Connect job reviews.
          </p>
          <Link to="/providers">
            Explore providers <ArrowRight size={16} />
          </Link>
        </article>
      </section>
      <section className="market-final">
        <Star size={25} />
        <h2>Connect. Talk. Build.</h2>
        <p>Every project starts with the right conversation.</p>
        <Link to="/providers" className="jobs-button jobs-primary">
          Explore service providers <ArrowRight size={17} />
        </Link>
      </section>
    </div>
  );
}
