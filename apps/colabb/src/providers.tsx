import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  MapPin,
  Search,
  Wrench,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
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
const trades = [
  "Crews",
  "Installation",
  "Electrical",
  "Roofing",
  "Service",
  "Design",
  "Permitting",
  "Inspection",
  "Equipment",
  "Logistics",
];
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
  const { company } = useApp();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [location, setLocation] = useState(params.get("location") || "");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const sample = params.has("sample")
    ? params.get("sample") === "true"
    : !!company?.is_demo;
  useEffect(() => {
    setQuery(params.get("q") || "");
    setLocation(params.get("location") || "");
  }, [params]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    const query = new URLSearchParams(params);
    query.set("sample", String(sample));
    api<Result>("/jobs/providers?" + query.toString(), {
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
  }, [params, sample, retry]);
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
      <div className="jobs-heading market-page-heading">
        <div>
          <span className="editorial-label">EXPERTISE FOR THE WORK AHEAD</span>
          <h1>Find companies.</h1>
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
              onClick={() => setParams({ sample: String(sample) })}
            >
              Clear filters
            </button>
          )}
        </div>
        <label className="sample-toggle">
          <input
            type="checkbox"
            checked={sample}
            onChange={(e) => filter("sample", String(e.target.checked))}
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

export { MarketplaceLanding } from "./marketplace-landing";
