import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { companyTypes } from "../../../api/src/shared/company-types";
import { useApp } from "../context";
import { Logo } from "../identity";
import type { Company } from "../types";
import { BrandIcon as Icon } from "./icons";
import "./companies-reference.css";
import "./company-cards.css";

type Credential = {
  value: string;
  label: string;
  organization: string;
  scope: string;
  count: number;
};
type Provider = Company & {
  certifications?: { id: string; title: string; scope: string }[];
  certification_count?: number;
  trades: string[];
  availability: string;
  completed_jobs: number;
  project_count: number;
  on_colabb?: boolean;
  job_rating?: number;
  job_review_count?: number;
  project_types?: string[];
  latestProject?: {
    name: string;
    description: string;
    location: string;
    image_url?: string;
  } | null;
};
const services = [
  ["", "All services", "company"],
  ["Installation", "Installation", "solar-panel"],
  ["Electrical", "Electrical work", "electrical"],
  ["Crews", "Crews", "crew"],
  ["Equipment", "Equipment", "equipment"],
  ["Service", "Maintenance", "tools"],
  ["Design", "Design", "document"],
  ["Inspection", "Inspection", "checklist"],
  ["Roofing", "Roofing", "work"],
  ["Permitting", "Permitting", "document"],
  ["Logistics", "Logistics", "equipment"],
];
export function ColabbCompanies() {
  const { company } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [area, setArea] = useState(params.get("location") || "");
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<{
      providers: Provider[];
      total: number;
      page: number;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const selectedCredentials = (params.get("credentials") || "")
    .split(",")
    .filter(Boolean);
  const sample = params.has("sample")
    ? params.get("sample") === "true"
    : !!company?.is_demo;
  useEffect(() => {
    const c = new AbortController();
    api<{ directoryCredentials: Credential[] }>(
      "/jobs/provider-taxonomy?sample=" + sample,
      { signal: c.signal },
    )
      .then((v) => setCredentials(v.directoryCredentials || []))
      .catch(() => {});
    return () => c.abort();
  }, [sample]);
  useEffect(() => {
    setQ(params.get("q") || "");
    setArea(params.get("location") || "");
  }, [params]);
  useEffect(() => {
    const c = new AbortController();
    const query = new URLSearchParams(params);
    query.set("sample", String(sample));
    setLoading(true);
    setError("");
    api<{ providers: Provider[]; total: number; page: number }>(
      "/jobs/providers?" + query,
      { signal: c.signal },
    )
      .then(setResult)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [params, sample, retry]);
  function filter(k: string, v: string) {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    if (k !== "page") n.delete("page");
    setParams(n);
  }
  function search(e: FormEvent) {
    e.preventDefault();
    const n = new URLSearchParams(params);
    for (const [k, v] of [
      ["q", q.trim()],
      ["location", area.trim()],
    ])
      v ? n.set(k, v) : n.delete(k);
    n.delete("page");
    setParams(n);
  }
  return (
    <div className="pd-page cd-page">
      <header className="cd-heading">
        <div>
          <p className="pd-eyebrow">COMPANIES</p>
          <h1>Find a company for the work.</h1>
          <p>
            Explore services, relevant experience and the places companies work.
          </p>
        </div>
        <div className="cd-start">
          <span>Have a scope ready?</span>
          <Link className="cd-button" to="/jobs/new">
            Post a job
            <Icon name="post-job" size={17} />
          </Link>
        </div>
      </header>
      <form className="cd-search-form" onSubmit={search} role="search">
        <label className="cd-search-field">
          <Icon name="search" size={21} />
          <span className="cd-sr-only">Company or service</span>
          <input
            type="search"
            maxLength={160}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company or service"
          />
        </label>
        <button className="cd-button cd-primary" type="submit" aria-label="Search companies">
          <span>Search companies</span>
          <Icon name="arrow-right" size={17} />
        </button>
      </form>
      <nav className="cd-services" aria-label="Filter by service">
        {services.map(([value, label, icon]) => (
          <button
            key={value}
            aria-pressed={(params.get("trade") || "") === value}
            onClick={() => filter("trade", value)}
          >
            <Icon name={icon} size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="cd-layout">
        <aside
          className={"cd-sidebar" + (expanded ? " is-open" : "")}
          aria-label="Company filters"
        >
          <button
            className="cd-filter-toggle"
            aria-expanded={expanded}
            aria-controls="company-filters"
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="filters" size={17} />
            Filters
            <Icon name="chevron-down" size={16} />
          </button>
          <div className="cd-filter-panel" id="company-filters">
            <div className="cd-filter-title">
              <h2>Narrow the search</h2>
              <button onClick={() => setParams({ sample: String(sample) })}>
                Reset
              </button>
            </div>
            <form onSubmit={search}>
              <label className="colabb-area-filter">
                City, state or service area
                <input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Ohio"
                />
                <button className="cd-button" type="submit">
                  Apply location
                </button>
              </label>
            </form>
            <fieldset>
              <legend>Company profile</legend>
              {[
                ["", "All companies"],
                ["managed", "On Colabb"],
                ["unclaimed", "Public listings"],
              ].map(([v, t]) => (
                <button
                  type="button"
                  className="cd-filter-option"
                  key={v}
                  aria-pressed={(params.get("participation") || "") === v}
                  onClick={() => filter("participation", v)}
                >
                  <span className="cd-radio" aria-hidden="true" />
                  <span>{t}</span>
                </button>
              ))}
            </fieldset>
            <fieldset>
              <legend>Company type</legend>
              <select
                aria-label="Company type"
                value={params.get("kind") || ""}
                onChange={(e) => filter("kind", e.target.value)}
              >
                <option value="">All company types</option>
                {companyTypes.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </fieldset>
            <fieldset className="cd-certifications">
              <legend>Certifications</legend>
              <p>Match any selected certification.</p>
              <details>
                <summary>
                  {selectedCredentials.length
                    ? `${selectedCredentials.length} selected`
                    : "Choose certifications"}
                  <Icon name="chevron-down" size={16} />
                </summary>
                <div className="cd-certification-options">
                  {credentials.length ? (
                    credentials.map((c) => (
                      <label key={c.value}>
                        <input
                          type="checkbox"
                          checked={selectedCredentials.includes(c.value)}
                          onChange={(e) =>
                            filter(
                              "credentials",
                              (e.target.checked
                                ? [...selectedCredentials, c.value]
                                : selectedCredentials.filter(
                                    (v) => v !== c.value,
                                  )
                              ).join(","),
                            )
                          }
                        />
                        <span>
                          {c.label}
                          {c.scope !== "company" && (
                            <small>
                              {c.scope === "personnel"
                                ? "Qualified personnel"
                                : "Product certification"}
                            </small>
                          )}
                        </span>
                        <small>{c.count}</small>
                      </label>
                    ))
                  ) : (
                    <p>
                      No certifications are available for this set of companies.
                    </p>
                  )}
                </div>
              </details>
              {selectedCredentials.length > 0 && (
                <button
                  className="pd-quiet"
                  onClick={() => filter("credentials", "")}
                >
                  Clear certifications
                </button>
              )}
            </fieldset>
            <label className="sample-toggle">
              <input
                type="checkbox"
                checked={sample}
                onChange={(e) => filter("sample", String(e.target.checked))}
              />
              Show demo companies
            </label>
            <div className="cd-identity-note">
              <Icon name="info" size={18} />
              <div>
                <strong>What “On Colabb” means</strong>
                <p>
                  A managed company account. Review experience and credentials
                  for your job.
                </p>
              </div>
            </div>
          </div>
          <div className="cd-scope-note">
            <Icon name="proposal" size={22} />
            <h2>Make the first conversation useful.</h2>
            <p>
              Share the scope, location and timing. Confirm the details together
              before choosing a company.
            </p>
            <Link to="/jobs/new" className="pd-quiet">
              Post a job
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </aside>
        <section className="cd-results" aria-label="Companies">
          <div className="cd-results-heading">
            <div>
              <h2>
                {loading
                  ? "Finding companies…"
                  : `${(result?.total || 0).toLocaleString()} companies`}
              </h2>
              <p>
                {sample
                  ? "Fictional companies for testing"
                  : "Company profiles, work and experience"}
              </p>
            </div>
          </div>
          {error ? (
            <div className="cd-empty">
              <h3>We couldn’t load companies.</h3>
              <p role="alert">{error}</p>
              <button
                className="cd-button"
                onClick={() => setRetry((v) => v + 1)}
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="cd-company-list" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <article key={n} className="cd-company market-skeleton">
                  <span />
                  <span />
                  <span />
                </article>
              ))}
            </div>
          ) : result?.providers.length ? (
            <div className="cd-company-list">
              {result.providers.map((c) => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  ownCompanyId={company?.id}
                />
              ))}
            </div>
          ) : (
            <div className="cd-empty">
              <Icon name="search" size={30} />
              <h3>No companies match yet.</h3>
              <p>Try a wider area or another service.</p>
              <button
                className="cd-button"
                onClick={() => setParams({ sample: String(sample) })}
              >
                Clear filters
              </button>
            </div>
          )}
          {result && result.total > 24 && (
            <nav className="market-pagination" aria-label="Company pages">
              <button
                className="cd-button"
                disabled={result.page === 1}
                onClick={() => filter("page", String(result.page - 1))}
              >
                Previous
              </button>
              <span>
                Page {result.page} of {Math.ceil(result.total / 24)}
              </span>
              <button
                className="cd-button"
                disabled={result.page * 24 >= result.total}
                onClick={() => filter("page", String(result.page + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}

const profileUrl = (c: Company) =>
  "/" + encodeURIComponent(c.username || c.slug);
const distinct = (values: string[] = []) => [
  ...new Map(
    values
      .filter(Boolean)
      .map((value) => [value.trim().toLowerCase(), value.trim()]),
  ).values(),
];

function CompanyCard({
  company: c,
  ownCompanyId,
}: {
  company: Provider;
  ownCompanyId?: string;
}) {
  const href = profileUrl(c);
  const services = distinct(c.services?.length ? c.services : c.trades);
  const areas = distinct(c.service_areas);
  const projectTypes = distinct(c.project_types);
  const description = c.tagline?.trim() || c.description?.trim();
  const hasRecord =
    Number(c.job_review_count) > 0 ||
    c.completed_jobs > 0 ||
    c.project_count > 0;
  return (
    <article className="cd-company">
      <header className="cd-company-head">
        <Link
          className="cd-company-logo"
          to={href}
          aria-label={`${c.name} profile`}
        >
          <Logo company={c} />
        </Link>
        <div className="cd-company-heading">
          <h3>
            <Link to={href}>{c.name}</Link>
          </h3>
          <p className="cd-company-meta">
            {c.type && <span>{c.type}</span>}
            {c.location && (
              <span>
                <Icon name="location" size={14} />
                {c.location}
              </span>
            )}
          </p>
        </div>
        <span
          className={
            "cd-identity" + (c.on_colabb === true ? " cd-managed" : "")
          }
          title={
            c.on_colabb === true
              ? "A managed company account. Review qualifications separately."
              : "Public company information. This company has not joined Colabb."
          }
        >
          {c.on_colabb === true && (
            <img
              src="/brand/badges/on-colabb.svg"
              alt=""
              width={18}
              height={18}
            />
          )}
          {c.on_colabb === true ? "On Colabb" : "Public listing"}
        </span>
      </header>
      {description && <p className="cd-description">{description}</p>}
      {(services.length > 0 || areas.length > 0 || projectTypes.length > 0) && (
        <div className="cd-card-details">
          {services.length > 0 && (
            <div className="cd-service-summary">
              <h4>What they do</h4>
              <ul className="cd-service-chips">
                {services.slice(0, 3).map((service) => (
                  <li key={service}>{service}</li>
                ))}
                {services.length > 3 && (
                  <li className="cd-more-services">
                    <Link to={href + "#services"}>
                      +{services.length - 3} more
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          )}
          {(areas.length > 0 || projectTypes.length > 0) && (
            <dl className="cd-company-facts">
              {areas.length > 0 && (
                <div>
                  <dt>
                    <Icon name="location" size={15} />
                    Works in
                  </dt>
                  <dd>
                    {areas.slice(0, 3).join(" · ")}
                    {areas.length > 3 && (
                      <Link to={href + "#services"} className="cd-fact-more">
                        +{areas.length - 3} areas
                      </Link>
                    )}
                  </dd>
                </div>
              )}
              {projectTypes.length > 0 && (
                <div>
                  <dt>
                    <Icon name="work" size={15} />
                    Project types
                  </dt>
                  <dd>
                    {projectTypes.slice(0, 2).join(" · ")}
                    {projectTypes.length > 2 && (
                      <Link to={href + "#services"} className="cd-fact-more">
                        +{projectTypes.length - 2} more
                      </Link>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
      {!!c.certifications?.length && (
        <div className="cd-company-certifications">
          <span className="cd-credential-label">
            <Icon name="credential" size={17} />
            Credentials
          </span>
          <ul>
            {c.certifications.slice(0, 2).map((credential) => (
              <li key={credential.id}>
                {credential.title}
                {credential.scope === "personnel" && <small>Personnel qualification</small>}
                {credential.scope === "product" && <small>Product certification</small>}
              </li>
            ))}
            {(c.certification_count || 0) > 2 && (
              <li>
                <Link to={href + "#credentials"}>
                  +{(c.certification_count || 0) - 2} more
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}
      {c.latestProject && (
        <Link className="cd-work" to={href + "#recent-work"}>
          {c.latestProject.image_url && (
            <span className="cd-work-image">
              <img src={c.latestProject.image_url} alt="" loading="lazy" />
            </span>
          )}
          <span className="cd-work-copy">
            <small>RECENT WORK</small>
            <strong>{c.latestProject.name}</strong>
            <span>{c.latestProject.location}</span>
          </span>
          <Icon name="arrow-right" size={16} />
        </Link>
      )}
      <footer className="cd-company-footer">
        <div className="cd-card-status">
          {hasRecord && (
            <div className="cd-record-row">
              {Number(c.job_review_count) > 0 ? (
                <Link className="cd-review-link" to={href + "#company-reviews"}>
                  <Icon name="rating" size={15} />
                  <strong>{Number(c.job_rating).toFixed(1)}</strong>
                  <span>
                    {c.job_review_count}{" "}
                    {c.job_review_count === 1 ? "job review" : "job reviews"}
                  </span>
                </Link>
              ) : (
                <span className="cd-listing-note">
                  {c.completed_jobs > 0
                    ? `${c.completed_jobs} completed ${c.completed_jobs === 1 ? "job" : "jobs"}`
                    : `${c.project_count} project ${c.project_count === 1 ? "example" : "examples"}`}
                </span>
              )}
            </div>
          )}
          {c.availability?.trim() && (
            <span className="cd-availability">
              <Icon name="calendar" size={15} />
              {c.availability}
            </span>
          )}
        </div>
        <div className="cd-company-actions">
          <Link className="cd-button" to={href}>
            View company
            <Icon name="arrow-right" size={16} />
          </Link>
          {c.on_colabb === true && c.id !== ownCompanyId && (
            <Link className="cd-button cd-primary" to={href + "?action=invite"}>
              <Icon name="invite" size={16} />
              Invite to a job
            </Link>
          )}
        </div>
      </footer>
    </article>
  );
}
