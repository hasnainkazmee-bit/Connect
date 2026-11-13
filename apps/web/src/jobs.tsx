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
import { MyJobsWorkspace } from "./my-jobs";
import {
  QuestionBuilder,
  ProposalAnswerFields,
  ProposalAnswers,
  type ProposalQuestion,
  type ProposalAnswer,
} from "./proposal-questions";
import "./job-quote-workflow.css";
import { WorkChecklist, type WorkChecklistItem } from "./work-checklist";

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
  work_checklist?: WorkChecklistItem[];
  checklist_version?: number;
  proposal_questions?: ProposalQuestion[];
  questions_version?: number;
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
export type Quote = {
  proposal_answers?: ProposalAnswer[];
  questions_version?: number;
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
  current_version: number;
  upload_pending?: boolean;
  accepted_version?: number | null;
  decision_note?: string;
  company?: Company;
};
type JobUpdate = {
  provider_company_id?: string | null;
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
  agreement?: {
    revision: number;
    quote_version: number;
    amount_cents: number;
    start_window: string;
    duration: string;
    scope: string;
  } | null;
  paymentStagesNeedReview?: boolean;
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
function JobCard({ job }: { job: Job }) {
  return (
    <Link className="job-card" to={`/jobs/${job.id}`}>
      <div className="job-card-overline">
        <span className="job-card-category">{workLabel(job.trade)}</span>
        <span>Posted {date(job.created_at)}</span>
        {job.company?.is_demo && <span className="job-card-demo">Demo</span>}
      </div>
      <div className="job-card-top">
        <div className="job-card-main">
          <h2>{job.title || "Untitled draft"}</h2>
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
          <small>
            {job.budget_cents != null ? "Budget" : "Budget not set"}
          </small>
          <strong>
            {job.budget_cents != null
              ? money(job.budget_cents)
              : "Open to quotes"}
          </strong>
          {job.budget_cents == null && <span>Propose your price</span>}
        </div>
      </div>
      <dl className="job-card-facts">
        <div>
          <dt>
            <CalendarDays size={15} />
            Start
          </dt>
          <dd>{job.start_window || "To be agreed"}</dd>
        </div>
        {job.people_needed && (
          <div>
            <dt>
              <Users size={15} />
              People needed
            </dt>
            <dd>{job.people_needed}</dd>
          </div>
        )}
        {job.expected_duration && (
          <div>
            <dt>
              <Clock3 size={15} />
              Duration
            </dt>
            <dd>{job.expected_duration}</dd>
          </div>
        )}
        {(job.project_type || job.system_size_kw) && (
          <div>
            <dt>
              <Layers3 size={15} />
              Project
            </dt>
            <dd>
              {[
                job.project_type && projectLabel(job.project_type),
                job.system_size_kw && `${job.system_size_kw} kW`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        )}
      </dl>
      <div className="job-card-footer">
        <span className="job-card-company">
          <JobLogo company={job.company} />
          <span>
            <b>{job.company?.name}</b>
            {job.invited && <small>Invited to quote</small>}
          </span>
        </span>
        <span className="job-card-cta">
          View job
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
  const requestQuery = mine ? "" : params.toString();
  useEffect(() => {
    setQ(params.get("q") || "");
    setLocation(params.get("location") || "");
    setTrade(params.get("trade") || "");
  }, [params]);
  useLayoutEffect(() => {
    if (mine && !company) {
      setLoading(false);
      setJobs([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams(requestQuery);
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
  }, [mine, requestQuery, sample, revision, company?.id, retry]);
  useEffect(() => {
    setMyWork([]);
    if (!company || mine) return;
    const c = new AbortController();
    api<{ jobs: Job[] }>("/jobs/mine", { signal: c.signal })
      .then((v) => setMyWork(v.jobs))
      .catch(() => {});
    return () => c.abort();
  }, [company?.id, mine, revision]);
  const groups: Record<string, Job[]> = {
    quotes: myWork.filter((j) => j.my_quote_status),
    invitations: myWork.filter(
      (j) => j.invited && j.status === "open" && !j.my_quote_status,
    ),
    active: myWork.filter(
      (j) =>
        ["awarded", "in_progress", "review"].includes(j.status) &&
        (j.hiring_company_id === company?.id || j.my_quote_status === "chosen"),
    ),
  };
  const canManage = company?.role === "owner" || company?.role === "admin";
  const visible = jobs;
  const appliedFilters = [
    params.get("q"),
    params.get("location"),
    params.get("trade") && workLabel(params.get("trade")!),
  ].filter(Boolean);
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
  if (mine && company)
    return (
      <MyJobsWorkspace
        jobs={jobs}
        companyId={company.id}
        canManage={canManage}
        loading={loading}
        error={error}
        onRetry={() => setRetry((n) => n + 1)}
      />
    );
  return (
    <div className="jobs-page work-discovery">
      <div className="jobs-heading market-page-heading">
        <div>
          <h1>Find your next job</h1>
          <p>
            Open jobs from solar companies. Find the work your team can take on.
          </p>
        </div>
      </div>
      <div className="jobs-layout work-discovery-layout">
        <section className="jobs-list">
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
            <button className="jobs-button jobs-secondary" type="submit">
              Search
              <ArrowRight size={16} />
            </button>
          </form>
          {appliedFilters.length > 0 && (
            <div className="job-applied-filters">
              <span>Showing: {appliedFilters.join(" · ")}</span>
              <button
                type="button"
                onClick={() => setParams({ sample: String(sample) })}
              >
                Clear filters
                <X size={14} />
              </button>
            </div>
          )}
          <div className="jobs-section-title">
            <div className="job-results-title">
              <h2>
                {appliedFilters.length ? "Matching your search" : "Latest jobs"}
              </h2>
              <span aria-live="polite">
                {loading
                  ? "Loading…"
                  : `${visible.length} ${visible.length === 1 ? "job" : "jobs"}${hasMore ? " on this page" : ""}${page > 1 ? ` · Page ${page}` : ""}`}
              </span>
              {!loading && !!visible.length && <small>Newest first</small>}
            </div>
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
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          ) : (
            <div className="job-empty">
              <BriefcaseBusiness size={28} />
              <h2>No matching jobs right now</h2>
              <p>
                Try a wider area or a different type of work. New jobs will
                appear here as companies post them.
              </p>
              <div className="job-empty-actions">
                {q || location || trade ? (
                  <button
                    className="jobs-button jobs-secondary"
                    onClick={() => setParams({ sample: String(sample) })}
                  >
                    Clear search
                  </button>
                ) : (
                  <Link className="jobs-button jobs-primary" to="/jobs/new">
                    Post a job
                    <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            </div>
          )}
          {(hasMore || page > 1) && (
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
  const { id } = useParams();
  const { company, session } = useApp();
  return (
    <NewJobForm
      key={`${id || "new"}:${session.user?.id || "guest"}:${company?.id || "none"}`}
    />
  );
}

function NewJobForm() {
  const { id } = useParams(),
    { company, admin, session, createCompany, signIn, toast } = useApp(),
    navigate = useNavigate();
  const [editReady, setEditReady] = useState(!id);
  const [jobIsDraft, setJobIsDraft] = useState(!id);
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
  const [questions, setQuestions] = useState<ProposalQuestion[]>([]);
  const [workChecklist, setWorkChecklist] = useState<
    { id: string; title: string }[]
  >([]);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [checklistNotice, setChecklistNotice] = useState("");
  const checklistInput = useRef<HTMLInputElement>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [budgetMode, setBudgetMode] = useState("quotes");
  const [budgetFocused, setBudgetFocused] = useState(false);
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
    const controller = new AbortController();
    api<JobDetail>(`/jobs/${id}`, { signal: controller.signal })
      .then(({ job, permissions, quotes, files: storedFiles }) => {
        if (controller.signal.aborted) return;
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
        setQuestions(job.proposal_questions || []);
        setWorkChecklist(
          (job.work_checklist || []).map(({ id, title }) => ({ id, title })),
        );
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
        setJobIsDraft(job.status === "draft");
        setDeadline(
          job.quote_deadline
            ? new Date(job.quote_deadline).toLocaleDateString("en-CA")
            : "",
        );
        setExact(job.exact_address || "");
        setEditReady(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
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
  const addChecklistItem = () => {
    const itemTitle = checklistDraft.trim();
    if (!itemTitle || workChecklist.length >= 30) return;
    setWorkChecklist((current) => [
      ...current,
      { id: crypto.randomUUID(), title: itemTitle },
    ]);
    setChecklistDraft("");
    setChecklistNotice(`Task ${workChecklist.length + 1} added.`);
    checklistInput.current?.focus();
  };
  const publish = async (status: "open" | "draft") => {
    const emptyQuestion = questions.findIndex(
      (question) => !question.prompt.trim(),
    );
    if (emptyQuestion !== -1) {
      setError(
        `Write question ${emptyQuestion + 1}, or remove it before saving.`,
      );
      document
        .getElementById("proposal-question-" + questions[emptyQuestion].id)
        ?.focus();
      return;
    }
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
    let checklistToSave = workChecklist;
    if (checklistDraft.trim()) {
      if (workChecklist.length >= 30) {
        setError(
          "You can add up to 30 tasks. Remove one before adding another.",
        );
        checklistInput.current?.focus();
        return;
      }
      checklistToSave = [
        ...workChecklist,
        { id: crypto.randomUUID(), title: checklistDraft.trim() },
      ];
      setWorkChecklist(checklistToSave);
      setChecklistDraft("");
    }
    setSavingDraft(status === "draft");
    setBusy(true);
    setError("");
    try {
      const body = {
        workChecklist: checklistToSave,
        proposalQuestions: questions,
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
          : id && !jobIsDraft
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
  const checklistPreview = checklistDraft.trim()
    ? [...workChecklist, { id: "pending", title: checklistDraft.trim() }]
    : workChecklist;
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
          <section
            className="posting-section posting-section-scope"
            aria-labelledby="posting-scope-heading"
          >
            <header className="posting-section-heading">
              <h3 id="posting-scope-heading">What do you need?</h3>
              <p>Start with the work so companies can understand the job.</p>
            </header>
            <label>
              Job title
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
            <section
              className="posting-checklist"
              aria-labelledby="posting-checklist-heading"
            >
              <header>
                <h4 id="posting-checklist-heading">
                  What needs to be completed?{" "}
                  <span className="field-optional">Optional</span>
                </h4>
                <p>
                  Add the work you’ll review. The company submits proof for each
                  item, and you approve it.
                </p>
              </header>
              {!!workChecklist.length && (
                <ol className="posting-checklist-items">
                  {workChecklist.map((item, index) => (
                    <li key={item.id}>
                      <span>{item.title}</span>
                      <button
                        type="button"
                        aria-label={`Remove task ${index + 1}: ${item.title}`}
                        disabled={busy}
                        onClick={() => {
                          setWorkChecklist((current) =>
                            current.filter((task) => task.id !== item.id),
                          );
                          setChecklistNotice(`Task ${index + 1} removed.`);
                          checklistInput.current?.focus();
                        }}
                      >
                        <X size={17} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="posting-checklist-entry">
                <input
                  ref={checklistInput}
                  aria-label="Task to complete"
                  aria-describedby="posting-checklist-count"
                  type="text"
                  autoComplete="off"
                  value={checklistDraft}
                  maxLength={300}
                  disabled={busy || workChecklist.length >= 30}
                  onChange={(event) => setChecklistDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      addChecklistItem();
                    }
                  }}
                  placeholder="e.g. Complete electrical testing"
                />
                <button
                  type="button"
                  className="jobs-button jobs-secondary"
                  disabled={
                    busy || !checklistDraft.trim() || workChecklist.length >= 30
                  }
                  onClick={addChecklistItem}
                >
                  Add
                </button>
              </div>
              <small
                id="posting-checklist-count"
                className="posting-checklist-count"
              >
                {workChecklist.length} / 30 tasks
              </small>
              <span className="sr-only" role="status">
                {checklistNotice}
              </span>
            </section>
          </section>
          <section
            className="posting-section posting-section-location"
            aria-labelledby="posting-location-heading"
          >
            <header className="posting-section-heading">
              <h3 id="posting-location-heading">Where and when</h3>
            </header>
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
            <div className="jobs-fields-two posting-location-fields">
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
            <div className="jobs-fields-two posting-availability-fields">
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
              {trade === "crew" && (
                <label>
                  People needed{" "}
                  <span className="field-optional">(optional)</span>
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
              )}
            </div>
            {arrangement !== "remote" && (
              <details className="posting-address-details">
                <summary>
                  Exact address and postal code <span>Optional</span>
                  <ChevronDown size={17} />
                </summary>
                <p>
                  The exact address is shared only with the company you choose.
                </p>
                <div className="jobs-fields-two">
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
                </div>
              </details>
            )}
          </section>
          <section
            className="posting-section posting-section-files"
            aria-labelledby="posting-files-heading"
          >
            <header className="posting-section-heading">
              <h3 id="posting-files-heading">
                Files and photos{" "}
                <span className="field-optional">Optional</span>
              </h3>
              <p>Add plans, photos, or documents that explain the work.</p>
            </header>
            <AttachmentPicker
              files={files}
              onChange={setFiles}
              label="Add files or photos"
              disabled={busy}
            />
            <FileList files={existingFiles} />
          </section>
          <div className="posting-section posting-section-questions">
            <QuestionBuilder
              value={questions}
              onChange={setQuestions}
              disabled={busy}
            />
          </div>
          <div className="posting-section posting-section-matching">
            <MatchingFields value={matching} onChange={setMatching} />
          </div>
          <details className="posting-more posting-section-options">
            <summary>
              Requirements & project details <span>Optional</span>
              <ChevronDown size={17} />
            </summary>
            <div className="posting-more-fields">
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
            </div>
          </details>
          <section
            className="posting-section posting-budget-section"
            aria-label="Budget and quote deadline"
          >
            <header className="posting-section-heading">
              <h3>Budget and deadline</h3>
              <p>
                Set a budget if you have one, or let companies suggest a price.
              </p>
            </header>
            <div
              className={`posting-budget-fields ${budgetMode === "fixed" ? "has-total" : ""}`}
            >
              <label
                className="posting-budget-preference"
                htmlFor="job-budget-preference"
              >
                Budget
                <select
                  id="job-budget-preference"
                  aria-label="Budget preference"
                  value={budgetMode}
                  onChange={(e) => setBudgetMode(e.target.value)}
                >
                  <option value="quotes">I’d like to receive quotes</option>
                  <option value="fixed">I have a total budget</option>
                </select>
              </label>
              {budgetMode === "fixed" && (
                <label
                  className="posting-budget-amount"
                  htmlFor="job-total-budget"
                >
                  Total budget <span className="field-optional">(USD)</span>
                  <span className="posting-budget-money">
                    <span aria-hidden="true">$</span>
                    <input
                      id="job-total-budget"
                      aria-label="Total budget in USD"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      required
                      maxLength={20}
                      value={
                        budgetFocused ||
                        !budget ||
                        !Number.isFinite(Number(budget))
                          ? budget
                          : new Intl.NumberFormat("en-US", {
                              minimumFractionDigits:
                                budget.split(".")[1]?.length || 0,
                              maximumFractionDigits: 2,
                            }).format(Number(budget))
                      }
                      onFocus={() => setBudgetFocused(true)}
                      onBlur={() => {
                        setBudgetFocused(false);
                        if (budget && !Number.isFinite(Number(budget)))
                          setBudget("");
                      }}
                      onChange={(e) => {
                        const amount = e.target.value.replace(/[$,\s]/g, "");
                        if (/^\d*(?:\.\d{0,2})?$/.test(amount))
                          setBudget(amount);
                      }}
                      placeholder="75,000"
                    />
                  </span>
                </label>
              )}
              <label
                className="posting-quote-deadline"
                htmlFor="job-quote-deadline"
              >
                Quote deadline{" "}
                <span className="field-optional">(optional)</span>
                <input
                  id="job-quote-deadline"
                  aria-label="Quote deadline"
                  type="date"
                  min={today}
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </label>
            </div>
          </section>
          <footer className="posting-actions">
            <button
              type="submit"
              className="jobs-button jobs-primary"
              disabled={busy}
            >
              {busy && !savingDraft
                ? "Publishing…"
                : id && !jobIsDraft
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
              {!!checklistPreview.length && (
                <section className="posting-preview-checklist">
                  <h4>Tasks to complete</h4>
                  <ul>
                    {checklistPreview.slice(0, 4).map((item) => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                  </ul>
                  {checklistPreview.length > 4 && (
                    <small>+{checklistPreview.length - 4} more tasks</small>
                  )}
                </section>
              )}
              {budgetMode === "fixed" &&
                budget &&
                Number.isFinite(Number(budget)) &&
                Number(budget) > 0 && (
                  <div className="preview-budget">
                    <span>Budget</span>
                    <b>{money(Math.round(Number(budget) * 100))}</b>
                  </div>
                )}
              {!!files.length && (
                <AttachmentPicker files={files} onChange={setFiles} readOnly />
              )}
              <FileList files={existingFiles} />
              <JobQuestions
                questions={questions.filter((q) => q.prompt.trim())}
              />
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

const fileUploadIds = new WeakMap<File, string>();
async function upload(
  jobId: string,
  file: File,
  destination?: { quoteId?: string; quoteVersion?: string; updateId?: string },
) {
  const issue = fileError([file]);
  if (issue) throw new Error(issue);
  let uploadId = fileUploadIds.get(file);
  if (!uploadId) {
    uploadId = crypto.randomUUID();
    fileUploadIds.set(file, uploadId);
  }
  const params = new URLSearchParams({
    name: file.name,
    uploadId,
    ...destination,
  });
  return api<{ id: string }>(`/jobs/${jobId}/files?${params}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

export function JobDetailPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
    [tab, setTab] = useState<"overview" | "updates" | "details" | "payments">(
      searchParams.get("tab") === "payments" ? "payments" : "overview",
    );
  const messageCompany = searchParams.get("provider") || "";
  const [messageBusy, setMessageBusy] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [checklistDirty, setChecklistDirty] = useState(false);
  const [quoteEditing, setQuoteEditing] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [quoteAnswers, setQuoteAnswers] = useState<Record<string, string>>({});
  const answerContext = useRef("");
  const [proposalDraft, setProposalDraft] = useState<{
    questions: ProposalQuestion[];
    questionsVersion: number;
    quoteVersion?: number;
  } | null>(null);
  const [pendingQuote, setPendingQuote] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const proposalFormOpen = useRef(false);
  const quoteDraftHeld = useRef(false);
  proposalFormOpen.current =
    quoteEditing || !!pendingQuote || quoteDraftHeld.current;
  const [breakdown, setBreakdown] = useState<
    { label: string; amount: string }[]
  >([]);
  const [invoiceRefs, setInvoiceRefs] = useState<Record<string, string>>({});
  const [quoteAmountFocused, setQuoteAmountFocused] = useState(false);
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
  const [paymentPlanBaseline, setPaymentPlanBaseline] = useState(() =>
    JSON.stringify([
      ["Deposit", "Final payment"],
      ["", ""],
    ]),
  );
  const paymentPlanSnapshot = JSON.stringify([stageTitles, stageAmounts]);
  const paymentPlanDirty = paymentPlanSnapshot !== paymentPlanBaseline;
  const paymentPlanDirtyRef = useRef(paymentPlanDirty);
  paymentPlanDirtyRef.current = paymentPlanDirty;
  const answersDirty = proposalDraft?.questions.some(
    (question) =>
      (quoteAnswers[question.id] || "") !==
      (detail?.ownQuote?.proposal_answers?.find(
        (answer) => answer.questionId === question.id,
      )?.answer || ""),
  );
  usePageGuard(
    checklistDirty ||
      !!update.trim() ||
      !!updateFiles.length ||
      !!message.trim() ||
      !!reviewNote.trim() ||
      !!reviewText.trim() ||
      rating !== 5 ||
      paymentPlanDirty ||
      Object.values(invoiceRefs).some((value) => !!value.trim()) ||
      !!pendingQuote ||
      !!pendingUpdate ||
      ((quoteEditing || quoteDraftHeld.current) &&
        (!!answersDirty ||
          !!quoteFiles.length ||
          !!revisionNote.trim() ||
          amount !==
            (detail?.ownQuote
              ? String(detail.ownQuote.amount_cents / 100)
              : "") ||
          quoteNote !== (detail?.ownQuote?.note || "") ||
          quoteStart !== (detail?.ownQuote?.start_window || "") ||
          duration !== (detail?.ownQuote?.duration || "") ||
          included !== (detail?.ownQuote?.included || "") ||
          excluded !== (detail?.ownQuote?.excluded || "") ||
          terms !== (detail?.ownQuote?.payment_terms || "") ||
          JSON.stringify(
            breakdown.map((item) => ({
              label: item.label,
              amountCents: Math.round(Number(item.amount) * 100),
            })),
          ) !== JSON.stringify(detail?.ownQuote?.price_breakdown || []))),
    working || checklistSaving || messageBusy,
  );
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
        if (controller.signal.aborted) return;
        setDetail(v);
        const context = `${v.job.id}:${company?.id || "guest"}`;
        const contextChanged = answerContext.current !== context;
        const hydrateProposal = contextChanged || !proposalFormOpen.current;
        if (contextChanged) {
          quoteDraftHeld.current = false;
          setQuoteEditing(false);
          setPendingQuote(null);
          setQuoteFiles([]);
          setRevisionNote("");
          setTab(
            searchParams.get("tab") === "payments" ? "payments" : "overview",
          );
          setUpdate("");
          setUpdateFiles([]);
          setPendingUpdate(null);
          setMessage("");
          setReviewNote("");
          setShowReviewNote(false);
          setReviewText("");
          setRating(5);
          setInvoiceRefs({});
        }
        if (contextChanged || !paymentPlanDirtyRef.current) {
          const titles = v.paymentStages.length
            ? v.paymentStages.map((stage) => stage.title)
            : ["Deposit", "Final payment"];
          const amounts = v.paymentStages.length
            ? v.paymentStages.map((stage) => String(stage.amount_cents / 100))
            : ["", ""];
          setStageTitles(titles);
          setStageAmounts(amounts);
          setPaymentPlanBaseline(JSON.stringify([titles, amounts]));
        }
        if (hydrateProposal) {
          answerContext.current = context;
          setQuoteAnswers(
            Object.fromEntries(
              (v.ownQuote?.proposal_answers || []).map((a) => [
                a.questionId,
                a.answer,
              ]),
            ),
          );
          setProposalDraft({
            questions: v.job.proposal_questions || [],
            questionsVersion: v.job.questions_version || 1,
            quoteVersion: v.ownQuote?.current_version,
          });
        }
        setSelectedQuote((current) =>
          v.quotes.some((q) => q.id === current)
            ? current
            : v.selected?.id || v.quotes[0]?.id || "",
        );
        if (hydrateProposal) {
          setAmount(v.ownQuote ? String(v.ownQuote.amount_cents / 100) : "");
          setQuoteNote(v.ownQuote?.note || "");
          setQuoteStart(v.ownQuote?.start_window || "");
          setDuration(v.ownQuote?.duration || "");
          setIncluded(v.ownQuote?.included || "");
          setExcluded(v.ownQuote?.excluded || "");
          setTerms(v.ownQuote?.payment_terms || "");
          setBreakdown(
            (v.ownQuote?.price_breakdown || []).map((x) => ({
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
    if (
      searchParams.get("action") !== "quote" ||
      !detail ||
      detail.permissions.hirer ||
      detail.job.status !== "open" ||
      !admin
    )
      return;
    if (
      detail.job.quote_deadline &&
      new Date(detail.job.quote_deadline).getTime() < Date.now()
    )
      return;
    quoteDraftHeld.current = true;
    setQuoteEditing(true);
    requestAnimationFrame(() =>
      document.getElementById("quote-form")?.scrollIntoView({ block: "start" }),
    );
  }, [detail?.job.id, company?.id, admin, searchParams]);
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
    items.sort(
      (a, b) =>
        Number(b.status === "submitted") - Number(a.status === "submitted"),
    );
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
    if (!pendingQuote) {
      if (
        !proposalDraft ||
        proposalDraft.questionsVersion !==
          (detail?.job.questions_version || 1) ||
        proposalDraft.quoteVersion !== detail?.ownQuote?.current_version
      ) {
        setError(
          "Review the latest questions or quote before sending your proposal.",
        );
        return;
      }
      const missing = proposalDraft.questions.find(
        (q) => q.required && !quoteAnswers[q.id]?.trim(),
      );
      if (missing) {
        setError(`Please answer: ${missing.prompt}`);
        document.getElementById(`proposal-answer-${missing.id}`)?.focus();
        return;
      }
    }
    setWorking(true);
    setError("");
    try {
      const r =
        pendingQuote ||
        (await post<{ id: string; version: number }>(`/jobs/${id}/quote`, {
          version: proposalDraft?.quoteVersion,
          questionsVersion: proposalDraft?.questionsVersion,
          answers: (proposalDraft?.questions || []).map((q) => ({
            questionId: q.id,
            answer: quoteAnswers[q.id] || "",
          })),
          attachmentCount: quoteFiles.length,
          revisionNote,
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
        }));
      setPendingQuote(r);
      for (const file of quoteFiles) {
        await upload(id, file, {
          quoteId: r.id,
          quoteVersion: String(r.version),
        });
        setQuoteFiles((v) => v.filter((f) => f !== file));
      }
      await post(`/jobs/${id}/quotes/${r.id}/publish`, { version: r.version });
      setPendingQuote(null);
      setRevisionNote("");
      toast(detail?.ownQuote ? "Quote updated" : "Quote sent");
      quoteDraftHeld.current = false;
      setQuoteEditing(false);
      if (searchParams.get("action") === "quote") {
        const params = new URLSearchParams(searchParams);
        params.delete("action");
        setSearchParams(params, { replace: true });
      }
      refresh();
    } catch (e) {
      setError((e as Error).message);
      // Preserve the form's reviewed versions and typed answers on conflicts.
      // Updated requirements are shown only after an explicit review below.
      if (!pendingQuote) {
        try {
          setDetail(await api<JobDetail>(`/jobs/${id}`));
        } catch {
          /* Keep the original send error. */
        }
      }
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
          attachmentCount: updateFiles.length,
        }));
      setPendingUpdate({ id: r.id, kind });
      for (const file of updateFiles) {
        await upload(id, file, { updateId: r.id });
        setUpdateFiles((v) => v.filter((f) => f !== file));
      }
      await post(`/jobs/${id}/updates/${r.id}/publish`, {});
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
          if (path === "review-work") {
            setReviewNote("");
            setShowReviewNote(false);
          }
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
      { quoteId: q.id, version: q.current_version },
      "Company chosen",
    );
  const reviewQuote = (q: Quote, action: "changes" | "decline") =>
    open(
      <QuoteDecisionPage
        quote={q}
        action={action}
        onConfirm={async (note) => {
          await post(`/jobs/${id}/quote-decision`, {
            quoteId: q.id,
            version: q.current_version,
            decision: action,
            note,
          });
          refresh();
          toast(action === "changes" ? "Changes requested" : "Quote declined");
        }}
      />,
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
    quoteDraftHeld.current = true;
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
  const proposalQuestionsChanged =
    !!proposalDraft &&
    proposalDraft.questionsVersion !== (job.questions_version || 1);
  const proposalQuoteChanged =
    !!proposalDraft &&
    proposalDraft.quoteVersion !== detail.ownQuote?.current_version;
  const proposalNeedsReview =
    !pendingQuote && (proposalQuestionsChanged || proposalQuoteChanged);
  const reviewLatestProposal = () => {
    if (proposalQuoteChanged) {
      const latest = detail.ownQuote;
      setAmount(latest ? String(latest.amount_cents / 100) : "");
      setQuoteNote(latest?.note || "");
      setQuoteStart(latest?.start_window || "");
      setDuration(latest?.duration || "");
      setIncluded(latest?.included || "");
      setExcluded(latest?.excluded || "");
      setTerms(latest?.payment_terms || "");
      setBreakdown(
        (latest?.price_breakdown || []).map((x) => ({
          label: x.label,
          amount: String(x.amountCents / 100),
        })),
      );
      setQuoteAnswers(
        Object.fromEntries(
          (latest?.proposal_answers || []).map((answer) => [
            answer.questionId,
            answer.answer,
          ]),
        ),
      );
      setRevisionNote("");
    } else {
      setQuoteAnswers((answers) =>
        Object.fromEntries(
          (job.proposal_questions || [])
            .filter((q) =>
              proposalDraft?.questions.some(
                (old) => old.id === q.id && old.prompt === q.prompt,
              ),
            )
            .map((q) => [q.id, answers[q.id] || ""]),
        ),
      );
    }
    setProposalDraft({
      questions: job.proposal_questions || [],
      questionsVersion: job.questions_version || 1,
      quoteVersion: detail.ownQuote?.current_version,
    });
    setError("");
  };
  const canQuote =
    !!company &&
    admin &&
    !hirer &&
    job.status === "open" &&
    (!detail.ownQuote ||
      [
        "submitted",
        "changes_requested",
        "declined",
        "withdrawn",
        "award_declined",
        "not_chosen",
      ].includes(detail.ownQuote.status)) &&
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
  const documentView = !comparing && !activeWork;
  const hasChecklist = !!job.work_checklist?.length;
  const progressView = tab === "overview" && !hasChecklist ? "updates" : tab;
  const quoteDeadlinePassed =
    !!job.quote_deadline && new Date(job.quote_deadline).getTime() < Date.now();
  const completion = detail.updates.find((u) => u.kind === "completion");
  const checklistComplete = (job.work_checklist || []).every(
    (item) => item.completed,
  );
  const completionFiles = completion
    ? detail.files.filter((f) => f.update_id === completion.id)
    : [];
  const headingActions = (
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
          {!documentView && job.status === "open" && (
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
      {activeWork && canMessage && (
        <Link className="jobs-button jobs-secondary" to={inboxPath()}>
          <MessageCircle size={17} /> Message company
        </Link>
      )}
      {hirer &&
        admin &&
        job.status === "in_progress" &&
        progressView === "updates" && (
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
      {activeWork &&
        progressView === "details" &&
        !(hirer && admin && job.status === "review") && (
          <button className="job-report-link" onClick={reportProblem}>
            Report a problem
          </button>
        )}
      {!documentView && canQuote && !quoteEditing && (
        <button
          className="jobs-button jobs-primary job-quote-cta"
          onClick={editQuote}
        >
          {detail.ownQuote ? "Edit your quote" : "Send a quote"}
          <ArrowRight size={17} />
        </button>
      )}
      {!documentView &&
        !company &&
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
  );
  return (
    <div
      data-status={job.status}
      className={`jobs-page job-detail job-workspace ${activeWork ? "is-active-work job-progress-shell" : ""} ${comparing ? "is-comparing" : ""} ${documentView ? "is-job-document" : ""} ${documentView && quoteEditing ? "is-editing-quote" : ""} ${!documentView && canQuote && !quoteEditing ? "has-mobile-action" : ""}`}
    >
      <Link
        to={hirer || activeWork ? "/jobs/mine" : "/jobs"}
        className="job-back"
      >
        <ArrowLeft size={18} />
        {hirer || activeWork ? "My jobs" : "Find work"}
      </Link>
      {documentView ? (
        <JobDocumentHeader
          job={job}
          company={detail.hiringCompany}
          status={statusText[job.status]}
          compact={quoteEditing}
        >
          {hirer && headingActions}
        </JobDocumentHeader>
      ) : (
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
                  {job.location && (
                    <span>
                      <MapPin size={17} />
                      {job.location}
                    </span>
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
            {headingActions}
          </div>
          {activeWork && (
            <dl className="job-progress-summary">
              <div>
                <dt>
                  <Tag size={17} />
                  Agreed price
                </dt>
                <dd>
                  {money(
                    detail.agreement?.amount_cents ??
                      detail.selected?.amount_cents,
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <CalendarDays size={17} />
                  Start
                </dt>
                <dd>
                  {detail.agreement?.start_window ||
                    detail.selected?.start_window ||
                    job.start_window ||
                    "To be agreed"}
                </dd>
              </div>
              {(detail.agreement?.duration || detail.selected?.duration) && (
                <div>
                  <dt>
                    <Clock3 size={17} />
                    Duration
                  </dt>
                  <dd>
                    {detail.agreement?.duration || detail.selected?.duration}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </header>
      )}
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
      {activeWork ? (
        <nav className="job-progress-tabs" aria-label="Project sections">
          {hasChecklist && (
            <button
              type="button"
              className={progressView === "overview" ? "active" : ""}
              aria-current={progressView === "overview" ? "page" : undefined}
              onClick={() => setTab("overview")}
            >
              <CheckCircle2 size={17} />
              Work checklist
            </button>
          )}
          <button
            type="button"
            className={progressView === "updates" ? "active" : ""}
            aria-current={progressView === "updates" ? "page" : undefined}
            onClick={() => setTab("updates")}
          >
            <MessageCircle size={17} />
            Updates
          </button>
          <button
            type="button"
            className={progressView === "details" ? "active" : ""}
            aria-current={progressView === "details" ? "page" : undefined}
            onClick={() => setTab("details")}
          >
            <FileText size={17} />
            Job details
          </button>
          <button
            type="button"
            className={progressView === "payments" ? "active" : ""}
            aria-current={progressView === "payments" ? "page" : undefined}
            onClick={() => setTab("payments")}
          >
            <Tag size={17} />
            Payments
          </button>
        </nav>
      ) : (
        canMessage &&
        !documentView && (
          <div className="job-subnav">
            <button className="active" onClick={() => setTab("overview")}>
              Overview
            </button>
            <button onClick={() => navigate(inboxPath())}>Messages</button>
          </div>
        )
      )}
      <div hidden={tab !== "payments" || !participant}>
        {participant && (
          <div className="jobs-detail-layout">
            <section className="jobs-panel">
              <h2>Payment plan</h2>
              {detail.paymentStagesNeedReview && (
                <p className="quote-decision-note" role="status">
                  The agreed price has changed.{" "}
                  {hirer
                    ? "Update the planned stages below before invoicing continues."
                    : "The hiring company needs to update the payment stages before you can invoice."}
                </p>
              )}
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
                    {stage.status === "planned" &&
                      chosen &&
                      admin &&
                      !detail.paymentStagesNeedReview && (
                        <div className="job-invoice-action">
                          <input
                            aria-label={`Invoice reference for ${stage.title}`}
                            placeholder="Invoice reference (optional)"
                            maxLength={120}
                            disabled={working}
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
                            onClick={async () => {
                              if (
                                await mutate(`payment-stages/${stage.id}`, {
                                  status: "invoiced",
                                  invoiceReference: invoiceRefs[stage.id] || "",
                                })
                              )
                                setInvoiceRefs((current) => {
                                  const next = { ...current };
                                  delete next[stage.id];
                                  return next;
                                });
                            }}
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
                          disabled={working}
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
                          disabled={working}
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
                      onClick={async () => {
                        const submittedDraft = paymentPlanSnapshot;
                        if (
                          await mutate(
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
                        )
                          setPaymentPlanBaseline(submittedDraft);
                      }}
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
                      of{" "}
                      {money(
                        detail.agreement?.amount_cents ??
                          detail.selected?.amount_cents,
                      )}{" "}
                      agreed.
                    </small>
                  </div>
                )}
            </section>
            <aside className="jobs-panel">
              <h2>Agreed price</h2>
              <strong className="job-price">
                {money(
                  detail.agreement?.amount_cents ??
                    detail.selected?.amount_cents,
                )}
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
        )}
      </div>
      <div hidden={tab === "payments" && !!participant}>
        <JobDetailLayout comparing={comparing} progress={activeWork}>
          {comparing && (
            <JobBriefSummary
              job={job}
              files={detail.files.filter((f) => !f.quote_id && !f.update_id)}
            />
          )}
          <section
            className={`jobs-detail-main ${activeWork ? "job-progress-main" : ""}`}
            hidden={activeWork && progressView === "details"}
          >
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
                  Compare each company’s proposal, answers, and price. Then
                  choose a company.
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
                        <div className="quote-version-status">
                          <span className="job-status">
                            {quoteStatusLabel(q.status)}
                          </span>
                          <small>Version {q.current_version || 1}</small>
                        </div>
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
                          {!!q.proposal_answers?.length && (
                            <small className="proposal-answer-count">
                              {
                                q.proposal_answers.filter((answer) =>
                                  answer.answer.trim(),
                                ).length
                              }{" "}
                              {q.proposal_answers.filter((answer) =>
                                answer.answer.trim(),
                              ).length === 1
                                ? "answer"
                                : "answers"}{" "}
                              to job questions
                            </small>
                          )}
                        </div>
                        <div className="quote-card-actions">
                          <button
                            className={`jobs-button ${selectedQuote === q.id ? "jobs-primary" : "jobs-secondary"}`}
                            disabled={
                              working || !admin || q.status !== "submitted"
                            }
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
                        {q.decision_note && (
                          <p className="quote-decision-note">
                            {q.decision_note}
                          </p>
                        )}
                        {admin && q.status === "submitted" && (
                          <div className="quote-review-options">
                            <button
                              className="job-text-button"
                              onClick={() => reviewQuote(q, "changes")}
                            >
                              Request changes
                            </button>
                            <button
                              className="job-text-button"
                              onClick={() => reviewQuote(q, "decline")}
                            >
                              Decline quote
                            </button>
                          </div>
                        )}
                      </div>
                      {expandedQuote === q.id && (
                        <div className="quote-expanded-details">
                          <ProposalAnswers answers={q.proposal_answers || []} />
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
            {job.status === "review" && hirer && admin && (
              <>
                <div className="jobs-panel job-review-actions">
                  <h2>Review the work</h2>
                  <p>Check the final update before closing this job.</p>
                  <button
                    className="jobs-button jobs-primary"
                    disabled={working || checklistSaving || !checklistComplete}
                    onClick={() =>
                      decision(
                        "Accept the finished work?",
                        "This closes the job and lets both companies leave a review. Confirm that the agreed scope is complete.",
                        "Accept and finish",
                        "review-work",
                        {
                          decision: "accept",
                          note: "",
                          updateId: completion?.id,
                        },
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
                          disabled={working}
                          onChange={(e) => setReviewNote(e.target.value)}
                          rows={3}
                          placeholder="Tell the company what remains"
                          autoFocus
                        />
                      </label>
                      <button
                        className="jobs-button jobs-secondary"
                        disabled={working || !reviewNote.trim()}
                        onClick={async () => {
                          if (
                            await mutate(
                              "review-work",
                              {
                                decision: "changes",
                                note: reviewNote,
                                updateId: completion?.id,
                              },
                              "Changes requested",
                            )
                          ) {
                            setReviewNote("");
                            setShowReviewNote(false);
                          }
                        }}
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
                  onClick={() =>
                    void mutate(
                      "confirm",
                      {
                        quoteId: detail.selected?.id,
                        version:
                          detail.selected?.accepted_version ||
                          detail.selected?.current_version,
                      },
                      "Job confirmed",
                    )
                  }
                >
                  Confirm job <Check size={17} />
                </button>
              </div>
            )}
            {activeWork && !!job.work_checklist?.length && (
              <div
                className="jobs-panel work-checklist-panel"
                id="work-checklist"
                hidden={progressView !== "overview"}
              >
                <WorkChecklist
                  layout="workspace"
                  key={`${job.id}:${company?.id}`}
                  jobId={job.id}
                  items={job.work_checklist}
                  version={job.checklist_version}
                  progress
                  editable={
                    !!chosen &&
                    admin &&
                    job.status === "in_progress" &&
                    !working &&
                    !pendingUpdate
                  }
                  hint={
                    job.status === "in_progress"
                      ? chosen && admin
                        ? "Add photos or documents for each item, then send it for the hiring company’s approval."
                        : hirer && admin
                          ? "Review each item’s proof. Approve completed work or ask for changes."
                          : "The selected company submits proof. The hiring company approves each completed item."
                      : job.status === "awarded"
                        ? "Once the job is confirmed, the selected company can submit proof for each item."
                        : job.status === "review"
                          ? "Check these items alongside the final update before accepting the work."
                          : undefined
                  }
                  onBusyChange={setChecklistSaving}
                  onDraftChange={setChecklistDirty}
                  reviewable={
                    !!hirer && admin && job.status === "in_progress" && !working
                  }
                  onChange={(items, version) => {
                    setDetail((current) =>
                      current?.job.id === job.id
                        ? {
                            ...current,
                            job: {
                              ...current.job,
                              work_checklist: items,
                              checklist_version: version,
                            },
                          }
                        : current,
                    );
                    refresh();
                  }}
                />
                {job.status === "in_progress" && checklistComplete && (
                  <div className="job-progress-ready">
                    <CheckCircle2 size={20} />
                    <div>
                      <strong>All tasks approved</strong>
                      <p>
                        {chosen
                          ? "Send a final update to let the hiring company finish the job."
                          : "The company can now send its final update for you to finish the job."}
                      </p>
                    </div>
                    {chosen && admin && (
                      <button
                        type="button"
                        className="jobs-button jobs-primary"
                        onClick={() => setTab("updates")}
                      >
                        Send final update <ArrowRight size={17} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {participant &&
              ["awarded", "in_progress", "review", "completed"].includes(
                job.status,
              ) && (
                <div
                  className="jobs-panel job-progress-panel job-progress-activity"
                  hidden={progressView !== "updates"}
                >
                  <h2>
                    {job.status === "review" ? "Earlier updates" : "Updates"}
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
                  {job.status === "in_progress" && chosen && admin && (
                    <div className="job-update-form">
                      {pendingUpdate && (
                        <p role="status" className="quote-decision-note">
                          Your update is saved. Retry to finish uploading and
                          send it.
                        </p>
                      )}
                      <textarea
                        disabled={working || !!pendingUpdate}
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
                        disabled={working || !!pendingUpdate}
                      />
                      <div className="job-form-actions">
                        <button
                          className="jobs-button jobs-secondary"
                          disabled={
                            !update.trim() ||
                            working ||
                            (!!pendingUpdate &&
                              pendingUpdate.kind !== "progress")
                          }
                          onClick={() => void addUpdate("progress")}
                        >
                          {pendingUpdate?.kind === "progress"
                            ? "Retry sending update"
                            : "Post update"}
                        </button>
                        {chosen && (
                          <button
                            className="jobs-button jobs-primary"
                            disabled={
                              !update.trim() ||
                              working ||
                              checklistSaving ||
                              !checklistComplete ||
                              (!!pendingUpdate &&
                                pendingUpdate.kind !== "completion")
                            }
                            onClick={() => void addUpdate("completion")}
                          >
                            {pendingUpdate?.kind === "completion"
                              ? "Retry sending work"
                              : "Send work for review"}
                          </button>
                        )}
                      </div>
                      {!checklistComplete && (
                        <p className="job-deliverables-hint">
                          Every item on the{" "}
                          <button
                            type="button"
                            className="job-progress-text-link"
                            onClick={() => setTab("overview")}
                          >
                            work checklist
                          </button>{" "}
                          needs the hiring company’s approval before final
                          review. You can still post progress updates.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            {activeWork && job.status !== "completed" && canMessage && (
              <form
                className="jobs-panel workspace-quick-message"
                onSubmit={sendMessage}
                hidden={progressView !== "updates"}
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
                  <div className="job-review-form" id="job-review">
                    <div className="job-stars" role="group" aria-label="Rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          disabled={working}
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
                      disabled={working}
                      onChange={(e) => setReviewText(e.target.value)}
                      placeholder="How did the work together go?"
                      rows={3}
                    />
                    <button
                      className="jobs-button jobs-primary"
                      disabled={working}
                      onClick={async () => {
                        if (
                          await mutate(
                            "reviews",
                            { rating, text: reviewText },
                            "Review submitted",
                          )
                        ) {
                          setReviewText("");
                          setRating(5);
                        }
                      }}
                    >
                      Leave review
                    </button>
                  </div>
                )}
              </div>
            )}
            {documentView && !quoteEditing && (
              <JobDocumentBody
                key={job.id}
                job={job}
                files={detail.files.filter(
                  (file) =>
                    !file.quote_id && !file.update_id && !file.message_id,
                )}
              />
            )}
            {documentView && quoteEditing && (
              <button
                type="button"
                className="job-document-return job-text-button"
                onClick={() => {
                  setQuoteEditing(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <ArrowLeft size={16} /> Back to the job brief
              </button>
            )}
            {detail.ownQuote && !quoteEditing && !activeWork && (
              <div className="jobs-panel job-own-quote">
                <div className="jobs-section-title">
                  <h2>Your quote</h2>
                  <span className="job-status">
                    {detail.ownQuote.upload_pending
                      ? "Not sent yet"
                      : quoteStatusLabel(detail.ownQuote.status)}{" "}
                    · v{detail.ownQuote.current_version || 1}
                  </span>
                </div>
                <strong className="job-price">
                  {money(detail.ownQuote.amount_cents)}
                </strong>
                <p>{detail.ownQuote.note}</p>
                <ProposalAnswers
                  answers={detail.ownQuote.proposal_answers || []}
                />
                {detail.ownQuote.upload_pending && (
                  <p className="quote-decision-note">
                    This quote has unfinished attachments. Open it to check the
                    files and send it.
                  </p>
                )}
                {detail.ownQuote.decision_note && (
                  <p className="quote-decision-note">
                    {detail.ownQuote.decision_note}
                  </p>
                )}
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
                <div className="job-own-quote-actions">
                  {canQuote && (
                    <button
                      className="jobs-button jobs-secondary"
                      onClick={editQuote}
                    >
                      {detail.ownQuote.upload_pending
                        ? "Finish quote"
                        : "Revise quote"}
                    </button>
                  )}
                  <Link
                    className="jobs-button jobs-secondary"
                    to={inboxPath(company?.id)}
                  >
                    <MessageCircle size={16} /> Conversation &amp; quote history
                  </Link>
                </div>
              </div>
            )}
            {canQuote && quoteEditing && (
              <div className="jobs-panel" id="quote-form">
                <div className="quote-editor-header">
                  <h2>
                    {detail.ownQuote
                      ? "Revise your proposal"
                      : "Send a proposal"}
                  </h2>
                  <p className="job-muted">
                    Show {detail.hiringCompany.name} how you’ll handle the work.
                    Your proposal is private between your two companies.
                  </p>
                </div>
                <form
                  className="job-quote-form"
                  onSubmit={sendQuote}
                  onInvalidCapture={(event) => {
                    const disclosure = (event.target as HTMLElement).closest(
                      "details",
                    );
                    if (disclosure) disclosure.open = true;
                  }}
                >
                  {proposalNeedsReview && (
                    <div className="proposal-review-notice" role="alert">
                      <strong>
                        {proposalQuoteChanged
                          ? "Your company’s quote has changed"
                          : "The hiring company updated its questions"}
                      </strong>
                      <p>
                        {proposalQuoteChanged
                          ? "Load the latest quote before editing. This replaces your unsent text and answers; any files you selected will stay attached to your draft."
                          : "Review the updated questions before sending. Your other proposal details and answers to unchanged questions will be kept."}
                      </p>
                      <button
                        className="jobs-button jobs-secondary"
                        type="button"
                        onClick={reviewLatestProposal}
                      >
                        {proposalQuoteChanged
                          ? "Load latest quote"
                          : "Review updated questions"}
                      </button>
                    </div>
                  )}
                  {pendingQuote && (
                    <p role="status" className="quote-decision-note">
                      Your quote is saved. Retry to finish uploading the
                      remaining attachments.
                    </p>
                  )}
                  <fieldset
                    className="quote-form-fields"
                    disabled={working || !!pendingQuote || proposalNeedsReview}
                  >
                    <section className="quote-section quote-proposal-section">
                      <label htmlFor="quote-proposal-text">
                        Your proposal
                        <textarea
                          id="quote-proposal-text"
                          required
                          minLength={10}
                          rows={7}
                          value={quoteNote}
                          onChange={(e) => setQuoteNote(e.target.value)}
                          placeholder="Tell the company how you would approach this work, what your team brings, and what they can expect."
                          aria-describedby="quote-proposal-hint"
                        />
                      </label>
                      <p
                        id="quote-proposal-hint"
                        className="quote-section-hint"
                      >
                        A clear approach and one relevant example help the
                        company understand your fit.
                      </p>
                      {detail.ownQuote && (
                        <label>
                          What changed?
                          <textarea
                            rows={2}
                            maxLength={2000}
                            required={[
                              "declined",
                              "not_chosen",
                              "award_declined",
                            ].includes(detail.ownQuote.status)}
                            placeholder="Summarize the changes to your proposal, price, or timing."
                            value={revisionNote}
                            onChange={(e) => setRevisionNote(e.target.value)}
                          />
                        </label>
                      )}
                    </section>
                    <section
                      className="quote-section quote-files-section"
                      aria-labelledby="quote-files-heading"
                    >
                      <div className="quote-section-heading">
                        <h3 id="quote-files-heading">
                          Supporting files{" "}
                          <span className="field-optional">(optional)</span>
                        </h3>
                        <p>
                          Add relevant plans, past work, or documents that
                          support your proposal.
                        </p>
                      </div>
                      <AttachmentPicker
                        files={quoteFiles}
                        onChange={setQuoteFiles}
                        label="Add proposal files or photos"
                        disabled={
                          working || !!pendingQuote || proposalNeedsReview
                        }
                      />
                      {detail.ownQuote && (
                        <FileList
                          files={detail.files.filter(
                            (f) => f.quote_id === detail.ownQuote!.id,
                          )}
                        />
                      )}
                    </section>
                    {!!(
                      proposalDraft?.questions ||
                      job.proposal_questions ||
                      []
                    ).length && (
                      <div className="quote-section quote-questions-section">
                        <ProposalAnswerFields
                          questions={
                            proposalDraft?.questions ||
                            job.proposal_questions ||
                            []
                          }
                          answers={quoteAnswers}
                          onChange={setQuoteAnswers}
                          disabled={
                            working || !!pendingQuote || proposalNeedsReview
                          }
                        />
                      </div>
                    )}
                    <section
                      className="quote-section quote-work-details"
                      aria-labelledby="quote-work-details-heading"
                    >
                      <div className="quote-section-heading">
                        <h3 id="quote-work-details-heading">Work details</h3>
                        <p>
                          Let the company know when you can start and how long
                          the work will take.
                        </p>
                      </div>
                      <div className="quote-timing-fields">
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
                      <details className="quote-additional-details">
                        <summary>
                          Add scope and payment details{" "}
                          <span className="field-optional">(optional)</span>
                        </summary>
                        <label>
                          Included
                          <textarea
                            value={included}
                            onChange={(e) => setIncluded(e.target.value)}
                            rows={2}
                            placeholder="What does your quote cover?"
                          />
                        </label>
                        <label>
                          Not included
                          <textarea
                            value={excluded}
                            onChange={(e) => setExcluded(e.target.value)}
                            rows={2}
                            placeholder="Anything the hiring company should arrange separately."
                          />
                        </label>
                        <label>
                          Payment terms
                          <textarea
                            value={terms}
                            onChange={(e) => setTerms(e.target.value)}
                            rows={2}
                            placeholder="e.g. 30% at the start, balance on completion."
                          />
                        </label>
                      </details>
                    </section>
                    <section
                      className="quote-section quote-price-section"
                      aria-labelledby="quote-price-heading"
                    >
                      <div className="quote-section-heading">
                        <h3 id="quote-price-heading">Your price</h3>
                        <p>
                          Give one total for the work described in your
                          proposal.
                        </p>
                      </div>
                      <label htmlFor="quote-total-price">
                        Total quote{" "}
                        <span className="field-optional">(USD)</span>
                        <span className="quote-price-money">
                          <span aria-hidden="true">$</span>
                          <input
                            id="quote-total-price"
                            aria-label="Total quote in USD"
                            required
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            maxLength={20}
                            pattern="(?=[0-9,]*[1-9])[0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?"
                            title="Enter a total quote of at least $1, with up to two decimal places."
                            value={
                              quoteAmountFocused ||
                              !amount ||
                              !Number.isFinite(Number(amount))
                                ? amount
                                : new Intl.NumberFormat("en-US", {
                                    minimumFractionDigits:
                                      amount.split(".")[1]?.length || 0,
                                    maximumFractionDigits: 2,
                                  }).format(Number(amount))
                            }
                            onFocus={() => setQuoteAmountFocused(true)}
                            onBlur={() => setQuoteAmountFocused(false)}
                            onChange={(event) => {
                              const value = event.target.value.replace(
                                /[$,\s]/g,
                                "",
                              );
                              if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return;
                              setAmount(value);
                            }}
                            placeholder="75,000"
                          />
                        </span>
                      </label>
                      <details className="quote-price-breakdown">
                        <summary>
                          Add a price breakdown{" "}
                          <span className="field-optional">(optional)</span>
                        </summary>
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
                                      n === i
                                        ? { ...x, label: e.target.value }
                                        : x,
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
                                  setBreakdown((v) =>
                                    v.filter((_, n) => n !== i),
                                  )
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
                              setBreakdown((v) => [
                                ...v,
                                { label: "", amount: "" },
                              ])
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
                                    sum +
                                    Math.round(Number(x.amount || 0) * 100),
                                  0,
                                ),
                              )}
                              . This must match your quote price.
                            </small>
                          )}
                        </div>
                      </details>
                    </section>
                  </fieldset>
                  <div className="quote-submit-actions">
                    <button
                      className="jobs-button jobs-primary"
                      disabled={working || proposalNeedsReview}
                      type="submit"
                    >
                      {working
                        ? "Sending…"
                        : pendingQuote
                          ? "Retry attachments"
                          : detail.ownQuote
                            ? "Send revised quote"
                            : "Send quote"}{" "}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </form>
              </div>
            )}
          </section>
          {!comparing && !documentView && (
            <aside
              className="jobs-aside job-progress-details"
              hidden={activeWork && progressView !== "details"}
            >
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
            </aside>
          )}
        </JobDetailLayout>
      </div>
      {documentView && !quoteEditing && (
        <div
          className="job-document-dock"
          role="region"
          aria-label="Respond to this job"
        >
          <div className="job-document-dock-inner">
            <div className="job-document-budget">
              <strong>
                {job.budget_cents != null
                  ? money(job.budget_cents)
                  : "Open to quotes"}
              </strong>
              <small>
                {job.budget_cents != null
                  ? "Total budget"
                  : "Share your price and availability"}
              </small>
            </div>
            <div className="job-document-actions">
              {canMessage && (
                <Link className="jobs-button jobs-secondary" to={inboxPath()}>
                  <MessageCircle size={17} />{" "}
                  {hirer || detail.ownQuote
                    ? "Job conversation"
                    : "Ask a question"}
                </Link>
              )}
              {canQuote ? (
                <button
                  className="jobs-button jobs-primary"
                  onClick={editQuote}
                >
                  {detail.ownQuote?.upload_pending
                    ? "Finish your quote"
                    : detail.ownQuote
                      ? "Revise your quote"
                      : quoteDraftHeld.current
                        ? "Continue your quote"
                        : "Send a quote"}{" "}
                  <ArrowRight size={17} />
                </button>
              ) : hirer && admin && ["draft", "open"].includes(job.status) ? (
                <Link
                  className="jobs-button jobs-primary"
                  to={
                    job.status === "draft"
                      ? `/jobs/${id}/edit`
                      : `/jobs/${id}/matches`
                  }
                >
                  {job.status === "draft"
                    ? "Continue editing"
                    : "Find companies"}{" "}
                  <ArrowRight size={17} />
                </Link>
              ) : !company && job.status === "open" && !quoteDeadlinePassed ? (
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
                      : "Sign in to quote"}{" "}
                  <ArrowRight size={17} />
                </button>
              ) : (
                <span className="job-document-action-note">
                  {job.status !== "open"
                    ? statusText[job.status]
                    : quoteDeadlinePassed
                      ? "The quote deadline has passed"
                      : hirer
                        ? "Your company posted this job"
                        : !admin
                          ? "A company admin can send a quote"
                          : "View your quote below"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {!documentView && canQuote && !quoteEditing && (
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

function JobDocumentHeader({
  job,
  company,
  status,
  compact,
  children,
}: {
  job: Job;
  company: Company;
  status: string;
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <header className="job-document-header">
      <span className={`job-status ${cls(job.status)}`}>{status}</span>
      <h1>{job.title || "Untitled draft"}</h1>
      <div className="job-document-identity">
        <Link
          className="job-document-company"
          to={`/jobs/companies/${company.slug}?back=${job.id}`}
        >
          <JobLogo company={company} />
          <span>
            <strong>{company.name}</strong>
            <small>
              View company <ArrowUpRight size={13} />
            </small>
          </span>
        </Link>
        <div className="job-document-location">
          <MapPin size={20} aria-hidden="true" />
          <span>
            <strong>{job.location || "Location to be added"}</strong>
            <small>{workLabel(job.trade)}</small>
          </span>
        </div>
      </div>
      {!compact && (
        <div className="job-document-facts">
          <span>
            <CalendarDays size={18} aria-hidden="true" />
            <span>
              <small>Start</small>
              {job.start_window || "Flexible"}
            </span>
          </span>
          {job.expected_duration && (
            <span>
              <Clock3 size={18} aria-hidden="true" />
              <span>
                <small>Duration</small>
                {job.expected_duration}
              </span>
            </span>
          )}
          {job.quote_deadline && (
            <span>
              <CalendarDays size={18} aria-hidden="true" />
              <span>
                <small>Quotes close</small>
                {date(job.quote_deadline)}
              </span>
            </span>
          )}
        </div>
      )}
      {children}
    </header>
  );
}

function JobDocumentBody({ job, files }: { job: Job; files: JobFile[] }) {
  const questions = job.proposal_questions || [];
  const [active, setActive] = useState("job-work");
  const sectionIds = [
    "job-work",
    ...(files.length ? ["job-files"] : []),
    ...(questions.length ? ["job-questions"] : []),
  ];
  const sectionKey = sectionIds.join(",");
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const headerHeight =
        document.querySelector(".jobs-site-header")?.getBoundingClientRect()
          .height || 88;
      let current = "job-work";
      for (const section of sectionKey.split(",")) {
        if (
          (document.getElementById(section)?.getBoundingClientRect().top ??
            Infinity) <=
          headerHeight + 100
        )
          current = section;
      }
      setActive(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sectionKey]);
  const facts: [string, string][] = [
    ...(job.project_type
      ? [["Project type", projectLabel(job.project_type)] as [string, string]]
      : []),
    ...(job.system_size_kw
      ? [["System size", `${job.system_size_kw} kW`] as [string, string]]
      : []),
    ...(job.site_count
      ? [["Sites", String(job.site_count)] as [string, string]]
      : []),
    ...(job.people_needed
      ? [["Team needed", `${job.people_needed} people`] as [string, string]]
      : []),
    ...(job.materials_by && job.materials_by !== "to_agree"
      ? [
          [
            "Materials",
            materialsLabels[job.materials_by] || job.materials_by,
          ] as [string, string],
        ]
      : []),
    ...(job.exact_address
      ? [["Site address (private)", job.exact_address] as [string, string]]
      : []),
  ];
  return (
    <div className="job-document-content" id="job-brief">
      <nav className="job-document-nav" aria-label="Job sections">
        <a
          href="#job-work"
          aria-current={active === "job-work" ? "location" : undefined}
        >
          The work
        </a>
        {!!files.length && (
          <a
            href="#job-files"
            aria-current={active === "job-files" ? "location" : undefined}
          >
            Plans &amp; photos <span>· {files.length}</span>
          </a>
        )}
        {!!questions.length && (
          <a
            href="#job-questions"
            aria-current={active === "job-questions" ? "location" : undefined}
          >
            Questions <span>· {questions.length}</span>
          </a>
        )}
      </nav>
      <section id="job-work" tabIndex={-1} aria-labelledby="job-work-heading">
        <h2 id="job-work-heading">What needs to be done</h2>
        <p className="job-description">
          {job.description || "Add the scope before publishing this draft."}
        </p>
        <WorkChecklist items={job.work_checklist || []} />
        {!!facts.length && (
          <dl className="job-document-specs">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {job.requirements && (
          <div className="job-requirements">
            <h3>What your team needs</h3>
            <p className="job-description">{job.requirements}</p>
          </div>
        )}
      </section>
      {!!files.length && (
        <section
          id="job-files"
          tabIndex={-1}
          aria-labelledby="job-files-heading"
        >
          <h2 id="job-files-heading">
            Plans &amp; photos{" "}
            <small>
              {files.length} attachment{files.length === 1 ? "" : "s"}
            </small>
          </h2>
          <FileList files={files} />
        </section>
      )}
      {!!questions.length && (
        <section
          id="job-questions"
          tabIndex={-1}
          aria-label="Proposal questions"
        >
          <JobQuestions questions={questions} />
        </section>
      )}
    </div>
  );
}

function JobDetailLayout({
  comparing,
  children,
  progress = false,
}: {
  comparing: boolean;
  children: ReactNode;
  progress?: boolean;
}) {
  return (
    <div
      className={`jobs-detail-layout workspace-detail-layout ${comparing ? "quote-comparison-layout" : ""} ${progress ? "job-progress-layout" : ""}`}
    >
      {children}
    </div>
  );
}

function JobQuestions({ questions }: { questions: ProposalQuestion[] }) {
  if (!questions.length) return null;
  return (
    <section
      className="job-proposal-questions"
      aria-label="Questions for your proposal"
    >
      <h3>Questions for your proposal</h3>
      <ol>
        {questions.map((question) => (
          <li key={question.id}>
            <span>{question.prompt}</span>
            <small>{question.required ? "Required" : "Optional"}</small>
          </li>
        ))}
      </ol>
    </section>
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
      <JobQuestions questions={job.proposal_questions || []} />
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
            Agreed price
          </dt>
          <dd>
            <strong>
              {money(
                detail.agreement?.amount_cents ?? detail.selected?.amount_cents,
              )}
            </strong>
            {!!detail.agreement && detail.agreement.revision > 1 && (
              <small>Includes accepted changes</small>
            )}
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
            {detail.agreement?.start_window ||
              detail.selected?.start_window ||
              job.start_window ||
              "To be agreed"}
          </dd>
        </div>
        {(detail.agreement?.duration || detail.selected?.duration) && (
          <div>
            <dt>
              <Clock3 size={19} />
              Duration
            </dt>
            <dd>{detail.agreement?.duration || detail.selected?.duration}</dd>
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
            <p>{detail.agreement?.scope || job.description}</p>
            {detail.agreement?.scope &&
              detail.agreement.scope !== job.description && (
                <details>
                  <summary>Original job description</summary>
                  <p>{job.description}</p>
                </details>
              )}
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
            {!!detail.selected?.proposal_answers?.length && (
              <details>
                <summary>Answers to job questions</summary>
                <ProposalAnswers answers={detail.selected.proposal_answers} />
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

export function quoteStatusLabel(status: string) {
  return (
    (
      {
        submitted: "Awaiting review",
        changes_requested: "Changes requested",
        declined: "Declined",
        chosen: "Chosen",
        not_chosen: "Another company chosen",
        award_declined: "Job declined",
        withdrawn: "Withdrawn",
      } as Record<string, string>
    )[status] || status.replaceAll("_", " ")
  );
}

function QuoteDecisionPage({
  quote,
  action,
  onConfirm,
}: {
  quote: Quote;
  action: "changes" | "decline";
  onConfirm: (note: string) => Promise<void>;
}) {
  const { close } = useApp();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  usePageGuard(!!note.trim(), busy);
  const changes = action === "changes";
  return (
    <form
      className="manage-dialog quote-decision-page"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!note.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
          await onConfirm(note.trim());
          close(true);
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <span className="job-eyebrow">
        Quote version {quote.current_version || 1}
      </span>
      <h1>{changes ? "Request a revised quote" : "Decline this quote"}</h1>
      <p>
        {changes
          ? "Tell the company what you need changed. Their current quote stays in your conversation history."
          : "Let the company know why this quote isn’t a fit. This doesn’t close your job or affect other quotes."}
      </p>
      <div className="quote-decision-summary">
        <JobLogo company={quote.company} />
        <span>
          <b>{quote.company?.name || "Company quote"}</b>
          <small>{quote.start_window || "Start to be agreed"}</small>
        </span>
        <strong>{money(quote.amount_cents)}</strong>
      </div>
      <label>
        {changes ? "What needs to change?" : "Reason for declining"}
        <textarea
          autoFocus
          required
          maxLength={2000}
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            changes
              ? "For example: include the electrical inspection and confirm your earliest start."
              : "For example: the proposed schedule is later than we need."
          }
          disabled={busy}
        />
      </label>
      <JobError text={error} />
      <div className="job-form-actions">
        <button
          type="button"
          className="jobs-button jobs-secondary"
          onClick={() => close()}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="jobs-button jobs-primary"
          disabled={busy || !note.trim()}
        >
          {busy ? "Saving…" : changes ? "Request changes" : "Decline quote"}
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
