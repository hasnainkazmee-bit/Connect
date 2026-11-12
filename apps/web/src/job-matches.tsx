import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  ChevronDown,
  MapPin,
  Pencil,
  MessageCircle,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import "./job-matches.css";
import { matchFit, type Match, type Matches } from "./match-fit";
import { MatchCompanyLogo } from "./match-company-logo";

export type MatchingPreferences = {
  kind: string;
  categoryId: string;
  countryCode: string;
  stateCode: string;
  city?: string;
  sector?: string;
  systemType?: string;
  delivery?: string;
  preferredCredentials: { title: string; scope: string }[];
  preferAvailable: boolean;
  preferLocal?: boolean;
  preferredStart?: string;
};
export const emptyMatching: MatchingPreferences = {
  kind: "service",
  categoryId: "",
  countryCode: "US",
  stateCode: "",
  preferredCredentials: [],
  preferAvailable: true,
  preferLocal: true,
};
export const tradeService: Record<string, string> = {
  installation: "solar-installation",
  crew: "crew-supply",
  electrical: "electrical",
  roofing: "roofing",
  service: "solar-maintenance",
  design: "solar-design",
  permitting: "permitting",
  inspection: "inspection",
  equipment: "equipment-supply",
  logistics: "logistics",
};
const states =
  "AL|Alabama;AK|Alaska;AZ|Arizona;AR|Arkansas;CA|California;CO|Colorado;CT|Connecticut;DE|Delaware;DC|District of Columbia;FL|Florida;GA|Georgia;HI|Hawaii;ID|Idaho;IL|Illinois;IN|Indiana;IA|Iowa;KS|Kansas;KY|Kentucky;LA|Louisiana;ME|Maine;MD|Maryland;MA|Massachusetts;MI|Michigan;MN|Minnesota;MS|Mississippi;MO|Missouri;MT|Montana;NE|Nebraska;NV|Nevada;NH|New Hampshire;NJ|New Jersey;NM|New Mexico;NY|New York;NC|North Carolina;ND|North Dakota;OH|Ohio;OK|Oklahoma;OR|Oregon;PA|Pennsylvania;RI|Rhode Island;SC|South Carolina;SD|South Dakota;TN|Tennessee;TX|Texas;UT|Utah;VT|Vermont;VA|Virginia;WA|Washington;WV|West Virginia;WI|Wisconsin;WY|Wyoming;AS|American Samoa;GU|Guam;MP|Northern Mariana Islands;PR|Puerto Rico;VI|US Virgin Islands";
const provinces =
  "AB|Alberta;BC|British Columbia;MB|Manitoba;NB|New Brunswick;NL|Newfoundland and Labrador;NS|Nova Scotia;NT|Northwest Territories;NU|Nunavut;ON|Ontario;PE|Prince Edward Island;QC|Quebec;SK|Saskatchewan;YT|Yukon";
type Taxonomy = {
  categories: { kind: string; id: string; label: string }[];
  credentials: { title: string; scope: string }[];
};
export function MatchingFields({
  value,
  onChange,
}: {
  value: MatchingPreferences;
  onChange: (v: MatchingPreferences) => void;
}) {
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<Taxonomy>("/jobs/provider-taxonomy", { signal: c.signal })
      .then(setTaxonomy)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const set = (fields: Partial<MatchingPreferences>) =>
    onChange({ ...value, ...fields });
  return (
    <section
      className="matching-fields"
      aria-labelledby="matching-fields-heading"
    >
      <div>
        <SlidersHorizontal size={19} />
        <h2 id="matching-fields-heading">Find the right companies</h2>
      </div>
      <p>
        Choose the service and area. You’ll see company matches after
        publishing.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="jobs-fields-two">
        <label>
          Service or product
          <select
            aria-label="Service or product to match"
            value={value.categoryId ? `${value.kind}:${value.categoryId}` : ""}
            onChange={(e) => {
              const [kind, categoryId] = e.target.value.split(":");
              set({
                kind: kind || "service",
                categoryId: categoryId || "",
                delivery: undefined,
                systemType: undefined,
              });
            }}
          >
            <option value="">Choose a service or product</option>
            {!taxonomy && value.categoryId && (
              <option value={`${value.kind}:${value.categoryId}`}>
                Loading services…
              </option>
            )}
            {["service", "product"].map((kind) => (
              <optgroup
                key={kind}
                label={kind === "service" ? "Services" : "Products & equipment"}
              >
                {taxonomy?.categories
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <option key={c.id} value={`${kind}:${c.id}`}>
                      {c.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Country
          <select
            aria-label="Matching country"
            value={value.countryCode}
            onChange={(e) =>
              set({ countryCode: e.target.value, stateCode: "" })
            }
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
          </select>
        </label>
        <label>
          {value.countryCode === "US" ? "State" : "Province or territory"}
          <select
            aria-label="Matching state or province"
            required={!!value.categoryId}
            value={value.stateCode}
            onChange={(e) => set({ stateCode: e.target.value })}
          >
            <option value="">Choose the job’s state or province</option>
            {(value.countryCode === "US" ? states : provinces)
              .split(";")
              .map((s) => {
                const [code, name] = s.split("|");
                return (
                  <option key={code} value={code}>
                    {name}
                  </option>
                );
              })}
          </select>
        </label>
        <label>
          <span>
            System type <small className="field-optional">(optional)</small>
          </span>
          <select
            aria-label="System type to match"
            value={value.systemType || ""}
            onChange={(e) => set({ systemType: e.target.value || undefined })}
          >
            <option value="">Any system</option>
            {[
              ["rooftop", "Rooftop"],
              ["ground-mount", "Ground mount"],
              ["carport", "Carport"],
              ["tracking", "Tracking"],
              ["fixed-tilt", "Fixed tilt"],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details>
        <summary>
          Company preferences <span>Optional</span>
        </summary>
        <div className="matching-preferences">
          {value.kind === "service" && (
            <label>
              How should the work be delivered?
              <select
                aria-label="Delivery preference"
                value={value.delivery || ""}
                onChange={(e) => set({ delivery: e.target.value || undefined })}
              >
                <option value="">Any approach</option>
                <option value="turnkey">Complete installation / turnkey</option>
                <option value="labor-only">Labor only</option>
                <option value="specialist-service">Specialist service</option>
                <option value="contract-staff">Contract staff</option>
                <option value="advisory">Advice or consulting</option>
                <option value="managed-project">Project management</option>
                <option value="supply">Supply</option>
              </select>
            </label>
          )}
          <label>
            Preferred certifications
            <select
              aria-label="Add preferred certification"
              value=""
              disabled={value.preferredCredentials.length >= 8}
              onChange={(e) => {
                const c = taxonomy?.credentials[Number(e.target.value)];
                if (
                  c &&
                  !value.preferredCredentials.some(
                    (v) => v.title === c.title && v.scope === c.scope,
                  )
                )
                  set({
                    preferredCredentials: [...value.preferredCredentials, c],
                  });
              }}
            >
              <option value="">Add a certification</option>
              {taxonomy?.credentials.map((c, i) => (
                <option key={c.title + c.scope} value={i}>
                  {c.title}
                  {c.scope === "personnel"
                    ? " · Personnel"
                    : c.scope === "product"
                      ? " · Product"
                      : ""}
                </option>
              ))}
            </select>
          </label>
          {!!value.preferredCredentials.length && (
            <div className="match-preference-tags">
              {value.preferredCredentials.map((c, i) => (
                <button
                  key={c.title + c.scope}
                  type="button"
                  onClick={() =>
                    set({
                      preferredCredentials: value.preferredCredentials.filter(
                        (_, n) => n !== i,
                      ),
                    })
                  }
                >
                  {c.title}
                  <X size={14} />
                  <span className="sr-only">Remove</span>
                </button>
              ))}
            </div>
          )}
          <p className="job-muted">
            These preferences help order results. You can still consider
            companies without them.
          </p>
          {value.kind === "service" && (
            <label className="match-checkbox">
              <input
                type="checkbox"
                checked={value.preferLocal !== false}
                onChange={(e) => set({ preferLocal: e.target.checked })}
              />
              Prioritize companies based in the job’s state or province
            </label>
          )}
          {value.kind === "service" && (
            <label className="match-checkbox">
              <input
                type="checkbox"
                checked={value.preferAvailable}
                onChange={(e) => set({ preferAvailable: e.target.checked })}
              />
              Prioritize companies with recently confirmed availability
            </label>
          )}
        </div>
      </details>
    </section>
  );
}
function readableReason(reason: string, location: string) {
  if (reason === "Serves the job location") return `Serves ${location}`;
  if (reason === "Based in the job’s state or province")
    return "Based in your state or province";
  const labels: Record<string, string> = {
    "commercial experience": "Commercial projects",
    "residential experience": "Residential projects",
    "industrial experience": "Industrial projects",
    "utility experience": "Utility-scale projects",
    "turnkey work": "Complete installation",
    "labor-only work": "Labor only",
    "specialist-service work": "Specialist service",
    "Accepting work": "Accepting new work",
  };
  return (
    labels[reason] ||
    reason.charAt(0).toUpperCase() + reason.slice(1).replaceAll("-", " ")
  );
}
function MatchRow({
  match,
  data,
  page,
  section,
  admin,
}: {
  match: Match;
  data: Matches;
  page: number;
  section: string;
  admin: boolean;
}) {
  const c = match.company;
  const existing = data.conversationCompanyIds?.includes(c.id);
  const invited = data.invitedCompanyIds?.includes(c.id);
  const canStart =
    admin &&
    data.job.status === "open" &&
    (!data.job.quote_deadline ||
      new Date(data.job.quote_deadline).getTime() > Date.now());
  const canMessage = c.claimed && (existing || invited || canStart);
  const returnView = section === "matches" ? "matches" : "confirmation";
  const profile = `/jobs/companies/${c.username || c.slug}?back=${data.job.id}&from=matches&matchPage=${page}&matchView=${returnView}`;
  const conversation = `/jobs/inbox?${new URLSearchParams({ job: data.job.id, provider: c.id, from: "matches", matchPage: String(page), matchView: returnView })}`;
  const fit = matchFit(match, data);
  const offering = match.offerings[0];
  const StatusIcon = match.eligible ? CircleCheck : CircleHelp;
  return (
    <article
      className={`jobs-panel match-result-card ${match.eligible ? "is-matched" : "needs-checking"}`}
      aria-label={c.name}
    >
      <header className="match-card-header">
        <div className="match-card-identity">
          <MatchCompanyLogo src={c.logo_url || ""} name={c.name} />
          <div className="match-company-heading">
            <Link className="match-company-name" to={profile}>
              <h2>{c.name}</h2>
            </Link>
            {c.location && (
              <p>
                <MapPin size={15} /> Based in {c.location}
              </p>
            )}
          </div>
        </div>
        <span className="match-fit-badge">
          <StatusIcon size={17} />
          {fit.heading}
        </span>
      </header>
      {offering && (
        <p className="match-service-description">
          {offering.offering.detail || offering.offering.title}
        </p>
      )}
      <div className="match-verdict">
        <StatusIcon size={18} />
        <p>{fit.summary}</p>
      </div>
      <dl
        className="match-requirements"
        aria-label="How this company fits your job"
      >
        {fit.facts.map((fact) => {
          const FactIcon =
            fact.state === "matched"
              ? CircleCheck
              : fact.state === "unavailable"
                ? CircleMinus
                : CircleHelp;
          return (
            <div
              className={`match-requirement is-${fact.state}`}
              key={fact.key}
            >
              <dt>{fact.label}</dt>
              <dd>
                <FactIcon size={17} />
                <span>{fact.value}</span>
              </dd>
              {fact.detail && <p>{fact.detail}</p>}
            </div>
          );
        })}
      </dl>
      <footer className="match-card-footer">
        <div className="match-contact-status">
          <strong>
            {invited
              ? "Invited to quote"
              : c.claimed
                ? "On Connect"
                : "Not on Connect yet"}
          </strong>
          <p>
            {!c.claimed
              ? "Open their profile for contact details."
              : canMessage
                ? "Discuss your job and confirm the details."
                : !admin
                  ? "A company admin can start the conversation."
                  : "You can still view their company profile."}
          </p>
        </div>
        <div className="match-card-actions">
          {canMessage && (
            <Link className="match-profile-link" to={profile}>
              View profile
              <ArrowUpRight size={15} />
            </Link>
          )}
          <Link
            className={`jobs-button ${canMessage ? "jobs-primary" : "jobs-secondary"}`}
            to={canMessage ? conversation : profile}
          >
            {canMessage ? <MessageCircle size={18} /> : null}
            {canMessage
              ? existing
                ? "Open conversation"
                : "Message company"
              : "View company profile"}
            {!canMessage && <ArrowRight size={16} />}
          </Link>
        </div>
      </footer>
      {!!offering?.sources.length && (
        <details className="match-fit-details">
          <summary>
            Where this information comes from
            <ChevronDown size={15} />
          </summary>
          <div className="match-evidence-layout">
            {offering.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title || "Company website"}
                <ArrowUpRight size={14} />
              </a>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
export function JobMatchesPage() {
  const { id } = useParams();
  const { company, admin, session, signIn, setJobSection } = useApp();
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get("page") || 1);
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 10000
      ? requestedPage
      : 1;
  const [data, setData] = useState<Matches | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const section =
    params.get("view") === "confirmation" ||
    (data?.totalMatches === 0 && !!data.totalNeedsConfirmation)
      ? "needsConfirmation"
      : "matches";
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(params);
    next.set("view", section === "matches" ? "matches" : "confirmation");
    nextPage > 1 ? next.set("page", String(nextPage)) : next.delete("page");
    setParams(next);
  };
  const selectSection = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("view", key === "matches" ? "matches" : "confirmation");
    next.delete("page");
    setParams(next);
  };
  useEffect(() => {
    setJobSection("mine");
    return () => setJobSection(null);
  }, [setJobSection]);
  useEffect(() => {
    setData(null);
  }, [id, company?.id]);
  useEffect(() => {
    if (!company) return;
    const controller = new AbortController();
    setError("");
    setLoading(true);
    api<Matches>(`/jobs/${id}/matches?page=${page}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id, company?.id, page, retry]);
  if (!company)
    return (
      <div className="jobs-page job-workspace match-discovery">
        <section className="jobs-panel match-empty">
          <BriefcaseBusiness size={28} />
          <h1>Find companies for your job</h1>
          <p>
            {session.user
              ? "Switch to the company that posted this job to see its matches."
              : "Sign in to see companies for your job and start a conversation."}
          </p>
          {!session.user && (
            <button className="jobs-button jobs-primary" onClick={signIn}>
              Sign in
            </button>
          )}
        </section>
      </div>
    );
  const items = data?.[section] || [];
  const total =
    section === "matches"
      ? data?.totalMatches || 0
      : data?.totalNeedsConfirmation || 0;
  const pageSize = data?.pageSize || 12;
  return (
    <div className="jobs-page job-workspace match-discovery">
      <Link className="job-back" to={`/jobs/${id}`}>
        <ArrowLeft size={17} />
        Back to job
      </Link>
      <header className="match-discovery-heading">
        <h1>Find the right company for your job</h1>
        <p>See what matches. Check what’s missing. Start a conversation.</p>
      </header>
      {data && (
        <section className="match-job-ticket" aria-label="Your job">
          <div className="match-job-ticket-icon">
            <BriefcaseBusiness size={23} />
          </div>
          <div className="match-job-ticket-copy">
            <span>Your job</span>
            <Link to={`/jobs/${id}`}>
              <h2>{data.job.title || "Untitled job"}</h2>
            </Link>
            <p>
              <MapPin size={14} />
              {data.job.location}
              {data.preferences?.sector && (
                <>
                  <span aria-hidden="true">·</span>
                  {readableReason(
                    `${data.preferences.sector} experience`,
                    data.job.location,
                  )}
                </>
              )}
            </p>
          </div>
          <div className="match-job-ticket-actions">
            {data.canEdit && (
              <Link to={`/jobs/${id}/edit`} aria-label="Edit job">
                <Pencil size={15} />
                <span>Edit job</span>
              </Link>
            )}
            <Link to={`/jobs/${id}`} aria-label="View job">
              <ArrowUpRight size={19} />
            </Link>
          </div>
        </section>
      )}
      {error ? (
        <section className="jobs-panel match-empty" role="alert">
          <h2>We couldn’t load these companies.</h2>
          <p>{error}</p>
          <button
            className="jobs-button jobs-secondary"
            onClick={() => setRetry((v) => v + 1)}
          >
            Try again
          </button>
        </section>
      ) : data && !data.configured ? (
        <section className="jobs-panel match-empty">
          <h2>What kind of company do you need?</h2>
          <p>
            Add a service and state to your job. We’ll find companies that offer
            the work.
          </p>
          <Link
            className="jobs-button jobs-primary"
            to={data.canEdit ? `/jobs/${id}/edit` : "/providers"}
          >
            {data.canEdit ? "Add job preferences" : "Browse companies"}
            <ArrowRight size={17} />
          </Link>
        </section>
      ) : (
        <section
          className="match-discovery-results"
          aria-label="Companies for your job"
          aria-busy={loading}
        >
          {data && (
            <div className="match-results-heading">
              <nav
                aria-label="Company suggestions"
                className="match-suggestion-tabs"
              >
                <button
                  aria-pressed={section === "matches"}
                  disabled={!data.totalMatches}
                  onClick={() => selectSection("matches")}
                >
                  <CircleCheck size={18} />
                  <span>Service &amp; area match</span>
                  <b>{data.totalMatches || 0}</b>
                </button>
                <button
                  aria-pressed={section === "needsConfirmation"}
                  disabled={!data.totalNeedsConfirmation}
                  onClick={() => selectSection("needsConfirmation")}
                >
                  <CircleHelp size={18} />
                  <span>Details to confirm</span>
                  <b>{data.totalNeedsConfirmation || 0}</b>
                </button>
              </nav>
              <p className="match-group-explanation">
                {section === "matches"
                  ? "Their listed services, service area and selected project details match your job. Check timing and capacity below."
                  : "These companies offer the work, but some job details are missing. Each card shows exactly what to ask."}
              </p>
            </div>
          )}
          {loading ? (
            <div className="match-loading" role="status">
              <span className="match-visually-hidden">
                Finding companies for your job…
              </span>
              {[1, 2, 3].map((n) => (
                <div className="match-loading-row" aria-hidden="true" key={n}>
                  <span />
                  <div>
                    <i />
                    <i />
                  </div>
                  <b />
                </div>
              ))}
            </div>
          ) : items.length ? (
            <div className="match-result-list">
              {items.map((match) => (
                <MatchRow
                  key={match.company.id}
                  match={match}
                  data={data!}
                  page={page}
                  section={section}
                  admin={admin}
                />
              ))}
            </div>
          ) : (
            <div className="jobs-panel match-empty">
              <h2>
                {page > 1
                  ? "You’ve reached the end of this list."
                  : "Let’s widen the search."}
              </h2>
              <p>
                {page > 1
                  ? "Go back to the first page to see these companies."
                  : "Try another service or adjust the job’s location to find more companies."}
              </p>
              {page > 1 ? (
                <button
                  className="jobs-button jobs-secondary"
                  onClick={() => setPage(1)}
                >
                  First page
                </button>
              ) : (
                <Link
                  className="jobs-button jobs-secondary"
                  to={data?.canEdit ? `/jobs/${id}/edit` : "/providers"}
                >
                  {data?.canEdit ? "Edit job preferences" : "Browse companies"}
                </Link>
              )}
            </div>
          )}
          {!loading && total > pageSize && (
            <nav
              className="market-pagination"
              aria-label="Company result pages"
            >
              <button
                className="jobs-button jobs-secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}{" "}
                of {total}
              </span>
              <button
                className="jobs-button jobs-secondary"
                disabled={page * pageSize >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
