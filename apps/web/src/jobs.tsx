import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowLeftRight,
  Info,
  Layers3,
  Pencil,
  Tag,
  CircleAlert,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  LockKeyhole,
  MapPin,
  Monitor,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Star,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { api, post } from "./api";
import {
  AttachmentPicker,
  JobAttachments,
  attachmentError as fileError,
  type JobFile,
} from "./job-attachments";
import { useApp } from "./context";
import {
  MatchingFields,
  emptyMatching,
  tradeService,
  type MatchingPreferences,
} from "./job-matches";
import { usePageGuard } from "./page-navigation";
import type { Company } from "./types";

export type JobStatus =
  | "draft"
  | "open"
  | "awarded"
  | "in_progress"
  | "review"
  | "completed"
  | "cancelled";
type PostingDetails = {
  startMode: string;
  startDate: string | null;
  durationAmount: number | null;
  durationUnit: string;
};
type Job = {
  matching_preferences?: MatchingPreferences | null;
  posting_details?: PostingDetails | null;
  id: string;
  title: string;
  description: string;
  trade: string;
  location: string;
  postal_code?: string;
  exact_address?: string;
  start_window?: string;
  project_type?: string;
  system_size_kw?: number | null;
  site_count?: number | null;
  materials_by?: string;
  requirements?: string;
  people_needed?: number | null;
  expected_duration?: string;
  work_arrangement?: string;
  budget_cents?: number | null;
  quote_deadline?: string | null;
  visibility?: string;
  status: JobStatus;
  created_at: string;
  hiring_company_id?: string;
  company?: Company;
  quote_count?: number;
  invited?: boolean;
  my_quote_status?: string;
  chosen_quote_id?: string | null;
};
type Quote = {
  job_rating?: number | null;
  job_review_count?: number;
  id: string;
  provider_company_id: string;
  amount_cents: number;
  start_window: string;
  duration: string;
  note: string;
  included: string;
  excluded: string;
  payment_terms: string;
  price_breakdown?: { label: string; amountCents: number }[];
  status: string;
  company?: Company;
};
type JobUpdate = {
  id: string;
  kind: string;
  body: string;
  company_name: string;
  created_at: string;
};
type JobStage = {
  id: string;
  title: string;
  amount_cents: number;
  status: string;
  invoice_reference: string;
};
export type JobDetail = {
  job: Job;
  hiringCompany: Company;
  conversations: Company[];
  quotes: Quote[];
  ownQuote: Quote | null;
  selected: Quote | null;
  updates: JobUpdate[];
  files: JobFile[];
  paymentStages: JobStage[];
  reviews: { reviewer_company_id: string; rating: number; text: string }[];
  permissions: {
    hirer: boolean;
    chosen: boolean;
    invited: boolean;
    quoted: boolean;
  };
};
const workTypes = [
  ["crew", "Crews & labor"],
  ["installation", "Installation"],
  ["electrical", "Electrical work"],
  ["roofing", "Roofing"],
  ["service", "Service & maintenance"],
  ["design", "Design & engineering"],
  ["permitting", "Permits & approvals"],
  ["inspection", "Testing & inspections"],
  ["equipment", "Equipment & materials"],
  ["logistics", "Transport & logistics"],
  ["other", "Other solar support"],
] as const;
const arrangementLabels: Record<string, string> = {
  onsite: "On site",
  remote: "Remote",
  hybrid: "On site & remote",
};
const projectTypes = [
  ["residential", "Residential"],
  ["commercial", "Commercial"],
  ["utility", "Utility scale"],
  ["mixed", "Mixed sites"],
] as const;
const projectLabel = (key: string) =>
  projectTypes.find(([k]) => k === key)?.[1] || key;
const materialsLabels: Record<string, string> = {
  hiring_company: "Hiring company supplies materials",
  provider: "Include materials in quote",
  to_agree: "Materials to be agreed",
};
const statusLabel: Record<JobStatus, string> = {
  draft: "Draft",
  open: "Receiving quotes",
  awarded: "Awaiting confirmation",
  in_progress: "In progress",
  review: "Ready for review",
  completed: "Completed",
  cancelled: "Cancelled",
};
const workLabel = (key: string) =>
  workTypes.find(([k]) => k === key)?.[1] || key;
const money = (cents?: number | null) =>
  typeof cents === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
        minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      }).format(cents / 100)
    : "Budget not listed";
const date = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Flexible";
const cls = (v: string) => v.toLowerCase().replace(/[^a-z]+/g, "-");
export function JobLogo({ company }: { company?: Company }) {
  return (
    <span className="job-logo">
      {company?.logo_url ? (
        <img
          src={
            company.is_demo &&
            company.logo_url.startsWith("/assets/demo-logos/")
              ? company.logo_url.replace(/\.svg$/, "-mark.svg")
              : company.logo_url
          }
          alt=""
        />
      ) : null}
    </span>
  );
}
function JobError({ text }: { text: string }) {
  return text ? (
    <p className="job-error" role="alert">
      {text}
    </p>
  ) : null;
}
function JobEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="job-empty">
      <BriefcaseBusiness size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
function JobCard({
  job,
  mine = false,
  companyId,
}: {
  job: Job;
  mine?: boolean;
  companyId?: string;
}) {
  const own = job.hiring_company_id === companyId;
  const selected = job.my_quote_status === "chosen";
  const action = !mine
    ? "View job"
    : job.status === "draft"
      ? "Finish draft"
      : job.status === "open" && own && (job.quote_count || 0) > 0
        ? "Review quotes"
        : job.status === "awarded" && selected
          ? "Confirm job"
          : job.status === "review" && own
            ? "Review work"
            : job.status === "in_progress"
              ? "View progress"
              : "View job";
  return (
    <Link className="job-card" to={`/jobs/${job.id}`}>
      <div className="job-card-overline">
        <span>{workLabel(job.trade)}</span>
        <span>Posted {date(job.created_at)}</span>
        {job.company?.is_demo && <span>Demo</span>}
      </div>
      <div className="job-card-top">
        <div className="job-card-main">
          <strong>{job.title || "Untitled draft"}</strong>
          <span className="job-location">
            <MapPin size={14} />
            {job.work_arrangement === "remote"
              ? "Remote"
              : job.location || "Location to be added"}
            {job.work_arrangement === "hybrid" && " · Hybrid"}
          </span>
          {job.description && (
            <p className="job-card-description">{job.description}</p>
          )}
        </div>
        <div className="job-card-budget">
          <strong>
            {job.budget_cents != null
              ? money(job.budget_cents)
              : "Open to quotes"}
          </strong>
          <small>
            {job.budget_cents != null ? "Total budget" : "Propose your price"}
          </small>
        </div>
      </div>
      <div className="job-chips">
        {job.people_needed && (
          <span>
            <Users size={14} />
            {job.people_needed} people
          </span>
        )}
        {job.expected_duration && (
          <span>
            <Clock3 size={14} />
            {job.expected_duration}
          </span>
        )}
        {job.start_window && (
          <span>
            <CalendarDays size={13} />
            {job.start_window}
          </span>
        )}
        {mine && (
          <span className={`job-status ${cls(job.status)}`}>
            {statusLabel[job.status]}
          </span>
        )}
        {job.invited && <span>Invited to quote</span>}
      </div>
      <div className="job-card-footer">
        <span className="job-card-company">
          <JobLogo company={job.company} />
          <span>
            <b>{job.company?.name}</b>
            {mine && (
              <small>
                {mine && own
                  ? `${job.quote_count || 0} quotes received`
                  : mine && job.my_quote_status
                    ? `Your quote: ${job.my_quote_status.replaceAll("_", " ")}`
                    : ""}
              </small>
            )}
          </span>
        </span>
        <span className="job-card-cta">
          {action}
          <ArrowRight size={16} />
        </span>
      </div>
    </Link>
  );
}

export function JobsPage({ mine = false }: { mine?: boolean }) {
  const { company, session, revision, signIn, createCompany } = useApp();
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]),
    [myWork, setMyWork] = useState<Job[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [q, setQ] = useState(params.get("q") || ""),
    [location, setLocation] = useState(params.get("location") || ""),
    [trade, setTrade] = useState(params.get("trade") || "");
  const [hasMore, setHasMore] = useState(false),
    [retry, setRetry] = useState(0);
  const sample = params.has("sample")
    ? params.get("sample") === "true"
    : !!company?.is_demo;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const view = params.get("view") || "all";
  useEffect(() => {
    setQ(params.get("q") || "");
    setLocation(params.get("location") || "");
    setTrade(params.get("trade") || "");
  }, [params]);
  useEffect(() => {
    if (mine && !company) {
      setLoading(false);
      setJobs([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams(params);
    query.set("sample", String(sample));
    api<{ jobs: Job[]; hasMore?: boolean }>(
      mine ? "/jobs/mine" : "/jobs?" + query,
      { signal: controller.signal },
    )
      .then((v) => {
        setJobs(v.jobs);
        setHasMore(!!v.hasMore);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mine, params, sample, revision, company?.id, retry]);
  useEffect(() => {
    if (!company || mine) return;
    const c = new AbortController();
    api<{ jobs: Job[] }>("/jobs/mine", { signal: c.signal })
      .then((v) => setMyWork(v.jobs))
      .catch(() => {});
    return () => c.abort();
  }, [company?.id, mine, revision]);
  const sideJobs = mine ? jobs : myWork;
  const groups: Record<string, Job[]> = {
    all: sideJobs,
    posted: sideJobs.filter((j) => j.hiring_company_id === company?.id),
    quotes: sideJobs.filter((j) => j.my_quote_status),
    invitations: sideJobs.filter((j) => j.invited && j.status === "open"),
    active: sideJobs.filter(
      (j) =>
        ["awarded", "in_progress", "review"].includes(j.status) &&
        (j.hiring_company_id === company?.id || j.my_quote_status === "chosen"),
    ),
    completed: sideJobs.filter(
      (j) =>
        j.status === "completed" &&
        (j.hiring_company_id === company?.id || j.my_quote_status === "chosen"),
    ),
  };
  const visible = mine ? groups[view] || jobs : jobs;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams({ sample: String(sample) });
    for (const [k, v] of [
      ["q", q.trim()],
      ["location", location.trim()],
      ["trade", trade],
    ])
      if (v) next.set(k, v);
    setParams(next);
  };
  const move = (n: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(n));
    setParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (mine && !company)
    return (
      <div className="jobs-page">
        <div className="job-empty">
          <BriefcaseBusiness size={28} />
          <h1>Your work, in one place.</h1>
          <p>
            {session.user
              ? "A company profile lets you post jobs, send quotes, and manage projects."
              : "Sign in to see your jobs, quotes, and invitations."}
          </p>
          <button
            className="jobs-button jobs-primary"
            onClick={
              session.user && session.user.account_type !== "individual"
                ? createCompany
                : signIn
            }
          >
            {session.user?.account_type === "individual"
              ? "Use a company account"
              : session.user
                ? "Create company profile"
                : "Sign in"}
          </button>
        </div>
      </div>
    );
  return (
    <div className={`jobs-page work-discovery ${mine ? "my-work-page" : ""}`}>
      <div className="jobs-heading market-page-heading">
        <div>
          <span className="editorial-label">
            {mine ? "YOUR COMPANY WORKSPACE" : "THE SOLAR WORK MARKETPLACE"}
          </span>
          <h1>{mine ? "My jobs." : "Find work."}</h1>
          <p>
            {mine
              ? "Track the work you hire for and the work you take on."
              : "Crews, specialist work, and everything solar businesses need."}
          </p>
        </div>
      </div>
      {mine && (
        <nav className="job-work-tabs" aria-label="Your job filters">
          {[
            ["all", "All work"],
            ["posted", "Posted by you"],
            ["quotes", "Quotes sent"],
            ["invitations", "Invitations"],
            ["active", "Active"],
            ["completed", "Completed"],
          ].map(([key, label]) => (
            <Link
              key={key}
              className={view === key ? "active" : ""}
              aria-current={view === key ? "page" : undefined}
              to={`/jobs/mine?view=${key}`}
            >
              {label}
              <b>{groups[key].length}</b>
            </Link>
          ))}
        </nav>
      )}
      <div className="jobs-layout work-discovery-layout">
        <section className="jobs-list">
          {!mine && (
            <form className="jobs-search" onSubmit={submit}>
              <label>
                <Search size={18} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Job title or keyword"
                  aria-label="Job title or keyword"
                />
              </label>
              <label>
                <MapPin size={18} />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City or state"
                  aria-label="Job location"
                />
              </label>
              <select
                className="work-mobile-category"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                aria-label="Type of work"
              >
                <option value="">All work</option>
                {workTypes.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button className="jobs-button jobs-primary" type="submit">
                Search
                <ArrowRight size={16} />
              </button>
            </form>
          )}
          <div className="jobs-section-title">
            <span aria-live="polite">
              {loading
                ? "Loading…"
                : `${visible.length} ${mine ? "jobs" : "available jobs"}${page > 1 ? ` · Page ${page}` : ""}`}
            </span>
            {!mine && (
              <label className="sample-toggle">
                <input
                  type="checkbox"
                  checked={sample}
                  onChange={(e) => {
                    const next = new URLSearchParams(params);
                    next.set("sample", String(e.target.checked));
                    next.delete("page");
                    setParams(next);
                  }}
                />
                Show demo jobs
              </label>
            )}
          </div>
          {loading ? (
            <div className="job-loading">Finding your work…</div>
          ) : error ? (
            <div className="job-empty">
              <JobError text={error} />
              <button
                className="jobs-button jobs-secondary"
                onClick={() => setRetry((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          ) : visible.length ? (
            <div className="job-results">
              {visible.map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  mine={mine}
                  companyId={company?.id}
                />
              ))}
            </div>
          ) : (
            <div className="job-empty">
              <BriefcaseBusiness size={28} />
              <h2>
                {mine ? "Nothing here yet" : "No matching jobs right now"}
              </h2>
              <p>
                {mine
                  ? view === "quotes"
                    ? "When you send a quote, you can track it here."
                    : view === "invitations"
                      ? "Invitations to quote will appear here."
                      : "Post a job or explore work your company can take on."
                  : "Try a wider area or a different type of work. New jobs will appear here as companies post them."}
              </p>
              <div className="job-empty-actions">
                {!mine && (q || location || trade) ? (
                  <button
                    className="jobs-button jobs-secondary"
                    onClick={() => setParams({ sample: String(sample) })}
                  >
                    Clear search
                  </button>
                ) : (
                  <Link
                    className="jobs-button jobs-primary"
                    to={mine ? "/jobs" : "/jobs/new"}
                  >
                    {mine ? "Find work" : "Post a job"}
                    <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            </div>
          )}
          {!mine && (hasMore || page > 1) && (
            <nav className="market-pagination" aria-label="Job pages">
              <button
                className="jobs-button jobs-secondary"
                disabled={page === 1}
                onClick={() => move(page - 1)}
              >
                <ArrowLeft size={16} />
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="jobs-button jobs-secondary"
                disabled={!hasMore}
                onClick={() => move(page + 1)}
              >
                Next
                <ArrowRight size={16} />
              </button>
            </nav>
          )}
        </section>
        {!mine && (
          <aside className="jobs-aside work-discovery-sidebar">
            <nav className="work-type-nav" aria-label="Filter by work type">
              <h2>Type of work</h2>
              {[["", "All work"], ...workTypes].map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={(params.get("trade") || "") === key}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    key ? next.set("trade", key) : next.delete("trade");
                    next.delete("page");
                    next.set("sample", String(sample));
                    setParams(next);
                  }}
                >
                  {label}
                  {(params.get("trade") || "") === key && <span />}
                </button>
              ))}
            </nav>
            <div className="jobs-panel work-summary">
              <h2>Your work</h2>
              {company ? (
                <>
                  {[
                    ["quotes", "Quotes sent", Send],
                    ["invitations", "Invitations", Users],
                    ["active", "Active jobs", BriefcaseBusiness],
                  ].map(([key, label, Icon]) => {
                    const IconComponent = Icon as typeof Send;
                    return (
                      <Link key={String(key)} to={`/jobs/mine?view=${key}`}>
                        <IconComponent size={18} />
                        {String(label)}
                        <b>{groups[String(key)].length}</b>
                        <ArrowRight size={15} />
                      </Link>
                    );
                  })}
                </>
              ) : (
                <>
                  <p className="job-muted">
                    Keep your quotes and work in one place.
                  </p>
                  <button onClick={signIn}>
                    Sign in
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function DurationFields({
  amount,
  unit,
  existing,
  onChange,
}: {
  amount: string;
  unit: string;
  existing: string;
  onChange: (amount: string, unit: string) => void;
}) {
  return (
    <fieldset className="posting-duration">
      <legend>
        Expected duration <span className="field-optional">(optional)</span>
      </legend>
      <div>
        {unit !== "existing" && (
          <input
            aria-label="Duration quantity"
            type="number"
            inputMode="numeric"
            min="1"
            max="10000"
            step="1"
            value={amount}
            onChange={(e) => onChange(e.target.value, unit)}
            placeholder="e.g. 2"
          />
        )}
        <select
          aria-label="Duration unit"
          value={unit}
          onChange={(e) => onChange(amount, e.target.value)}
        >
          <option value="hours">Hours</option>
          <option value="days">Days</option>
          <option value="weeks">Weeks</option>
          <option value="months">Months</option>
          {unit === "existing" && <option value="existing">{existing}</option>}
        </select>
      </div>
    </fieldset>
  );
}

export function NewJobPage() {
  const { id } = useParams(),
    { company, admin, session, createCompany, signIn, toast } = useApp(),
    navigate = useNavigate();
  const [editReady, setEditReady] = useState(!id);
  const [savedId, setSavedId] = useState(id);
  const [startMode, setStartMode] = useState("flexible"),
    [startDate, setStartDate] = useState("");
  const [durationAmount, setDurationAmount] = useState(""),
    [durationUnit, setDurationUnit] = useState("weeks");
  const [postalCode, setPostalCode] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const [matching, setMatching] = useState<MatchingPreferences>(emptyMatching);
  const [projectType, setProjectType] = useState("");
  const [systemSize, setSystemSize] = useState("");
  const [siteCount, setSiteCount] = useState("");
  const [materials, setMaterials] = useState("to_agree");
  const [requirements, setRequirements] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [budgetMode, setBudgetMode] = useState("quotes");
  const [people, setPeople] = useState("");
  const [expectedDuration, setExpectedDuration] = useState("");
  const [arrangement, setArrangement] = useState("onsite");
  const [existingFiles, setExistingFiles] = useState<JobFile[]>([]);
  const [title, setTitle] = useState(""),
    [trade, setTrade] = useState(""),
    [location, setLocation] = useState(""),
    [start, setStart] = useState("Flexible"),
    [description, setDescription] = useState(""),
    [budget, setBudget] = useState(""),
    [deadline, setDeadline] = useState(""),
    [exact, setExact] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    api<JobDetail>(`/jobs/${id}`)
      .then(({ job, permissions, quotes, files: storedFiles }) => {
        if (
          !permissions.hirer ||
          quotes.length > 0 ||
          !["draft", "open"].includes(job.status)
        ) {
          setError("This job can no longer be edited.");
          return;
        }
        setMatching(
          job.matching_preferences || {
            ...emptyMatching,
            categoryId: tradeService[job.trade] || "",
          },
        );
        setProjectType(job.project_type || "");
        setPeople(job.people_needed ? String(job.people_needed) : "");
        setExpectedDuration(job.expected_duration || "");
        setArrangement(job.work_arrangement || "onsite");
        setSystemSize(job.system_size_kw ? String(job.system_size_kw) : "");
        setSiteCount(job.site_count ? String(job.site_count) : "");
        setMaterials(job.materials_by || "to_agree");
        setRequirements(job.requirements || "");
        setExistingFiles(
          storedFiles.filter((f) => !f.quote_id && !f.update_id),
        );
        setTitle(job.title);
        setTrade(job.trade);
        setLocation(job.location);
        setStart(job.start_window || "");
        setStartMode(
          job.posting_details?.startMode ||
            (job.start_window ? "existing" : "flexible"),
        );
        setStartDate(job.posting_details?.startDate || "");
        setDurationAmount(
          job.posting_details?.durationAmount
            ? String(job.posting_details.durationAmount)
            : "",
        );
        setDurationUnit(
          job.posting_details?.durationUnit ||
            (job.expected_duration ? "existing" : "weeks"),
        );
        setPostalCode(job.postal_code || "");
        setDescription(job.description);
        setBudget(
          job.budget_cents != null ? String(job.budget_cents / 100) : "",
        );
        setBudgetMode(job.budget_cents ? "fixed" : "quotes");
        setDeadline(
          job.quote_deadline
            ? new Date(job.quote_deadline).toLocaleDateString("en-CA")
            : "",
        );
        setExact(job.exact_address || "");
        setEditReady(true);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  const stageError = (stage: number) => {
    if (stage === 0 && (title.trim().length < 8 || !trade))
      return "Add a clear title of at least 8 characters and choose a type of work.";
    if (stage === 1) {
      if (description.trim().length < 20)
        return "Add a little more detail about the work (at least 20 characters).";
      if (
        systemSize &&
        (!Number.isFinite(Number(systemSize)) ||
          Number(systemSize) < 0.01 ||
          Number(systemSize) > 100000000)
      )
        return "Enter a system size between 0.01 and 100,000,000 kW.";
      if (
        siteCount &&
        (!Number.isInteger(Number(siteCount)) ||
          Number(siteCount) < 1 ||
          Number(siteCount) > 100000)
      )
        return "Enter a whole number of sites between 1 and 100,000.";
    }
    if (stage === 2) {
      if (arrangement !== "remote" && location.trim().length < 2)
        return "Add the city or service area where you need help.";
      if (
        trade === "crew" &&
        people &&
        (!Number.isInteger(Number(people)) ||
          Number(people) < 1 ||
          Number(people) > 1000)
      )
        return "Enter a whole number of people between 1 and 1,000.";
    }
    if (
      stage === 3 &&
      budgetMode === "fixed" &&
      (!budget ||
        !Number.isFinite(Number(budget)) ||
        Number(budget) < 1 ||
        Number(budget) > 1000000000)
    )
      return "Enter a total budget between $1 and $1,000,000,000, or choose to receive quotes.";
    return "";
  };
  const review = () => {
    for (let stage = 0; stage < 4; stage++) {
      const issue = stageError(stage);
      if (issue) {
        setError(issue);
        requestAnimationFrame(() =>
          document
            .getElementById("posting-error")
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        );
        return false;
      }
    }
    return true;
  };
  const publish = async (status: "open" | "draft") => {
    if (status === "open" && !review()) return;
    if (
      startMode === "date" &&
      (!startDate || (status === "open" && startDate < today))
    ) {
      setError("Choose a start date of today or later.");
      return;
    }
    if (deadline && status === "open" && deadline < today) {
      setError("Choose a quote deadline of today or later.");
      return;
    }
    if (
      durationAmount &&
      (!Number.isInteger(Number(durationAmount)) ||
        Number(durationAmount) < 1 ||
        Number(durationAmount) > 10000)
    ) {
      setError("Enter a whole number for the duration, between 1 and 10,000.");
      return;
    }
    setSavingDraft(status === "draft");
    setBusy(true);
    setError("");
    try {
      const body = {
        matchingPreferences:
          matching.categoryId && matching.stateCode
            ? {
                ...matching,
                city:
                  arrangement !== "remote" && location.trim()
                    ? location.split(",")[0].trim().slice(0, 100)
                    : undefined,
                sector:
                  matching.kind === "service" &&
                  ["residential", "commercial", "utility"].includes(projectType)
                    ? projectType
                    : undefined,
                preferredStart:
                  matching.kind === "service" && startMode === "date"
                    ? startDate || undefined
                    : undefined,
              }
            : null,
        projectType,
        postalCode: arrangement === "remote" ? "" : postalCode,
        postingDetails: {
          startMode,
          startDate: startMode === "date" ? startDate || null : null,
          durationAmount: durationAmount ? Number(durationAmount) : null,
          durationUnit,
        },
        systemSizeKw: systemSize ? Number(systemSize) : null,
        siteCount: siteCount ? Number(siteCount) : null,
        materialsBy: materials,
        requirements,
        title,
        trade: trade || "other",
        location: arrangement === "remote" ? "Remote" : location,
        peopleNeeded: trade === "crew" && people ? Number(people) : null,
        expectedDuration,
        workArrangement: arrangement,
        startWindow: start,
        description,
        budgetCents:
          budgetMode === "fixed" && budget
            ? Math.round(Number(budget) * 100)
            : null,
        quoteDeadline: deadline
          ? new Date(deadline + "T23:59:59").toISOString()
          : "",
        exactAddress: arrangement === "remote" ? "" : exact,
        status,
      };
      let jobId = savedId;
      if (!jobId) {
        const result = await post<{ id: string }>("/jobs", {
          ...body,
          status: "draft",
        });
        jobId = result.id;
        setSavedId(jobId);
      }
      for (const file of files) {
        const uploaded = await upload(jobId, file);
        setExistingFiles((current) => [
          ...current,
          {
            id: uploaded.id,
            original_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          },
        ]);
        setFiles((current) => current.filter((f) => f !== file));
      }
      await api(`/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast(
        status === "draft"
          ? "Draft saved"
          : id
            ? "Job updated"
            : "Job published",
      );
      navigate(
        `/jobs/${jobId}${status === "open" && body.matchingPreferences ? "/matches" : ""}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (id && !editReady)
    return (
      <div className="jobs-page">
        {error ? (
          <JobError text={error} />
        ) : (
          <div className="job-loading">Loading job draft…</div>
        )}
      </div>
    );
  if (!company)
    return (
      <div className="jobs-page job-access-page">
        <section
          className="job-access-card"
          aria-labelledby="post-access-title"
        >
          <span className="job-access-icon">
            <BriefcaseBusiness size={27} />
          </span>
          <span className="editorial-label">LET’S GET YOUR JOB STARTED</span>
          <h1 id="post-access-title">Good help starts here.</h1>
          <p>
            {session.user?.account_type === "individual"
              ? "Use a company account to post a job and receive quotes."
              : session.user
                ? "Add your company profile to post work and receive quotes from solar professionals."
                : "Sign in to post your job, compare quotes, and find the right company for the work."}
          </p>
          <button
            className="jobs-button jobs-primary"
            onClick={
              session.user && session.user.account_type !== "individual"
                ? createCompany
                : signIn
            }
          >
            {session.user?.account_type === "individual"
              ? "Use a company account"
              : session.user
                ? "Create company profile"
                : "Sign in to post a job"}
            <ArrowRight size={18} />
          </button>
          <Link className="job-access-back" to="/providers">
            Explore companies first <ArrowUpRight size={15} />
          </Link>
        </section>
      </div>
    );
  if (!admin)
    return (
      <div className="jobs-page">
        <JobEmpty
          title="An admin can post jobs"
          detail="Ask your company owner or admin to post this job."
        />
      </div>
    );
  return (
    <div className="jobs-page job-posting-page workspace-posting">
      <Link to={id ? `/jobs/${id}` : "/jobs/mine"} className="job-back">
        <ArrowLeft size={17} /> {id ? "Back to job" : "My jobs"}
      </Link>
      <header className="workspace-page-heading">
        <h1>{id ? "Edit job" : "Post a job"}</h1>
        <p>
          Tell companies what you need. You can edit this until quotes arrive.
        </p>
      </header>
      <div className="posting-layout">
        <form
          className="jobs-panel posting-form"
          onInvalidCapture={(e) => {
            const details = (e.target as HTMLElement).closest("details");
            if (details) details.open = true;
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void publish("open");
          }}
        >
          <div id="posting-error">
            <JobError text={error} />
          </div>
          <label>
            What needs to be done?
            <input
              aria-label="Job title"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Need a crew for 18 rooftop installations"
              maxLength={160}
              minLength={8}
              required
            />
          </label>
          <div className="posting-key-fields">
            <label>
              Type of work
              <select
                aria-label="Type of work"
                value={trade}
                onChange={(e) => {
                  setTrade(e.target.value);
                  setMatching((v) => ({
                    ...v,
                    kind: "service",
                    categoryId: tradeService[e.target.value] || "",
                    delivery: undefined,
                  }));
                }}
                required
              >
                <option value="">Choose work type</option>
                {workTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {arrangement !== "remote" ? (
              <label>
                Location
                <input
                  aria-label="City or service area"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  autoComplete="address-level2"
                  placeholder="City, state or service area"
                  maxLength={160}
                  required
                />
              </label>
            ) : (
              <div className="posting-remote">
                <Monitor size={18} />
                <span>
                  Remote work<small>No site visit needed</small>
                </span>
              </div>
            )}
            <label>
              When should work start?
              <select
                aria-label="When should work start?"
                value={startMode}
                onChange={(e) => {
                  const mode = e.target.value;
                  setStartMode(mode);
                  setStart(
                    mode === "date"
                      ? startDate
                      : (
                          {
                            flexible: "Flexible",
                            asap: "As soon as possible",
                            two_weeks: "Within 2 weeks",
                            month: "Within a month",
                          } as Record<string, string>
                        )[mode] || start,
                  );
                }}
              >
                <option value="flexible">I’m flexible</option>
                <option value="asap">As soon as possible</option>
                <option value="two_weeks">Within 2 weeks</option>
                <option value="month">Within a month</option>
                <option value="date">Choose a date</option>
                {startMode === "existing" && (
                  <option value="existing">{start}</option>
                )}
              </select>
              {startMode === "date" && (
                <input
                  type="date"
                  aria-label="Preferred start date"
                  required
                  min={today}
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setStart(e.target.value);
                  }}
                />
              )}
            </label>
          </div>
          <label>
            Describe the work
            <textarea
              aria-label="Describe what you need"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs doing? Include the scope, what you’ll supply, and what a finished job should look like."
              rows={6}
              minLength={20}
              maxLength={10000}
              required
            />
          </label>
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            label="Add files or photos"
            disabled={busy}
          />
          <FileList files={existingFiles} />
          <div className="jobs-fields-two">
            <label>
              Budget <span className="field-optional">(USD)</span>
              <select
                aria-label="Budget preference"
                value={budgetMode}
                onChange={(e) => setBudgetMode(e.target.value)}
              >
                <option value="quotes">I’d like to receive quotes</option>
                <option value="fixed">I have a total budget</option>
              </select>
              {budgetMode === "fixed" && (
                <div className="posting-money">
                  <span aria-hidden="true">$</span>
                  <input
                    aria-label="Total budget in USD"
                    type="number"
                    inputMode="decimal"
                    required
                    min="1"
                    step="0.01"
                    max="1000000000"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="e.g. 75000"
                  />
                </div>
              )}
            </label>
            <label>
              Quote deadline <span className="field-optional">(optional)</span>
              <input
                aria-label="Quote deadline"
                type="date"
                min={today}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
          </div>
          {trade === "crew" && (
            <div className="jobs-fields-two">
              <label>
                People needed <span className="field-optional">(optional)</span>
                <input
                  aria-label="How many people do you need?"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  inputMode="numeric"
                  value={people}
                  onChange={(e) => setPeople(e.target.value)}
                  placeholder="e.g. 4"
                />
              </label>
              <DurationFields
                amount={durationAmount}
                unit={durationUnit}
                existing={expectedDuration}
                onChange={(amount, unit) => {
                  setDurationAmount(amount);
                  setDurationUnit(unit);
                  setExpectedDuration(
                    unit === "existing"
                      ? expectedDuration
                      : amount
                        ? amount + " " + unit
                        : "",
                  );
                }}
              />
            </div>
          )}
          <MatchingFields value={matching} onChange={setMatching} />
          <details className="posting-more">
            <summary>
              Requirements & project details <span>Optional</span>
              <ChevronDown size={17} />
            </summary>
            <div className="posting-more-fields">
              <fieldset className="posting-arrangement">
                <legend>Where will the work happen?</legend>
                {Object.entries(arrangementLabels).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="arrangement"
                      value={value}
                      checked={arrangement === value}
                      onChange={() => setArrangement(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {trade !== "crew" && (
                <DurationFields
                  amount={durationAmount}
                  unit={durationUnit}
                  existing={expectedDuration}
                  onChange={(amount, unit) => {
                    setDurationAmount(amount);
                    setDurationUnit(unit);
                    setExpectedDuration(
                      unit === "existing"
                        ? expectedDuration
                        : amount
                          ? amount + " " + unit
                          : "",
                    );
                  }}
                />
              )}
              <label>
                Requirements
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="Licenses, insurance, experience, or equipment your team needs"
                  rows={3}
                  maxLength={3000}
                />
              </label>
              <div className="jobs-fields-three">
                <label>
                  Project type
                  <select
                    aria-label="Project type"
                    value={projectType}
                    onChange={(e) => setProjectType(e.target.value)}
                  >
                    <option value="">Not specified</option>
                    {projectTypes.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  System size (kW)
                  <input
                    type="number"
                    value={systemSize}
                    onChange={(e) => setSystemSize(e.target.value)}
                    min="0.01"
                    max="100000000"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Number of sites
                  <input
                    type="number"
                    value={siteCount}
                    onChange={(e) => setSiteCount(e.target.value)}
                    min="1"
                    max="100000"
                    inputMode="numeric"
                    step="1"
                    placeholder="Optional"
                  />
                </label>
              </div>
              <label>
                Who supplies materials?
                <select
                  aria-label="Who supplies materials?"
                  value={materials}
                  onChange={(e) => setMaterials(e.target.value)}
                >
                  {Object.entries(materialsLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {arrangement !== "remote" && (
                <label>
                  Exact address{" "}
                  <span className="field-optional">(private)</span>
                  <input
                    aria-label="Exact address"
                    autoComplete="street-address"
                    value={exact}
                    onChange={(e) => setExact(e.target.value)}
                    placeholder="Shared only with the company you choose"
                    maxLength={300}
                  />
                </label>
              )}
              {arrangement !== "remote" && (
                <label>
                  ZIP or postal code{" "}
                  <span className="field-optional">(optional)</span>
                  <input
                    type="text"
                    autoComplete="postal-code"
                    maxLength={20}
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="e.g. 44114"
                  />
                </label>
              )}
            </div>
          </details>
          <footer className="posting-actions">
            <button
              type="submit"
              className="jobs-button jobs-primary"
              disabled={busy}
            >
              {busy && !savingDraft
                ? "Publishing…"
                : id
                  ? "Update job"
                  : "Publish job"}
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="jobs-button jobs-secondary"
              disabled={busy}
              onClick={() => void publish("draft")}
            >
              {busy && savingDraft ? "Saving…" : "Save draft"}
            </button>
          </footer>
        </form>
        <aside className="posting-preview">
          <section className="jobs-panel">
            <h2>Job preview</h2>
            <p className="job-muted">Here’s what companies will see.</p>
            <article className="posting-preview-card">
              <h3>{title.trim() || "Your job title"}</h3>
              <div className="preview-facts">
                <span>
                  <MapPin size={17} />
                  {arrangement === "remote"
                    ? "Remote"
                    : location.trim() || "Location"}
                </span>
                {trade && <span>{workLabel(trade)}</span>}
                {start.trim() && (
                  <span>
                    <CalendarDays size={16} />
                    {start}
                  </span>
                )}
              </div>
              <p
                className={`preview-description ${description.trim() ? "" : "preview-placeholder"}`}
              >
                {description.trim() ||
                  "Describe the work so the right companies can send you a useful quote."}
              </p>
              {budget && (
                <div className="preview-budget">
                  <span>Budget</span>
                  <b>{money(Math.round(Number(budget) * 100))}</b>
                </div>
              )}
              {!!files.length && (
                <AttachmentPicker files={files} onChange={setFiles} readOnly />
              )}
              <FileList files={existingFiles} />
              <div className="preview-company">
                <JobLogo company={company} />
                <b>{company.name}</b>
              </div>
              <p className="preview-privacy">
                <LockKeyhole size={17} />
                Exact address stays private until you choose a company.
              </p>
            </article>
          </section>
          <section className="jobs-panel posting-invite-hint">
            <span>
              <Users size={23} />
            </span>
            <div>
              <h3>Invite companies after publishing</h3>
              <p>
                Once your job is live, invite specific companies to send a
                quote.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

async function upload(
  jobId: string,
  file: File,
  destination?: { quoteId?: string; updateId?: string },
) {
  const issue = fileError([file]);
  if (issue) throw new Error(issue);
  const params = new URLSearchParams({ name: file.name, ...destination });
  return api<{ id: string }>(`/jobs/${jobId}/files?${params}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

export function JobDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParams(),
    {
      company,
      admin,
      revision,
      refresh,
      signIn,
      toast,
      open,
      session,
      createCompany,
      setJobSection,
    } = useApp();
  const [detail, setDetail] = useState<JobDetail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [selectedQuote, setSelectedQuote] = useState<string>(""),
    [quoteSort, setQuoteSort] = useState("best"),
    [expandedQuote, setExpandedQuote] = useState(""),
    [tab, setTab] = useState<"overview" | "payments">("overview");
  const messageCompany = searchParams.get("provider") || "";
  const [messageBusy, setMessageBusy] = useState(false);
  const [quoteEditing, setQuoteEditing] = useState(false);
  const [breakdown, setBreakdown] = useState<
    { label: string; amount: string }[]
  >([]);
  const [invoiceRefs, setInvoiceRefs] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState(""),
    [quoteNote, setQuoteNote] = useState(""),
    [quoteStart, setQuoteStart] = useState(""),
    [duration, setDuration] = useState(""),
    [included, setIncluded] = useState(""),
    [excluded, setExcluded] = useState(""),
    [terms, setTerms] = useState(""),
    [quoteFiles, setQuoteFiles] = useState<File[]>([]);
  const [pendingUpdate, setPendingUpdate] = useState<{
    id: string;
    kind: string;
  } | null>(null);
  const [update, setUpdate] = useState(""),
    [updateFiles, setUpdateFiles] = useState<File[]>([]),
    [reviewNote, setReviewNote] = useState(""),
    [showReviewNote, setShowReviewNote] = useState(false),
    [rating, setRating] = useState(5),
    [reviewText, setReviewText] = useState(""),
    [message, setMessage] = useState(""),
    [inviteQ, setInviteQ] = useState(""),
    [inviteSample, setInviteSample] = useState(!!company?.is_demo),
    [inviteResults, setInviteResults] = useState<Company[]>([]),
    [selectedInvite, setSelectedInvite] = useState<string[]>([]),
    [showInvite, setShowInvite] = useState(false),
    [stageTitles, setStageTitles] = useState<string[]>([
      "Deposit",
      "Final payment",
    ]),
    [stageAmounts, setStageAmounts] = useState<string[]>(["", ""]);
  useEffect(() => {
    setInviteSample(!!company?.is_demo);
    setSelectedInvite([]);
    setShowInvite(false);
  }, [company?.id, company?.is_demo]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    if (!detail || detail.job.id !== id) setLoading(true);
    setError("");
    api<JobDetail>(`/jobs/${id}`, { signal: controller.signal })
      .then((v) => {
        setDetail(v);
        setSelectedQuote((current) =>
          v.quotes.some((q) => q.id === current)
            ? current
            : v.selected?.id || v.quotes[0]?.id || "",
        );
        if (v.ownQuote) {
          setAmount(String(v.ownQuote.amount_cents / 100));
          setQuoteNote(v.ownQuote.note);
          setQuoteStart(v.ownQuote.start_window);
          setDuration(v.ownQuote.duration);
          setIncluded(v.ownQuote.included);
          setExcluded(v.ownQuote.excluded);
          setTerms(v.ownQuote.payment_terms);
          setBreakdown(
            (v.ownQuote.price_breakdown || []).map((x) => ({
              label: x.label,
              amount: String(x.amountCents / 100),
            })),
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision, company?.id]);
  const job = detail?.job,
    hirer = detail?.permissions.hirer,
    chosen = detail?.permissions.chosen,
    quote =
      detail?.quotes.find((q) => q.id === selectedQuote) ||
      detail?.selected ||
      null,
    participant = !!(hirer || chosen),
    selectedProvider = detail?.selected?.provider_company_id;
  useEffect(() => {
    setJobSection(
      detail &&
        (detail.permissions.hirer ||
          detail.permissions.chosen ||
          detail.permissions.quoted ||
          detail.permissions.invited)
        ? "mine"
        : "jobs",
    );
    return () => setJobSection(null);
  }, [
    detail?.permissions.hirer,
    detail?.permissions.chosen,
    detail?.permissions.quoted,
    detail?.permissions.invited,
    setJobSection,
  ]);
  const sortedQuotes = useMemo(() => {
    const items = [...(detail?.quotes || [])];
    if (quoteSort === "price")
      items.sort((a, b) => a.amount_cents - b.amount_cents);
    if (quoteSort === "price_desc")
      items.sort((a, b) => b.amount_cents - a.amount_cents);
    return items;
  }, [detail?.quotes, quoteSort]);
  const canMessage =
    !!company &&
    !!detail &&
    (hirer
      ? (detail.conversations || []).length > 0
      : job?.status === "open" ||
        chosen ||
        detail.permissions.quoted ||
        detail.permissions.invited);
  const messageProvider = hirer
    ? (detail?.conversations.some((c) => c.id === messageCompany)
        ? messageCompany
        : "") ||
      selectedProvider ||
      quote?.provider_company_id ||
      detail?.conversations?.[0]?.id
    : company?.id;
  const inboxPath = (provider = messageProvider) =>
    `/jobs/inbox?job=${id}&provider=${provider || ""}`;
  useEffect(() => {
    if (searchParams.get("tab") === "messages" && canMessage && messageProvider)
      navigate(`/jobs/inbox?job=${id}&provider=${messageProvider}`, {
        replace: true,
      });
  }, [id, canMessage, messageProvider, searchParams, navigate]);
  useEffect(() => {
    setMessage("");
  }, [messageProvider]);
  useEffect(() => {
    if (!showInvite) return;
    const controller = new AbortController();
    setInviteResults([]);
    const timer = window.setTimeout(() => {
      api<{ providers: Company[] }>(
        `/jobs/providers?q=${encodeURIComponent(inviteQ)}&sample=${inviteSample}`,
        { signal: controller.signal },
      )
        .then((v) =>
          setInviteResults(
            v.providers
              .filter(
                (c) => c.id !== company?.id && c.listing_status !== "unclaimed",
              )
              .slice(0, 8),
          ),
        )
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [showInvite, inviteQ, inviteSample, company?.id]);
  const mutate = async (path: string, body?: object, done?: string) => {
    if (!id) return;
    setWorking(true);
    setError("");
    try {
      await post(`/jobs/${id}/${path}`, body || {});
      refresh();
      if (done) toast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setWorking(false);
    }
  };
  const sendQuote = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setWorking(true);
    setError("");
    try {
      const r = await post<{ id: string }>(`/jobs/${id}/quote`, {
        amountCents: Math.round(Number(amount) * 100),
        note: quoteNote,
        startWindow: quoteStart,
        duration,
        included,
        excluded,
        paymentTerms: terms,
        priceBreakdown: breakdown.map((x) => ({
          label: x.label,
          amountCents: Math.round(Number(x.amount) * 100),
        })),
      });
      for (const file of quoteFiles) {
        await upload(id, file, { quoteId: r.id });
        setQuoteFiles((v) => v.filter((f) => f !== file));
      }
      toast(detail?.ownQuote ? "Quote updated" : "Quote sent");
      setQuoteEditing(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const addUpdate = async (kind: "progress" | "completion") => {
    if (!id) return;
    setWorking(true);
    setError("");
    try {
      const r =
        pendingUpdate ||
        (await post<{ id: string }>(`/jobs/${id}/updates`, {
          kind,
          body: update,
        }));
      setPendingUpdate({ id: r.id, kind });
      for (const file of updateFiles) {
        await upload(id, file, { updateId: r.id });
        setUpdateFiles((v) => v.filter((f) => f !== file));
      }
      setPendingUpdate(null);
      setUpdate("");
      setUpdateFiles([]);
      toast(kind === "completion" ? "Work sent for review" : "Update posted");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || messageBusy || !messageProvider) return;
    setMessageBusy(true);
    setError("");
    try {
      await post(`/jobs/${id}/messages`, {
        providerId: messageProvider,
        body: message,
      });
      setMessage("");
      toast("Message sent");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMessageBusy(false);
    }
  };
  const invite = async () => {
    if (
      await mutate("invite", { companyIds: selectedInvite }, "Invitations sent")
    ) {
      setShowInvite(false);
      setSelectedInvite([]);
    }
  };
  const decision = (
    title: string,
    text: string,
    label: string,
    path: string,
    body: object,
    done: string,
  ) =>
    open(
      <JobDecision
        title={title}
        text={text}
        label={label}
        onConfirm={async () => {
          await post(`/jobs/${id}/${path}`, body);
          refresh();
          toast(done);
        }}
      />,
    );
  const chooseQuote = (q: Quote) =>
    decision(
      `Choose ${q.company?.name}?`,
      `Their quote is ${money(q.amount_cents)}. They’ll be asked to confirm before the work starts. Your exact site address will be shared with them.`,
      "Choose company",
      "choose",
      { quoteId: q.id },
      "Company chosen",
    );
  const reportProblem = () =>
    open(
      <JobProblem
        onSubmit={async (body) => {
          await post(`/jobs/${id}/activity`, { kind: "problem", body });
          refresh();
          toast("Problem shared with the other company");
        }}
      />,
    );
  const editQuote = () => {
    setQuoteEditing(true);
    requestAnimationFrame(() =>
      document
        .getElementById("quote-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  if (loading)
    return (
      <div className="jobs-page">
        <div className="job-loading">Loading job…</div>
      </div>
    );
  if (error && !detail)
    return (
      <div className="jobs-page">
        <JobError text={error} />
        <Link to="/jobs" className="jobs-button jobs-secondary">
          Back to jobs
        </Link>
      </div>
    );
  if (!detail || !job) return null;
  const canQuote =
    !!company &&
    admin &&
    !hirer &&
    job.status === "open" &&
    (!job.quote_deadline ||
      new Date(job.quote_deadline).getTime() >= Date.now());
  const statusText: Record<JobStatus, string> = {
    draft: "Draft",
    open: "Receiving quotes",
    awarded: "Waiting for confirmation",
    in_progress: "In progress",
    review: "Ready for review",
    completed: "Finished",
    cancelled: "Cancelled",
  };
  const activeWork =
    !!participant &&
    ["awarded", "in_progress", "review", "completed"].includes(job.status);
  const comparing =
    !!hirer && job.status === "open" && detail.quotes.length > 0;
  const completion = detail.updates.find((u) => u.kind === "completion");
  const completionFiles = completion
    ? detail.files.filter((f) => f.update_id === completion.id)
    : [];
  return (
    <div
      data-status={job.status}
      className={`jobs-page job-detail job-workspace ${activeWork ? "is-active-work" : ""} ${comparing ? "is-comparing" : ""} ${canQuote && !quoteEditing ? "has-mobile-action" : ""}`}
    >
      <Link
        to={hirer || activeWork ? "/jobs/mine" : "/jobs"}
        className="job-back"
      >
        <ArrowLeft size={18} />
        {hirer || activeWork ? "My jobs" : "Find work"}
      </Link>
      <header className="workspace-job-header">
        <div className="workspace-job-heading">
          <div>
            <div className="workspace-title-line">
              <h1>{job.title || "Untitled draft"}</h1>
              <span className={`job-status ${cls(job.status)}`}>
                {statusText[job.status]}
              </span>
            </div>
            {activeWork ? (
              <div className="workspace-company-pair">
                <Link
                  to={`/jobs/companies/${detail.hiringCompany.slug}?back=${id}`}
                >
                  <Building2 size={20} />
                  {detail.hiringCompany.name}
                </Link>
                {detail.selected?.company && (
                  <>
                    <ArrowLeftRight size={19} />
                    <Link
                      to={`/jobs/companies/${detail.selected.company.slug}?back=${id}`}
                    >
                      <Building2 size={20} />
                      {detail.selected.company.name}
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <p className="workspace-job-meta">
                <span>
                  <MapPin size={17} />
                  {job.location || "Location to be added"}
                </span>
                <span>{workLabel(job.trade)}</span>
                <span>
                  <CalendarDays size={16} />
                  {job.start_window || "Flexible start"}
                </span>
                {job.people_needed && (
                  <span>
                    <Users size={16} />
                    {job.people_needed} people
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="workspace-heading-actions">
            {hirer && admin && ["draft", "open"].includes(job.status) && (
              <>
                {detail.quotes.length === 0 && (
                  <Link
                    className="jobs-button jobs-secondary"
                    to={`/jobs/${id}/edit`}
                  >
                    <Pencil size={16} />
                    Edit {job.status === "draft" ? "draft" : "job"}
                  </Link>
                )}
                {job.status === "open" && (
                  <Link
                    className="jobs-button jobs-secondary"
                    to={`/jobs/${id}/matches`}
                  >
                    <Users size={17} />
                    Company matches
                  </Link>
                )}
                {job.status === "open" && (
                  <button
                    className="jobs-button jobs-secondary"
                    onClick={() => setShowInvite(!showInvite)}
                  >
                    <Users size={17} />
                    Invite companies
                  </button>
                )}
              </>
            )}
            {hirer && job.status === "in_progress" && (
              <button
                className="jobs-button jobs-secondary"
                disabled={working}
                onClick={() =>
                  void mutate(
                    "activity",
                    { kind: "update_requested" },
                    "Update requested",
                  )
                }
              >
                <MessageCircle size={17} />
                Request update
              </button>
            )}
            {activeWork && !(hirer && job.status === "review") && (
              <button className="job-report-link" onClick={reportProblem}>
                Report a problem
              </button>
            )}
            {canQuote && !quoteEditing && (
              <button
                className="jobs-button jobs-primary job-quote-cta"
                onClick={editQuote}
              >
                {detail.ownQuote ? "Edit your quote" : "Send a quote"}
                <ArrowRight size={17} />
              </button>
            )}
            {!company &&
              job.status === "open" &&
              (!job.quote_deadline ||
                new Date(job.quote_deadline).getTime() >= Date.now()) && (
                <button
                  className="jobs-button jobs-primary"
                  onClick={
                    session.user && session.user.account_type !== "individual"
                      ? createCompany
                      : signIn
                  }
                >
                  {session.user?.account_type === "individual"
                    ? "Use a company account"
                    : session.user
                      ? "Create company profile"
                      : "Sign in to quote"}
                  <ArrowRight size={16} />
                </button>
              )}
          </div>
        </div>
        {activeWork && job.status !== "review" && (
          <ol className="workspace-job-steps" aria-label="Job progress">
            {["Company chosen", "Work underway", "Review work", "Finished"].map(
              (label, i) => {
                const current = (
                  {
                    awarded: 0,
                    in_progress: 1,
                    review: 2,
                    completed: 3,
                  } as Record<string, number>
                )[job.status];
                return (
                  <li
                    key={label}
                    className={
                      i < current || job.status === "completed"
                        ? "complete"
                        : i === current
                          ? "current"
                          : ""
                    }
                    aria-current={i === current ? "step" : undefined}
                  >
                    <span>
                      {i < current || job.status === "completed" ? (
                        <Check size={16} />
                      ) : (
                        <i />
                      )}
                    </span>
                    <b>{label}</b>
                  </li>
                );
              },
            )}
          </ol>
        )}
      </header>
      {detail.hiringCompany.is_demo && (
        <p className="job-demo-note">
          Demo job · Fictional example for testing
        </p>
      )}
      {job.status === "draft" && (
        <div className="jobs-panel job-draft-banner">
          <FileText size={20} />
          <span>
            <b>This job is a draft.</b> Finish it to make it visible to
            companies.
          </span>
          <Link to={`/jobs/${id}/edit`} className="jobs-button jobs-primary">
            Continue editing
          </Link>
        </div>
      )}
      {showInvite && (
        <div className="jobs-panel job-invite">
          <h2>Invite companies to quote</h2>
          <p>Invite companies with a managed profile to send a quote.</p>
          <label className="sample-toggle">
            <input
              type="checkbox"
              checked={inviteSample}
              onChange={(e) => {
                setInviteSample(e.target.checked);
                setSelectedInvite([]);
              }}
            />
            Show demo companies
          </label>
          <input
            value={inviteQ}
            onChange={(e) => setInviteQ(e.target.value)}
            placeholder="Search by company name"
            aria-label="Search companies to invite"
          />
          {inviteResults.map((c) => (
            <button
              key={c.id}
              className="job-invite-result"
              aria-pressed={selectedInvite.includes(c.id)}
              onClick={() =>
                setSelectedInvite((v) =>
                  v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id],
                )
              }
            >
              <JobLogo company={c} />
              <span>
                <b>{c.name}</b>
                <small>
                  {[c.location, c.is_demo ? "Demo company" : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              {selectedInvite.includes(c.id) && <Check size={18} />}
            </button>
          ))}
          {!inviteResults.length && (
            <p className="job-muted">
              No matching companies available to invite.
            </p>
          )}
          <div className="job-form-actions">
            <button
              className="jobs-button jobs-primary"
              disabled={!selectedInvite.length || working}
              onClick={() => void invite()}
            >
              Send {selectedInvite.length} invitation
              {selectedInvite.length === 1 ? "" : "s"}
            </button>
            <button
              className="jobs-button jobs-secondary"
              onClick={() => setShowInvite(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <JobError text={error} />
      {canMessage && (
        <div className="job-subnav">
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button onClick={() => navigate(inboxPath())}>Messages</button>
          {participant &&
            ["awarded", "in_progress", "review", "completed"].includes(
              job.status,
            ) && (
              <button
                className={tab === "payments" ? "active" : ""}
                onClick={() => setTab("payments")}
              >
                Payments
              </button>
            )}
        </div>
      )}
      {tab === "payments" && participant ? (
        <div className="jobs-detail-layout">
          <section className="jobs-panel">
            <h2>Payment plan</h2>
            <p className="job-muted">
              Payments happen directly between the two companies. Connect
              records only what each side reports.
            </p>
            {detail.paymentStages.length ? (
              detail.paymentStages.map((stage) => (
                <div className="job-payment" key={stage.id}>
                  <span>
                    <b>{stage.title}</b>
                    <small>
                      {{
                        planned: "Planned",
                        invoiced: "Invoice sent",
                        reported_paid: "Payment reported",
                        confirmed_received: "Payment received",
                      }[stage.status] || stage.status}
                      {stage.invoice_reference &&
                        ` · ${stage.invoice_reference}`}
                    </small>
                  </span>
                  <b>{money(stage.amount_cents)}</b>
                  {stage.status === "planned" && chosen && admin && (
                    <div className="job-invoice-action">
                      <input
                        aria-label={`Invoice reference for ${stage.title}`}
                        placeholder="Invoice reference (optional)"
                        maxLength={120}
                        value={invoiceRefs[stage.id] || ""}
                        onChange={(e) =>
                          setInvoiceRefs((v) => ({
                            ...v,
                            [stage.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        className="jobs-button jobs-secondary"
                        disabled={working}
                        onClick={() =>
                          void mutate(`payment-stages/${stage.id}`, {
                            status: "invoiced",
                            invoiceReference: invoiceRefs[stage.id] || "",
                          })
                        }
                      >
                        Mark invoiced
                      </button>
                    </div>
                  )}
                  {stage.status === "invoiced" && hirer && admin && (
                    <button
                      disabled={working}
                      className="jobs-button jobs-secondary"
                      onClick={() =>
                        void mutate(`payment-stages/${stage.id}`, {
                          status: "reported_paid",
                        })
                      }
                    >
                      Report paid
                    </button>
                  )}
                  {stage.status === "reported_paid" && chosen && admin && (
                    <button
                      disabled={working}
                      className="jobs-button jobs-secondary"
                      onClick={() =>
                        void mutate(`payment-stages/${stage.id}`, {
                          status: "confirmed_received",
                        })
                      }
                    >
                      Confirm received
                    </button>
                  )}
                </div>
              ))
            ) : (
              <JobEmpty
                title="No payment stages yet"
                detail="The hiring company can set stages after choosing a quote."
              />
            )}
            {hirer &&
              admin &&
              ["awarded", "in_progress"].includes(job.status) &&
              detail.paymentStages.every((s) => s.status === "planned") && (
                <div className="job-stage-editor">
                  <h3>Set payment stages</h3>
                  {stageTitles.map((title, i) => (
                    <div className="jobs-fields-two" key={i}>
                      <input
                        value={title}
                        onChange={(e) =>
                          setStageTitles((v) =>
                            v.map((x, n) => (n === i ? e.target.value : x)),
                          )
                        }
                        aria-label={`Payment stage ${i + 1} name`}
                        placeholder="Stage name"
                      />
                      <input
                        type="number"
                        min="1"
                        value={stageAmounts[i]}
                        onChange={(e) =>
                          setStageAmounts((v) =>
                            v.map((x, n) => (n === i ? e.target.value : x)),
                          )
                        }
                        aria-label={`Payment stage ${i + 1} amount`}
                        placeholder="Amount in USD"
                      />
                    </div>
                  ))}
                  <button
                    className="jobs-button jobs-secondary"
                    disabled={stageTitles.length >= 8 || working}
                    onClick={() => {
                      setStageTitles((v) => [...v, ""]);
                      setStageAmounts((v) => [...v, ""]);
                    }}
                  >
                    Add stage
                  </button>
                  <button
                    className="jobs-button jobs-primary"
                    disabled={working}
                    onClick={() =>
                      void mutate(
                        "payment-stages",
                        {
                          stages: stageTitles.map((title, i) => ({
                            title,
                            amountCents: Math.round(
                              Number(stageAmounts[i]) * 100,
                            ),
                          })),
                        },
                        "Payment plan saved",
                      )
                    }
                  >
                    Save plan
                  </button>
                  <small>
                    Total{" "}
                    {money(
                      stageAmounts.reduce(
                        (sum, n) => sum + Math.round(Number(n || 0) * 100),
                        0,
                      ),
                    )}{" "}
                    of {money(detail.selected?.amount_cents)} agreed.
                  </small>
                </div>
              )}
          </section>
          <aside className="jobs-panel">
            <h2>Agreed quote</h2>
            <strong className="job-price">
              {money(detail.selected?.amount_cents)}
            </strong>
            <p>
              {detail.selected?.payment_terms ||
                "Payment terms can be discussed in job messages."}
            </p>
            <p className="job-muted">
              <LockKeyhole size={15} /> No card or bank information is stored
              here.
            </p>
          </aside>
        </div>
      ) : (
        <JobDetailLayout
          comparing={comparing}
          bounded={!comparing && !activeWork}
        >
          {comparing && (
            <JobBriefSummary
              job={job}
              files={detail.files.filter((f) => !f.quote_id && !f.update_id)}
            />
          )}
          <section className="jobs-detail-main">
            {hirer && job.status === "open" && detail.quotes.length > 0 && (
              <div className="jobs-panel job-compare" id="received-quotes">
                <div className="jobs-section-title">
                  <h2>
                    {detail.quotes.length} quote
                    {detail.quotes.length === 1 ? "" : "s"} received
                  </h2>
                  <label className="job-sort">
                    Sort{" "}
                    <select
                      value={quoteSort}
                      onChange={(e) => setQuoteSort(e.target.value)}
                      aria-label="Sort quotes"
                    >
                      <option value="best">Newest first</option>
                      <option value="price">Lowest price</option>
                      <option value="price_desc">Highest price</option>
                    </select>
                  </label>
                </div>
                <p className="job-muted">
                  Compare the scope, price, and timing. Then choose a company.
                </p>
                <div className="job-quote-list">
                  {sortedQuotes.map((q) => (
                    <article
                      className={`quote-comparison-card ${selectedQuote === q.id ? "selected" : ""}`}
                      key={q.id}
                    >
                      <div className="quote-company-summary">
                        <Link
                          className="job-quote-company"
                          to={`/jobs/companies/${q.company?.slug}?back=${id}`}
                        >
                          <JobLogo company={q.company} />
                          <span className="job-quote-name">
                            <b>{q.company?.name}</b>
                            <small>
                              <MapPin size={14} />
                              {q.company?.location || "Location not added"}
                            </small>
                          </span>
                        </Link>
                        {!!q.company?.services?.length && (
                          <div className="quote-services">
                            {q.company.services.slice(0, 3).map((service) => (
                              <span key={service}>{service}</span>
                            ))}
                          </div>
                        )}
                        {!!q.job_review_count && q.job_rating != null ? (
                          <div className="quote-job-rating">
                            <small>Connect job rating</small>
                            <span>
                              <Star size={17} fill="currentColor" />
                              <b>{q.job_rating.toFixed(1)}</b>
                              <small>
                                ({q.job_review_count}{" "}
                                {q.job_review_count === 1
                                  ? "review"
                                  : "reviews"}
                                )
                              </small>
                            </span>
                          </div>
                        ) : (
                          <p className="quote-unrated">
                            No completed-job reviews yet
                          </p>
                        )}
                        {q.company?.is_demo && (
                          <small className="quote-demo-label">
                            Demo company
                          </small>
                        )}
                      </div>
                      <div className="quote-offer-summary">
                        <div className="quote-offer-facts">
                          <div>
                            <small>Quote amount</small>
                            <strong>{money(q.amount_cents)}</strong>
                          </div>
                          <div>
                            <small>Earliest start</small>
                            <b>{q.start_window || "To be agreed"}</b>
                            {q.duration && <span>{q.duration}</span>}
                          </div>
                        </div>
                        <div className="quote-proposal">
                          <b>Proposal</b>
                          <p>{q.note}</p>
                        </div>
                        <div className="quote-card-actions">
                          <button
                            className={`jobs-button ${selectedQuote === q.id ? "jobs-primary" : "jobs-secondary"}`}
                            disabled={working || !admin}
                            onClick={() => chooseQuote(q)}
                          >
                            Choose company
                          </button>
                          <button
                            className="jobs-button jobs-secondary"
                            aria-expanded={expandedQuote === q.id}
                            onClick={() => {
                              setSelectedQuote(q.id);
                              setExpandedQuote(
                                expandedQuote === q.id ? "" : q.id,
                              );
                            }}
                          >
                            {expandedQuote === q.id
                              ? "Hide details"
                              : "View quote"}
                            <ChevronDown size={15} />
                          </button>
                          <button
                            className="jobs-button jobs-secondary"
                            onClick={() => {
                              navigate(inboxPath(q.provider_company_id));
                            }}
                          >
                            <MessageCircle size={16} />
                            Message
                          </button>
                        </div>
                      </div>
                      {expandedQuote === q.id && (
                        <div className="quote-expanded-details">
                          <div className="quote-scope-details">
                            {q.included && (
                              <div>
                                <h3>Included</h3>
                                <p>{q.included}</p>
                              </div>
                            )}
                            {q.excluded && (
                              <div>
                                <h3>Not included</h3>
                                <p>{q.excluded}</p>
                              </div>
                            )}
                            {q.payment_terms && (
                              <div>
                                <h3>Payment terms</h3>
                                <p>{q.payment_terms}</p>
                              </div>
                            )}
                          </div>
                          {!!q.price_breakdown?.length && (
                            <div className="quote-breakdown-display">
                              {q.price_breakdown.map((item, i) => (
                                <span key={i}>
                                  {item.label}
                                  <b>{money(item.amountCents)}</b>
                                </span>
                              ))}
                            </div>
                          )}
                          <FileList
                            files={detail.files.filter(
                              (f) => f.quote_id === q.id,
                            )}
                          />
                          <Link
                            to={`/jobs/companies/${q.company?.slug}?back=${id}`}
                          >
                            View company profile <ArrowRight size={15} />
                          </Link>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
            {job.status === "review" && participant && (
              <div className="jobs-panel job-submitted">
                <h2>Work submitted</h2>
                {detail.updates
                  .filter((u) => u.kind === "completion")
                  .slice(0, 1)
                  .map((u) => (
                    <div className="job-completion" key={u.id}>
                      {u.body}
                    </div>
                  ))}
                <ReviewFileList files={completionFiles} />
                <ul className="completion-checklist">
                  <li>
                    <CheckCircle2 size={20} />
                    Final update submitted
                  </li>
                  {completionFiles.some((f) =>
                    f.mime_type.startsWith("image/"),
                  ) && (
                    <li>
                      <CheckCircle2 size={20} />
                      {
                        completionFiles.filter((f) =>
                          f.mime_type.startsWith("image/"),
                        ).length
                      }{" "}
                      {completionFiles.filter((f) =>
                        f.mime_type.startsWith("image/"),
                      ).length === 1
                        ? "final photo attached"
                        : "final photos attached"}
                    </li>
                  )}
                  {completionFiles.some(
                    (f) => f.mime_type === "application/pdf",
                  ) && (
                    <li>
                      <CheckCircle2 size={20} />
                      {
                        completionFiles.filter(
                          (f) => f.mime_type === "application/pdf",
                        ).length
                      }{" "}
                      {completionFiles.filter(
                        (f) => f.mime_type === "application/pdf",
                      ).length === 1
                        ? "document attached"
                        : "documents attached"}
                    </li>
                  )}
                </ul>
              </div>
            )}
            {job.status === "awarded" && chosen && admin && (
              <div className="jobs-panel job-accept">
                <h2>Your quote was chosen</h2>
                <p>
                  Confirm that your company is ready to take on this job. Then
                  you can share updates and files here.
                </p>
                <button
                  className="jobs-button jobs-primary"
                  disabled={working}
                  onClick={() => void mutate("confirm", {}, "Job confirmed")}
                >
                  Confirm job <Check size={17} />
                </button>
              </div>
            )}
            {participant &&
              ["awarded", "in_progress", "review", "completed"].includes(
                job.status,
              ) && (
                <div className="jobs-panel job-progress-panel">
                  <h2>
                    {job.status === "review" ? "Earlier updates" : "Progress"}
                  </h2>
                  {detail.updates.length ? (
                    detail.updates
                      .filter(
                        (u) =>
                          !(job.status === "review" && u.id === completion?.id),
                      )
                      .map((u) => (
                        <div className="job-update" key={u.id}>
                          <span className="job-update-dot" />
                          <div className="job-update-time">
                            <b>{date(u.created_at)}</b>
                            <small>{u.company_name}</small>
                          </div>
                          <div className="job-update-content">
                            <h3>
                              {u.kind === "completion"
                                ? "Work submitted"
                                : u.kind === "changes_requested"
                                  ? "Changes requested"
                                  : u.kind === "update_requested"
                                    ? "Update requested"
                                    : u.kind === "problem"
                                      ? "Problem reported"
                                      : "Progress update"}
                            </h3>
                            <p>{u.body}</p>
                            <FileList
                              files={detail.files.filter(
                                (f) => f.update_id === u.id,
                              )}
                            />
                          </div>
                        </div>
                      ))
                  ) : (
                    <p className="job-muted">No updates yet.</p>
                  )}
                  {job.status === "in_progress" && (
                    <div className="job-next workspace-next">
                      <CalendarDays size={19} />
                      <b>What happens next</b>
                      <span>
                        {chosen
                          ? "Send your final update and photos when the work is ready to review."
                          : "The company sends a final update when the work is ready for your review."}
                      </span>
                    </div>
                  )}
                  {job.status === "in_progress" && chosen && (
                    <div className="job-update-form">
                      <textarea
                        value={update}
                        onChange={(e) => setUpdate(e.target.value)}
                        rows={3}
                        placeholder={
                          chosen
                            ? "What has your team completed?"
                            : "Share an update with the selected company…"
                        }
                      />
                      <AttachmentPicker
                        files={updateFiles}
                        onChange={setUpdateFiles}
                        label="Add progress photos or files"
                        disabled={working}
                      />
                      <div className="job-form-actions">
                        <button
                          className="jobs-button jobs-secondary"
                          disabled={!update.trim() || working}
                          onClick={() => void addUpdate("progress")}
                        >
                          Post update
                        </button>
                        {chosen && (
                          <button
                            className="jobs-button jobs-primary"
                            disabled={!update.trim() || working}
                            onClick={() => void addUpdate("completion")}
                          >
                            Send work for review
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            {activeWork && job.status !== "completed" && canMessage && (
              <form
                className="jobs-panel workspace-quick-message"
                onSubmit={sendMessage}
              >
                <MessageCircle size={19} />
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={5000}
                  aria-label="Quick job message"
                  placeholder="Message about this job…"
                />
                <button
                  className="jobs-button jobs-primary"
                  disabled={!message.trim() || messageBusy}
                  type="submit"
                >
                  <Send size={16} />
                  <span>Send</span>
                </button>
              </form>
            )}
            {job.status === "completed" && participant && admin && (
              <div className="jobs-panel">
                <h2>Job finished</h2>
                <p>The work was accepted. Both companies can leave a review.</p>
                {detail.reviews.some(
                  (r) => r.reviewer_company_id === company?.id,
                ) ? (
                  <div className="job-next">
                    <CheckCircle2 size={19} /> Your review was submitted.
                  </div>
                ) : (
                  <div className="job-review-form">
                    <div className="job-stars" role="group" aria-label="Rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setRating(n)}
                          aria-label={`${n} stars`}
                          aria-pressed={rating === n}
                        >
                          <Star
                            size={27}
                            fill={n <= rating ? "currentColor" : "none"}
                          />
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      placeholder="How did the work together go?"
                      rows={3}
                    />
                    <button
                      className="jobs-button jobs-primary"
                      disabled={working}
                      onClick={() =>
                        void mutate(
                          "reviews",
                          { rating, text: reviewText },
                          "Review submitted",
                        )
                      }
                    >
                      Leave review
                    </button>
                  </div>
                )}
              </div>
            )}
            {!comparing && !activeWork && (
              <div className="jobs-panel job-brief" id="job-brief">
                <h2 id="job-brief-heading">About this job</h2>
                <div
                  className="job-brief-content"
                  role="region"
                  aria-labelledby="job-brief-heading"
                  tabIndex={0}
                >
                  <p className="job-description">
                    {job.description ||
                      "Add the scope before publishing this draft."}
                  </p>
                  {job.requirements && (
                    <div className="job-requirements">
                      <h3>What your team needs</h3>
                      <p className="job-description">{job.requirements}</p>
                    </div>
                  )}
                  <div className="job-facts">
                    {job.project_type && (
                      <span>
                        <Building2 size={17} />
                        {projectLabel(job.project_type)}
                      </span>
                    )}
                    {job.system_size_kw && (
                      <span>
                        <Wrench size={17} />
                        {job.system_size_kw} kW system
                      </span>
                    )}
                    {job.site_count && (
                      <span>
                        <MapPin size={17} />
                        {job.site_count}{" "}
                        {job.site_count === 1 ? "site" : "sites"}
                      </span>
                    )}
                    {job.materials_by && job.materials_by !== "to_agree" && (
                      <span>
                        <Wrench size={17} />
                        {materialsLabels[job.materials_by]}
                      </span>
                    )}
                    {job.exact_address && (
                      <span>
                        <LockKeyhole size={17} />
                        {job.exact_address}
                      </span>
                    )}
                  </div>
                  {detail.files.some(
                    (file) => !file.quote_id && !file.update_id,
                  ) && (
                    <div className="job-brief-attachments">
                      <h3>Plans & attachments</h3>{" "}
                      <FileList
                        files={detail.files.filter(
                          (f) => !f.quote_id && !f.update_id,
                        )}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {detail.ownQuote && !quoteEditing && !activeWork && (
              <div className="jobs-panel job-own-quote">
                <div className="jobs-section-title">
                  <h2>Your quote</h2>
                  <span className="job-status">
                    {detail.ownQuote.status.replaceAll("_", " ")}
                  </span>
                </div>
                <strong className="job-price">
                  {money(detail.ownQuote.amount_cents)}
                </strong>
                <p>{detail.ownQuote.note}</p>
                <div className="job-chips">
                  {detail.ownQuote.start_window && (
                    <span>
                      <CalendarDays size={14} />
                      {detail.ownQuote.start_window}
                    </span>
                  )}
                  {detail.ownQuote.duration && (
                    <span>
                      <Clock3 size={14} />
                      {detail.ownQuote.duration}
                    </span>
                  )}
                </div>
                <FileList
                  files={detail.files.filter(
                    (f) => f.quote_id === detail.ownQuote!.id,
                  )}
                />
                {canQuote && (
                  <button
                    className="jobs-button jobs-secondary"
                    onClick={editQuote}
                  >
                    Edit quote
                  </button>
                )}
              </div>
            )}
            {canQuote && quoteEditing && (
              <div className="jobs-panel" id="quote-form">
                <h2>{detail.ownQuote ? "Your quote" : "Send a quote"}</h2>
                <p className="job-muted">
                  Tell {detail.hiringCompany.name} what your company can
                  deliver. Only they can see this quote.
                </p>
                <form className="job-quote-form" onSubmit={sendQuote}>
                  <div className="jobs-fields-three">
                    <label>
                      Your price (USD)
                      <input
                        required
                        type="number"
                        min="1"
                        step="1"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="e.g. 275000"
                      />
                    </label>
                    <label>
                      Earliest start
                      <input
                        required
                        maxLength={120}
                        value={quoteStart}
                        onChange={(e) => setQuoteStart(e.target.value)}
                        placeholder="e.g. In 2 weeks"
                      />
                    </label>
                    <label>
                      Estimated duration
                      <input
                        required
                        maxLength={120}
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        placeholder="e.g. 3 weeks"
                      />
                    </label>
                  </div>
                  <label>
                    Your approach
                    <textarea
                      required
                      minLength={10}
                      rows={4}
                      value={quoteNote}
                      onChange={(e) => setQuoteNote(e.target.value)}
                      placeholder="Explain the work you’ll do and why your team is a fit."
                    />
                  </label>
                  <details>
                    <summary>Add a price breakdown (optional)</summary>
                    <div className="price-breakdown">
                      {breakdown.map((item, i) => (
                        <div className="price-breakdown-row" key={i}>
                          <input
                            aria-label={`Cost item ${i + 1}`}
                            maxLength={160}
                            required
                            placeholder="e.g. Installation labor"
                            value={item.label}
                            onChange={(e) =>
                              setBreakdown((v) =>
                                v.map((x, n) =>
                                  n === i ? { ...x, label: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <input
                            aria-label={`Cost item ${i + 1} amount in USD`}
                            required
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="USD"
                            value={item.amount}
                            onChange={(e) =>
                              setBreakdown((v) =>
                                v.map((x, n) =>
                                  n === i
                                    ? { ...x, amount: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Remove cost item ${i + 1}`}
                            onClick={() =>
                              setBreakdown((v) => v.filter((_, n) => n !== i))
                            }
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="job-text-button"
                        disabled={breakdown.length >= 20}
                        onClick={() =>
                          setBreakdown((v) => [...v, { label: "", amount: "" }])
                        }
                      >
                        Add cost item
                      </button>
                      {breakdown.length > 0 && (
                        <small>
                          Breakdown total:{" "}
                          {money(
                            breakdown.reduce(
                              (sum, x) =>
                                sum + Math.round(Number(x.amount || 0) * 100),
                              0,
                            ),
                          )}
                          . This must match your quote price.
                        </small>
                      )}
                    </div>
                  </details>
                  <details>
                    <summary>Add scope and payment details</summary>
                    <label>
                      Included
                      <textarea
                        value={included}
                        onChange={(e) => setIncluded(e.target.value)}
                        rows={2}
                      />
                    </label>
                    <label>
                      Not included
                      <textarea
                        value={excluded}
                        onChange={(e) => setExcluded(e.target.value)}
                        rows={2}
                      />
                    </label>
                    <label>
                      Payment terms
                      <textarea
                        value={terms}
                        onChange={(e) => setTerms(e.target.value)}
                        rows={2}
                      />
                    </label>
                  </details>
                  <AttachmentPicker
                    files={quoteFiles}
                    onChange={setQuoteFiles}
                    label="Add proposal files or photos"
                    disabled={working}
                  />
                  {detail.ownQuote && (
                    <FileList
                      files={detail.files.filter(
                        (f) => f.quote_id === detail.ownQuote!.id,
                      )}
                    />
                  )}
                  <button
                    className="jobs-button jobs-primary"
                    disabled={working}
                    type="submit"
                  >
                    {working
                      ? "Sending…"
                      : detail.ownQuote
                        ? "Update quote"
                        : "Send quote"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </form>
              </div>
            )}
          </section>
          {!comparing && (
            <aside className="jobs-aside">
              {job.status === "review" && hirer && admin && (
                <>
                  <div className="jobs-panel job-review-actions">
                    <h2>Review the work</h2>
                    <p>Check the final update before closing this job.</p>
                    <button
                      className="jobs-button jobs-primary"
                      disabled={working}
                      onClick={() =>
                        decision(
                          "Accept the finished work?",
                          "This closes the job and lets both companies leave a review. Confirm that the agreed scope is complete.",
                          "Accept and finish",
                          "review-work",
                          { decision: "accept", note: "" },
                          "Job finished",
                        )
                      }
                    >
                      Accept and finish job
                    </button>
                    {showReviewNote ? (
                      <>
                        <label className="job-review-note">
                          What needs to change?
                          <textarea
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            rows={3}
                            placeholder="Tell the company what remains"
                            autoFocus
                          />
                        </label>
                        <button
                          className="jobs-button jobs-secondary"
                          disabled={working || !reviewNote.trim()}
                          onClick={() =>
                            void mutate(
                              "review-work",
                              { decision: "changes", note: reviewNote },
                              "Changes requested",
                            )
                          }
                        >
                          Send request for changes
                        </button>
                      </>
                    ) : (
                      <button
                        className="jobs-button jobs-secondary"
                        onClick={() => setShowReviewNote(true)}
                      >
                        Request changes
                      </button>
                    )}
                    <button className="job-report-link" onClick={reportProblem}>
                      Report a problem
                    </button>
                  </div>
                  <div className="jobs-panel job-review-info">
                    <Info size={20} />
                    <span>
                      After you accept, both companies can leave a review.
                    </span>
                  </div>
                </>
              )}
              {activeWork &&
                (job.status === "review" ? (
                  <details className="workspace-review-details">
                    <summary>
                      <FileText size={17} />
                      Agreed job details
                      <ChevronDown size={16} />
                    </summary>
                    <WorkFacts job={job} detail={detail} />
                  </details>
                ) : (
                  <WorkFacts job={job} detail={detail} />
                ))}
              {!activeWork && (
                <section className="jobs-panel job-details-side">
                  <h2 id="job-details-heading">Job details</h2>
                  <div
                    className="job-details-content"
                    role="region"
                    aria-labelledby="job-details-heading"
                    tabIndex={0}
                  >
                    <div className="job-budget-summary">
                      <span>
                        {job.budget_cents != null ? "Total budget" : "Budget"}
                      </span>
                      <strong>
                        {job.budget_cents != null
                          ? money(job.budget_cents)
                          : "Open to quotes"}
                      </strong>
                    </div>
                    <div className="job-side-fact">
                      <b>
                        <CalendarDays size={16} />
                        Start
                      </b>
                      <span>{job.start_window || "Flexible"}</span>
                    </div>
                    {job.expected_duration && (
                      <div className="job-side-fact">
                        <b>
                          <Clock3 size={16} />
                          Duration
                        </b>
                        <span>{job.expected_duration}</span>
                      </div>
                    )}
                    {job.quote_deadline && (
                      <div className="job-side-fact">
                        <b>
                          <CalendarDays size={16} />
                          Quote deadline
                        </b>
                        <span>{date(job.quote_deadline)}</span>
                      </div>
                    )}
                    <div className="job-company-side">
                      <JobLogo company={detail.hiringCompany} />
                      <div>
                        <strong>{detail.hiringCompany.name}</strong>
                        <small>
                          Hiring company · {detail.hiringCompany.location}
                        </small>
                        <Link
                          to={`/jobs/companies/${detail.hiringCompany.slug}?back=${id}`}
                        >
                          View company profile <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                    {canMessage && (
                      <button
                        className="jobs-button jobs-secondary"
                        onClick={() => navigate(inboxPath())}
                      >
                        <MessageCircle size={16} />
                        Job messages
                      </button>
                    )}
                  </div>
                </section>
              )}
            </aside>
          )}
        </JobDetailLayout>
      )}
      {canQuote && !quoteEditing && (
        <div className="job-mobile-action">
          <span>
            {job.budget_cents != null
              ? money(job.budget_cents)
              : "Open to quotes"}
            <small>
              {job.budget_cents != null
                ? "Total budget"
                : "Send your price and availability"}
            </small>
          </span>
          <button className="jobs-button jobs-primary" onClick={editQuote}>
            {detail.ownQuote ? "Edit quote" : "Send a quote"}
          </button>
        </div>
      )}
    </div>
  );
}

function JobDetailLayout({
  comparing,
  bounded,
  children,
}: {
  comparing: boolean;
  bounded: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!bounded || !element) return;
    const measure = () => {
      // Use the document position so scrolling never changes the reading area.
      const top = element.getBoundingClientRect().top + window.scrollY;
      const height = `${Math.max(320, Math.floor(window.innerHeight - top - 24))}px`;
      if (element.style.getPropertyValue("--job-overview-height") !== height)
        element.style.setProperty("--job-overview-height", height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (element.parentElement) observer.observe(element.parentElement);
    const header = document.querySelector(".jobs-site-header");
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [bounded]);
  return (
    <div
      ref={ref}
      className={`jobs-detail-layout workspace-detail-layout ${comparing ? "quote-comparison-layout" : ""} ${bounded ? "job-overview-layout" : ""}`}
    >
      {children}
    </div>
  );
}

function JobBriefSummary({ job, files }: { job: Job; files: JobFile[] }) {
  return (
    <aside className="jobs-panel workspace-brief-summary" id="job-brief">
      <h2>Job summary</h2>
      <section>
        <h3>Scope</h3>
        <p>{job.description}</p>
      </section>
      {!!files.length && (
        <section>
          <h3>
            <Paperclip size={19} />
            Attachments ({files.length})
          </h3>
          <FileList files={files} />
        </section>
      )}
      {job.quote_deadline && (
        <section>
          <h3>
            <CalendarDays size={19} />
            Quote deadline
          </h3>
          <p>{date(job.quote_deadline)}</p>
        </section>
      )}
      {job.budget_cents != null && (
        <section>
          <h3>
            <Tag size={19} />
            Budget
          </h3>
          <p>{money(job.budget_cents)}</p>
        </section>
      )}
      {job.materials_by && job.materials_by !== "to_agree" && (
        <section>
          <h3>
            <Wrench size={19} />
            Materials
          </h3>
          <p>{materialsLabels[job.materials_by]}</p>
        </section>
      )}
      {job.requirements && (
        <section>
          <h3>Requirements</h3>
          <p>{job.requirements}</p>
        </section>
      )}
      {(job.project_type ||
        job.system_size_kw ||
        job.site_count ||
        job.people_needed ||
        job.expected_duration) && (
        <section>
          <h3>
            <Layers3 size={19} />
            Work details
          </h3>
          <dl className="workspace-brief-facts">
            {job.project_type && (
              <div>
                <dt>Project</dt>
                <dd>{projectLabel(job.project_type)}</dd>
              </div>
            )}
            {job.system_size_kw && (
              <div>
                <dt>System size</dt>
                <dd>{job.system_size_kw} kW</dd>
              </div>
            )}
            {job.site_count && (
              <div>
                <dt>Sites</dt>
                <dd>{job.site_count}</dd>
              </div>
            )}
            {job.people_needed && (
              <div>
                <dt>Team</dt>
                <dd>{job.people_needed} people</dd>
              </div>
            )}
            {job.expected_duration && (
              <div>
                <dt>Duration</dt>
                <dd>{job.expected_duration}</dd>
              </div>
            )}
          </dl>
        </section>
      )}
      <section className="workspace-privacy-note">
        <LockKeyhole size={19} />
        <div>
          <h3>Private quotes</h3>
          <p>Each company sees only its own quote and conversation with you.</p>
        </div>
      </section>
    </aside>
  );
}
function WorkFacts({ job, detail }: { job: Job; detail: JobDetail }) {
  const files = detail.files.filter(
    (f) => !f.update_id && (!f.quote_id || f.quote_id === detail.selected?.id),
  );
  return (
    <section className="jobs-panel workspace-work-facts">
      <h2>Job details</h2>
      <dl>
        <div>
          <dt>
            <Tag size={19} />
            Selected quote
          </dt>
          <dd>
            <strong>{money(detail.selected?.amount_cents)}</strong>
            {detail.selected?.payment_terms && (
              <small>{detail.selected.payment_terms}</small>
            )}
          </dd>
        </div>
        <div>
          <dt>
            <CalendarDays size={19} />
            Agreed start
          </dt>
          <dd>
            {detail.selected?.start_window ||
              job.start_window ||
              "To be agreed"}
          </dd>
        </div>
        {detail.selected?.duration && (
          <div>
            <dt>
              <Clock3 size={19} />
              Duration
            </dt>
            <dd>{detail.selected.duration}</dd>
          </div>
        )}
        {job.people_needed && (
          <div>
            <dt>
              <Users size={19} />
              Team needed
            </dt>
            <dd>{job.people_needed} people</dd>
          </div>
        )}
        {job.materials_by && job.materials_by !== "to_agree" && (
          <div>
            <dt>
              <Wrench size={19} />
              Materials
            </dt>
            <dd>{materialsLabels[job.materials_by]}</dd>
          </div>
        )}
        <div>
          <dt>
            <Layers3 size={19} />
            Scope
          </dt>
          <dd>
            <p>{job.description}</p>
            {job.requirements && (
              <details>
                <summary>Requirements</summary>
                <p>{job.requirements}</p>
              </details>
            )}
            {detail.selected?.included && (
              <details>
                <summary>Included in quote</summary>
                <p>{detail.selected.included}</p>
              </details>
            )}
            {detail.selected?.excluded && (
              <details>
                <summary>Not included</summary>
                <p>{detail.selected.excluded}</p>
              </details>
            )}
          </dd>
        </div>
        <div>
          <dt>
            <MapPin size={19} />
            {job.exact_address ? "Site address" : "Location"}
          </dt>
          <dd>
            {job.exact_address || job.location}
            {job.exact_address && (
              <small>
                <LockKeyhole size={13} />
                Only visible to the two companies on this job.
              </small>
            )}
          </dd>
        </div>
      </dl>
      {!!files.length && (
        <div className="workspace-documents">
          <h3>
            <FileText size={19} />
            Documents & photos
          </h3>
          <FileList files={files} />
        </div>
      )}
    </section>
  );
}
function JobProblem({
  onSubmit,
}: {
  onSubmit: (body: string) => Promise<void>;
}) {
  const { close } = useApp();
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  usePageGuard(!!body, busy);
  return (
    <form
      className="manage-dialog job-problem-dialog"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit(body);
          close(true);
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <span className="workspace-dialog-icon">
        <CircleAlert size={24} />
      </span>
      <h2>Report a problem</h2>
      <p>
        Explain what happened and what you need. This is saved in the job’s
        private history and shared with the other company.
      </p>
      <label>
        What’s the problem?
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          minLength={10}
          maxLength={5000}
          required
          autoFocus
          placeholder="Describe the issue and the next step you’d like…"
        />
      </label>
      <JobError text={error} />
      <div className="job-form-actions">
        <button
          type="button"
          className="jobs-button jobs-secondary"
          onClick={close}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="jobs-button jobs-primary"
          disabled={busy || body.trim().length < 10}
        >
          {busy ? "Sending…" : "Share problem"}
        </button>
      </div>
    </form>
  );
}

function JobDecision({
  title,
  text,
  label,
  onConfirm,
}: {
  title: string;
  text: string;
  label: string;
  onConfirm: () => Promise<void>;
}) {
  const { close } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  usePageGuard(false, busy);
  return (
    <section className="manage-dialog job-confirm-dialog">
      <h2>{title}</h2>
      <p>{text}</p>
      <JobError text={error} />
      <div className="job-form-actions">
        <button
          className="jobs-button jobs-secondary"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
        <button
          className="jobs-button jobs-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              close(true);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : label}
        </button>
      </div>
    </section>
  );
}

function ReviewFileList({ files }: { files: JobFile[] }) {
  return <JobAttachments files={files} />;
}
function FileList({ files }: { files: JobFile[] }) {
  return <JobAttachments files={files} />;
}
