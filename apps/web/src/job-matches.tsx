import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  MapPin,
  Pencil,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import "./job-matches.css";

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
type MatchCompany = {
  id: string;
  name: string;
  slug: string;
  username?: string;
  logo_url: string;
  location: string;
  claimed: boolean;
};
type Match = {
  company: MatchCompany;
  eligible: boolean;
  reasons: string[];
  followUp: string[];
  evidenceLevel: string;
  offerings: {
    offering: { title: string; detail: string };
    sources: { url: string; title: string }[];
    availability: string;
    preferredCredentials: { title: string; scope: string; basis: string }[];
    needsConfirmation: string[];
  }[];
};
type Matches = {
  configured: boolean;
  canEdit?: boolean;
  job: {
    id: string;
    title: string;
    location: string;
    status: string;
    description: string;
    quote_deadline?: string;
  };
  matches?: Match[];
  needsConfirmation?: Match[];
  totalMatches?: number;
  totalNeedsConfirmation?: number;
  searchableCompanies?: number;
  invitedCompanyIds?: string[];
  pageSize?: number;
  preferences?: MatchingPreferences;
};
export function JobMatchesPage() {
  const { id } = useParams(),
    { company, admin, toast, setJobSection } = useApp();
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get("page") || 1);
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 10000
      ? requestedPage
      : 1;
  const section =
    params.get("view") === "confirmation" ? "needsConfirmation" : "matches";
  const setPage = (value: number | ((current: number) => number)) => {
    const next = new URLSearchParams(params);
    const n = typeof value === "function" ? value(page) : value;
    n > 1 ? next.set("page", String(n)) : next.delete("page");
    setParams(next);
  };
  const selectSection = (key: string) => {
    const next = new URLSearchParams(params);
    key === "needsConfirmation"
      ? next.set("view", "confirmation")
      : next.delete("view");
    next.delete("page");
    setParams(next);
  };
  const [data, setData] = useState<Matches | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [summaryOpen, setSummaryOpen] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setJobSection("mine");
    return () => setJobSection(null);
  }, [setJobSection]);
  useEffect(() => {
    setData(null);
  }, [id, company?.id]);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setData(null);
    api<Matches>(`/jobs/${id}/matches?page=${page}`, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, company?.id, page, retry]);
  const invite = async (c: MatchCompany) => {
    if (busy) return;
    setBusy(c.id);
    setError("");
    try {
      const sent = await post<{ invitedCompanyIds: string[] }>(
        `/jobs/${id}/invite`,
        { companyIds: [c.id] },
      );
      if (!sent.invitedCompanyIds.includes(c.id))
        throw new Error(
          "This company cannot receive invitations yet. Open its profile for contact details.",
        );
      setData((d) =>
        d
          ? { ...d, invitedCompanyIds: [...(d.invitedCompanyIds || []), c.id] }
          : d,
      );
      toast(`Invitation sent to ${c.name}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const items = data?.[section] || [],
    total =
      section === "matches"
        ? data?.totalMatches || 0
        : data?.totalNeedsConfirmation || 0;
  return (
    <div className="jobs-page job-workspace job-matches-page">
      <Link className="job-back" to={`/jobs/${id}`}>
        <ArrowLeft size={17} />
        Back to job
      </Link>
      <header className="match-page-heading">
        <div>
          <h1>Companies for your job</h1>
          <p>
            {data?.job.title ||
              "Matching your requirements with company profiles"}
          </p>
        </div>
        <Link className="jobs-button jobs-secondary" to={`/jobs/${id}`}>
          View job
          <ArrowRight size={16} />
        </Link>
      </header>
      {error && (
        <div className="jobs-panel" role="alert">
          <p>{error}</p>
          <button
            className="jobs-button jobs-secondary"
            onClick={() => setRetry((v) => v + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {!data && !error ? (
        <p className="job-loading">Finding companies…</p>
      ) : data && !data.configured ? (
        <section className="jobs-panel">
          <h2>Set up company matching</h2>
          <p>
            Choose the service and state in your job to see relevant companies
            here.
          </p>
          {data.canEdit ? (
            <Link className="jobs-button jobs-primary" to={`/jobs/${id}/edit`}>
              Edit job
            </Link>
          ) : (
            <Link className="jobs-button jobs-secondary" to="/providers">
              Browse companies
            </Link>
          )}
        </section>
      ) : (
        data && (
          <div className="match-page-grid">
            <aside className="jobs-panel match-job-summary">
              <h2 className="match-summary-desktop-title">Your requirements</h2>
              <button
                className="match-summary-toggle"
                aria-expanded={summaryOpen}
                aria-controls="match-summary-content"
                onClick={() => setSummaryOpen((v) => !v)}
              >
                Your requirements
                <ChevronDown size={18} />
              </button>
              <p>
                <MapPin size={17} />
                {data.job.location}
              </p>
              <div
                id="match-summary-content"
                className={`match-summary-content ${summaryOpen ? "is-expanded" : ""}`}
              >
                <dl>
                  <dt>Service</dt>
                  <dd>{data.preferences?.categoryId.replaceAll("-", " ")}</dd>
                  {data.preferences?.sector && (
                    <>
                      <dt>Project type</dt>
                      <dd>{data.preferences.sector}</dd>
                    </>
                  )}
                  {data.preferences?.systemType && (
                    <>
                      <dt>System</dt>
                      <dd>
                        {data.preferences.systemType.replaceAll("-", " ")}
                      </dd>
                    </>
                  )}
                </dl>
                {data.canEdit && (
                  <Link
                    className="jobs-button jobs-secondary"
                    to={`/jobs/${id}/edit`}
                  >
                    <Pencil size={15} />
                    Edit preferences
                  </Link>
                )}
                <p className="job-muted">
                  {data.searchableCompanies?.toLocaleString()} company profiles
                  searched. Results use the services and areas listed in each
                  profile.
                </p>
                <hr />
                <h3>What happens next?</h3>
                <ol>
                  <li>Review companies and invite a team to quote.</li>
                  <li>Compare prices, ask questions, and choose a company.</li>
                  <li>
                    They confirm, share progress, and submit the work for your
                    review.
                  </li>
                </ol>
                <p className="job-muted">
                  Nothing is sent until you choose “Invite to quote.”
                </p>
              </div>
            </aside>
            <section
              className="match-results"
              aria-label="Company match results"
            >
              <nav className="match-result-tabs" aria-label="Match groups">
                {[
                  ["matches", "Matches", data.totalMatches],
                  [
                    "needsConfirmation",
                    "Needs confirmation",
                    data.totalNeedsConfirmation,
                  ],
                ].map(([key, label, n]) => (
                  <button
                    key={String(key)}
                    aria-pressed={section === key}
                    onClick={() => {
                      selectSection(String(key));
                    }}
                  >
                    {label}
                    <span>{n}</span>
                  </button>
                ))}
              </nav>
              <p className="job-muted">
                {section === "matches"
                  ? "Ordered by service fit, confirmed coverage, and your preferences. Confirm the scope and schedule before choosing a company."
                  : "These companies list the service. Check the missing details below before inviting them."}
              </p>
              {!items.length && (
                <div className="jobs-panel">
                  <h2>
                    {section === "matches"
                      ? "No confirmed matches yet"
                      : "No companies need confirmation"}
                  </h2>
                  <p>
                    {section === "matches"
                      ? "Check the Needs confirmation tab, or adjust your service and location."
                      : "You can review your matches or browse other companies."}
                  </p>
                  <Link to="/providers" className="jobs-button jobs-secondary">
                    Browse companies
                  </Link>
                </div>
              )}
              {items.map((m) => {
                const c = m.company,
                  invited = data.invitedCompanyIds?.includes(c.id),
                  notAccepting = m.offerings[0]?.availability === "unavailable",
                  canInvite =
                    admin &&
                    c.claimed &&
                    data.job.status === "open" &&
                    !notAccepting &&
                    (!data.job.quote_deadline ||
                      new Date(data.job.quote_deadline).getTime() > Date.now());
                return (
                  <article className="jobs-panel match-company" key={c.id}>
                    <div className="match-company-top">
                      <div className="match-company-brand">
                        {c.logo_url ? (
                          <img src={c.logo_url} alt="" />
                        ) : (
                          <span className="match-blank-logo" />
                        )}
                        <div>
                          <Link
                            to={`/jobs/companies/${c.username || c.slug}?back=${id}&from=matches&matchPage=${page}&matchView=${section}`}
                          >
                            <h2>{c.name}</h2>
                          </Link>
                          <p>{c.location}</p>
                        </div>
                      </div>
                      <span className="match-profile-state">
                        {c.claimed ? "On Connect" : "Public profile"}
                      </span>
                    </div>
                    <p className="match-offering-detail">
                      {m.offerings[0]?.offering.detail}
                    </p>
                    <ul className="match-reasons">
                      {m.reasons.map((reason, i) => (
                        <li key={i}>
                          <Check size={15} />
                          {reason.replaceAll("-", " ")}
                        </li>
                      ))}
                    </ul>
                    {!!m.followUp.length && (
                      <p className="match-follow-up">
                        <strong>Confirm:</strong> {m.followUp.join(" · ")}
                      </p>
                    )}
                    <div className="match-company-actions">
                      <Link
                        className="jobs-button jobs-secondary"
                        to={`/jobs/companies/${c.username || c.slug}?back=${id}&from=matches&matchPage=${page}&matchView=${section}`}
                      >
                        View profile
                        <ArrowRight size={15} />
                      </Link>
                      {invited ? (
                        <span className="match-invited">
                          <Check size={16} />
                          Invited
                        </span>
                      ) : canInvite ? (
                        <button
                          className="jobs-button jobs-primary"
                          disabled={!!busy}
                          onClick={() => void invite(c)}
                        >
                          <Send size={15} />
                          {busy === c.id ? "Sending…" : "Invite to quote"}
                        </button>
                      ) : (
                        <small>
                          {!c.claimed
                            ? "Invitations open when this company claims its profile."
                            : notAccepting
                              ? "Not currently accepting work."
                              : !admin
                                ? "A company admin can send invitations."
                                : "This job is no longer accepting quotes."}
                        </small>
                      )}
                    </div>
                    {!!m.offerings[0]?.sources.length && (
                      <details className="match-sources">
                        <summary>Company sources</summary>
                        {m.offerings[0].sources.map((s) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.title || "Company website"}
                            <ArrowRight size={13} />
                          </a>
                        ))}
                      </details>
                    )}
                  </article>
                );
              })}
              {total > (data.pageSize || 12) && (
                <nav
                  className="market-pagination"
                  aria-label="Match result pages"
                >
                  <button
                    className="jobs-button jobs-secondary"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {Math.ceil(total / (data.pageSize || 12))}
                  </span>
                  <button
                    className="jobs-button jobs-secondary"
                    disabled={page * (data.pageSize || 12) >= total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </section>
          </div>
        )
      )}
    </div>
  );
}
