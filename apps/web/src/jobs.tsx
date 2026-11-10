import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Star,
  UploadCloud,
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
import type { Company } from "./types";

type JobStatus =
  | "draft"
  | "open"
  | "awarded"
  | "in_progress"
  | "review"
  | "completed"
  | "cancelled";
type Job = {
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
type JobDetail = {
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
  ["installation", "Installation"],
  ["electrical", "Electrical"],
  ["roofing", "Roofing"],
  ["service", "Service & maintenance"],
  ["design", "Design & engineering"],
  ["other", "Other work"],
] as const;
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
function JobLogo({ company }: { company?: Company }) {
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
      <div className="job-card-top">
        <div className="job-card-main">
          <strong>{job.title || "Untitled draft"}</strong>
          <span className="job-location">
            <MapPin size={14} />
            {job.location || "Location to be added"}
          </span>
          {job.description && (
            <p className="job-card-description">{job.description}</p>
          )}
        </div>
        {job.budget_cents != null && (
          <div className="job-card-budget">
            <strong>{money(job.budget_cents)}</strong>
            <small>Project budget</small>
          </div>
        )}
      </div>
      <div className="job-chips">
        <span>{workLabel(job.trade)}</span>
        {job.project_type && <span>{projectLabel(job.project_type)}</span>}
        {job.system_size_kw && <span>{job.system_size_kw} kW</span>}
        {job.site_count && job.site_count > 1 && (
          <span>{job.site_count} sites</span>
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
        {job.company?.is_demo && <span>Demo</span>}
      </div>
      <div className="job-card-footer">
        <span className="job-card-company">
          <JobLogo company={job.company} />
          <span>
            <b>{job.company?.name}</b>
            <small>
              {mine && own
                ? `${job.quote_count || 0} quotes received`
                : mine && job.my_quote_status
                  ? `Your quote: ${job.my_quote_status.replaceAll("_", " ")}`
                  : `Posted ${date(job.created_at)}`}
            </small>
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
    <div className="jobs-page">
      <div className="jobs-heading">
        <div>
          <h1>{mine ? "My jobs" : "Find your next project."}</h1>
          <p>
            {mine
              ? "Track the work you hire for and the work you take on."
              : "Solar work that fits your company’s skills and service area."}
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
      <div className="jobs-layout">
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
            visible.map((j) => (
              <JobCard key={j.id} job={j} mine={mine} companyId={company?.id} />
            ))
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
        <aside className="jobs-aside">
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
                  Sign in to track your quotes and manage projects.
                </p>
                <button onClick={signIn}>
                  Sign in
                  <ArrowRight size={16} />
                </button>
              </>
            )}
          </div>
          <div className="jobs-panel job-tip">
            <Wrench size={23} />
            <h2>
              {company
                ? "Make your experience count."
                : "Need a company for your project?"}
            </h2>
            <p>
              {company
                ? "Keep your services, coverage, and recent projects up to date. Give hiring companies a reason to choose you."
                : "Describe the work once. Compare quotes and find the right team."}
            </p>
            <Link
              to={
                company ? `/${company.username || company.slug}` : "/jobs/new"
              }
            >
              {company ? "View your company" : "Post a job"}
              <ArrowRight size={16} />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function NewJobPage() {
  const { id } = useParams(),
    { company, admin, session, createCompany, signIn, toast } = useApp(),
    navigate = useNavigate();
  const [editReady, setEditReady] = useState(!id);
  const [savedId, setSavedId] = useState(id);
  const [projectType, setProjectType] = useState("");
  const [systemSize, setSystemSize] = useState("");
  const [siteCount, setSiteCount] = useState("");
  const [materials, setMaterials] = useState("to_agree");
  const [requirements, setRequirements] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [existingFiles, setExistingFiles] = useState<JobFile[]>([]);
  const [title, setTitle] = useState(""),
    [trade, setTrade] = useState("installation"),
    [location, setLocation] = useState(""),
    [start, setStart] = useState(""),
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
        setProjectType(job.project_type || "");
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
        setDescription(job.description);
        setBudget(
          job.budget_cents != null ? String(job.budget_cents / 100) : "",
        );
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
  const publish = async (status: "open" | "draft") => {
    setSavingDraft(status === "draft");
    setBusy(true);
    setError("");
    try {
      const body = {
        projectType,
        systemSizeKw: systemSize ? Number(systemSize) : null,
        siteCount: siteCount ? Number(siteCount) : null,
        materialsBy: materials,
        requirements,
        title,
        trade,
        location,
        startWindow: start,
        description,
        budgetCents: budget ? Math.round(Number(budget) * 100) : null,
        quoteDeadline: deadline
          ? new Date(deadline + "T23:59:59").toISOString()
          : "",
        exactAddress: exact,
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
      navigate(`/jobs/${jobId}`);
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
      <div className="jobs-page">
        <JobEmpty
          title="Post as a company"
          detail={
            session.user
              ? "Create a company profile to post work and receive quotes."
              : "Sign in with a company account to post work and receive quotes."
          }
        />
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
    <div className="jobs-page">
      <div className="jobs-heading">
        <div>
          <h1>{id ? "Edit job" : "Post a job"}</h1>
          <p>A clear brief helps the right companies send better quotes.</p>
        </div>
      </div>
      <div className="jobs-form-layout">
        <form
          className="jobs-panel jobs-form"
          onSubmit={(e) => {
            e.preventDefault();
            void publish("open");
          }}
        >
          <div className="job-form-section">
            <h2>Describe the work</h2>
            <p>
              Start with the scope. Include deliverables, site conditions, and
              anything the team should know.
            </p>
            <label>
              Job title
              <input
                required
                minLength={8}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Install 18 rooftop solar systems"
                autoFocus
              />
            </label>
            <div className="jobs-fields-three">
              <label>
                Type of work
                <select
                  value={trade}
                  onChange={(e) => setTrade(e.target.value)}
                >
                  {workTypes.map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <input
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, state"
                />
              </label>
              <label>
                Start
                <input
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  placeholder="e.g. In 2 weeks"
                />
              </label>
            </div>
            <label>
              Describe the work
              <textarea
                required
                minLength={20}
                maxLength={10000}
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is the scope? What should the company include in its quote?"
              />
            </label>
          </div>
          <div className="job-form-section">
            <h2>Project details</h2>
            <p>Add what you know. Leave details blank if they don’t apply.</p>
            <div className="jobs-fields-three">
              <label>
                Project type
                <select
                  aria-label="Project type"
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value)}
                >
                  <option value="">Select if known</option>
                  {projectTypes.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                System size (kW)
                <input
                  type="number"
                  min="0.01"
                  max="100000000"
                  step="0.01"
                  value={systemSize}
                  onChange={(e) => setSystemSize(e.target.value)}
                  placeholder="e.g. 250"
                />
              </label>
              <label>
                Number of sites
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={siteCount}
                  onChange={(e) => setSiteCount(e.target.value)}
                  placeholder="e.g. 1"
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
                {Object.entries(materialsLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Requirements <small>Optional</small>
              <textarea
                rows={3}
                maxLength={3000}
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="Required licenses, insurance, site access, equipment, or crew experience"
              />
            </label>
          </div>
          <div className="job-form-section">
            <h2>Plans & photos</h2>
            <p>Help companies understand the job before they quote.</p>
            <AttachmentPicker
              files={files}
              onChange={setFiles}
              disabled={busy}
            />
            <FileList files={existingFiles} />
          </div>
          <div className="job-form-section">
            <h2>Budget & quoting</h2>
            <p>
              Set expectations before companies spend time preparing a quote.
            </p>
            <div className="jobs-fields-two">
              <label>
                Budget <small>(optional)</small>
                <span className="money-input">
                  $
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="Amount in USD"
                  />
                </span>
              </label>
              <label>
                Quote deadline <small>(optional)</small>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </label>
            </div>
            <label>
              Exact address <small>(private until you choose a company)</small>
              <input
                value={exact}
                onChange={(e) => setExact(e.target.value)}
                placeholder="Street address, if known"
              />
            </label>
          </div>
          <JobError text={error} />
          <div className="job-form-actions">
            <button
              className="jobs-button jobs-primary"
              disabled={busy}
              type="submit"
            >
              {busy && !savingDraft
                ? "Publishing…"
                : id
                  ? "Update job"
                  : "Publish job"}{" "}
              <ArrowRight size={17} />
            </button>
            <button
              className="jobs-button jobs-secondary"
              disabled={busy}
              type="button"
              onClick={() => void publish("draft")}
            >
              {busy && savingDraft ? "Saving…" : "Save draft"}
            </button>
          </div>
        </form>
        <aside className="jobs-aside">
          <div className="jobs-panel job-preview">
            <h2>Job preview</h2>
            <p>This is how your job will appear to companies on Connect.</p>
            <div className="job-preview-card">
              <h3>{title || "Your job title"}</h3>
              <span>
                <MapPin size={15} />
                {location || "Location"}
              </span>
              <p>
                {description ||
                  "Describe the work so companies can send a useful quote."}
              </p>
              <div>
                <JobLogo company={company} />
                <b>{company.name}</b>
              </div>
              <small>
                <LockKeyhole size={14} /> Exact address stays private until you
                choose a company.
              </small>
            </div>
          </div>
          <div className="jobs-panel job-tip">
            <Users size={23} />
            <h2>Invite companies after publishing</h2>
            <p>
              Once your job is live, you can invite specific companies to quote.
            </p>
          </div>
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
    } = useApp();
  const [detail, setDetail] = useState<JobDetail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [selectedQuote, setSelectedQuote] = useState<string>(""),
    [quoteSort, setQuoteSort] = useState("best"),
    [tab, setTab] = useState<"overview" | "messages" | "payments">("overview");
  const [messageCompany, setMessageCompany] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
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
    [messages, setMessages] = useState<
      {
        id: string;
        body: string;
        sender_name: string;
        sender_company_id: string;
        created_at: string;
      }[]
    >([]),
    [inviteQ, setInviteQ] = useState(""),
    [inviteResults, setInviteResults] = useState<Company[]>([]),
    [selectedInvite, setSelectedInvite] = useState<string[]>([]),
    [showInvite, setShowInvite] = useState(false),
    [stageTitles, setStageTitles] = useState<string[]>([
      "Deposit",
      "Final payment",
    ]),
    [stageAmounts, setStageAmounts] = useState<string[]>(["", ""]);
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
  const sortedQuotes = useMemo(() => {
    const items = [...(detail?.quotes || [])];
    if (quoteSort === "price")
      items.sort((a, b) => a.amount_cents - b.amount_cents);
    if (quoteSort === "price_desc")
      items.sort((a, b) => b.amount_cents - a.amount_cents);
    return items;
  }, [detail?.quotes, quoteSort]);
  const sameEnvironment =
    !!company && !!company.is_demo === !!detail?.hiringCompany.is_demo;
  const canMessage =
    sameEnvironment &&
    !!detail &&
    (hirer
      ? (detail.conversations || []).length > 0
      : job?.status === "open" ||
        chosen ||
        detail.permissions.quoted ||
        detail.permissions.invited);
  const messageProvider = hirer
    ? messageCompany ||
      selectedProvider ||
      quote?.provider_company_id ||
      detail?.conversations?.[0]?.id
    : company?.id;
  useEffect(() => {
    if (!id || tab !== "messages" || !canMessage || !messageProvider) return;
    const controller = new AbortController();
    setMessages([]);
    setMessagesLoading(true);
    const load = () =>
      api<{ messages: typeof messages }>(
        `/jobs/${id}/messages?providerId=${messageProvider}`,
        { signal: controller.signal },
      )
        .then((v) => setMessages(v.messages))
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setMessagesLoading(false);
        });
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, tab, canMessage, messageProvider]);
  useEffect(() => {
    setMessage("");
  }, [messageProvider]);
  useEffect(() => {
    if (!showInvite) return;
    const controller = new AbortController();
    setInviteResults([]);
    const timer = window.setTimeout(() => {
      api<{ providers: Company[] }>(
        `/jobs/providers?q=${encodeURIComponent(inviteQ)}&sample=${!!company?.is_demo}`,
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
  }, [showInvite, inviteQ, company?.id]);
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
      const v = await api<{ messages: typeof messages }>(
        `/jobs/${id}/messages?providerId=${messageProvider}`,
      );
      setMessages(v.messages);
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
    sameEnvironment &&
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
  return (
    <div className="jobs-page job-detail">
      <Link to={hirer ? "/jobs/mine" : "/jobs"} className="job-back">
        <ArrowLeft size={18} />
        {hirer ? "My jobs" : "Find work"}
      </Link>
      <div className="job-detail-heading">
        <div>
          <p className="jobs-eyebrow">
            {workLabel(job.trade)} · {job.location}
          </p>
          <h1>
            {job.title || "Untitled draft"}{" "}
            <span className={`job-status ${cls(job.status)}`}>
              {statusText[job.status]}
            </span>
          </h1>
          <div className="job-company-line">
            <JobLogo company={detail.hiringCompany} />
            <Link
              to={`/jobs/companies/${detail.hiringCompany.slug}?back=${id}`}
            >
              {detail.hiringCompany.name}
            </Link>
            {detail.selected?.company && (
              <>
                <span>↔</span>
                <Link
                  to={`/jobs/companies/${detail.selected.company.slug}?back=${id}`}
                >
                  {detail.selected.company.name}
                </Link>
              </>
            )}
            {job.location && (
              <>
                <span>·</span>
                <MapPin size={15} />
                {job.location}
              </>
            )}
          </div>
        </div>
        {hirer && admin && ["draft", "open"].includes(job.status) && (
          <div className="job-form-actions">
            {detail.quotes.length === 0 && (
              <Link
                className="jobs-button jobs-secondary"
                to={`/jobs/${id}/edit`}
              >
                Edit {job.status === "draft" ? "draft" : "job"}
              </Link>
            )}
            {job.status === "open" && (
              <button
                className="jobs-button jobs-secondary"
                onClick={() => setShowInvite(!showInvite)}
              >
                <Users size={17} /> Invite companies
              </button>
            )}
          </div>
        )}
      </div>
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
                <small>{c.location}</small>
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
      {participant &&
        ["awarded", "in_progress", "review", "completed"].includes(
          job.status,
        ) && (
          <div className="job-steps">
            {["Company chosen", "In progress", "Review work", "Completed"].map(
              (step, i) => (
                <span
                  key={step}
                  className={
                    i <=
                    (
                      {
                        awarded: 0,
                        in_progress: 1,
                        review: 2,
                        completed: 3,
                      } as Record<string, number>
                    )[job.status]
                      ? "done"
                      : ""
                  }
                >
                  <i>
                    {i <
                    (
                      {
                        awarded: 0,
                        in_progress: 1,
                        review: 2,
                        completed: 3,
                      } as Record<string, number>
                    )[job.status] ? (
                      <Check size={14} />
                    ) : (
                      i + 1
                    )}
                  </i>
                  {step}
                </span>
              ),
            )}
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
          <button
            className={tab === "messages" ? "active" : ""}
            onClick={() => setTab("messages")}
          >
            Messages
          </button>
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
      {tab === "messages" && canMessage ? (
        <div className="jobs-detail-layout">
          <section className="jobs-panel">
            <h2>Job messages</h2>
            <p className="job-muted">
              Keep questions and decisions with this job.
            </p>
            {hirer && (
              <label className="job-message-recipient">
                Conversation with
                <select
                  aria-label="Conversation with"
                  value={messageProvider}
                  onChange={(e) => setMessageCompany(e.target.value)}
                >
                  {(detail.conversations || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="job-messages">
              {messagesLoading ? (
                <p className="job-muted">Loading messages…</p>
              ) : messages.length ? (
                messages.map((m) => (
                  <div
                    className={`job-message ${m.sender_company_id === company?.id ? "own" : ""}`}
                    key={m.id}
                  >
                    <small>
                      {m.sender_name} · {date(m.created_at)}
                    </small>
                    <p>{m.body}</p>
                  </div>
                ))
              ) : (
                <p className="job-muted">
                  No messages yet. Ask about scope or timing here.
                </p>
              )}
            </div>
            <form className="job-message-form" onSubmit={sendMessage}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Message about this job…"
                aria-label="Job message"
                maxLength={5000}
              />
              <button
                className="jobs-button jobs-primary"
                type="submit"
                disabled={
                  !message.trim() ||
                  messageBusy ||
                  !(participant || job.status === "open")
                }
              >
                <Send size={17} /> Send
              </button>
            </form>
          </section>
          <aside className="jobs-panel">
            <h2>Job details</h2>
            <p>{job.description}</p>
          </aside>
        </div>
      ) : tab === "payments" && participant ? (
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
        <div className="jobs-detail-layout">
          <section className="jobs-detail-main">
            {hirer && job.status === "open" && detail.quotes.length > 0 && (
              <div className="jobs-panel job-compare">
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
                <div className="job-quote-list">
                  {sortedQuotes.map((q) => (
                    <div
                      className={`job-quote-row ${selectedQuote === q.id ? "selected" : ""}`}
                      key={q.id}
                    >
                      <div className="job-quote-company">
                        <JobLogo company={q.company} />
                        <span className="job-quote-name">
                          <b>{q.company?.name}</b>
                          <small>
                            <MapPin size={13} />
                            {q.company?.location}
                          </small>
                        </span>
                      </div>
                      <div className="job-quote-price">
                        <b>{money(q.amount_cents)}</b>
                        <small>
                          <CalendarDays size={13} />{" "}
                          {q.start_window || "Flexible start"}
                        </small>
                        {q.duration && (
                          <small>
                            <Clock3 size={13} /> {q.duration}
                          </small>
                        )}
                      </div>
                      <span className="job-quote-note">{q.note}</span>
                      <div className="job-quote-actions">
                        <button
                          className="job-view-quote"
                          onClick={() => {
                            setSelectedQuote(q.id);
                            if (window.innerWidth < 800)
                              document
                                .getElementById("quote-details")
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                          }}
                        >
                          View quote <ArrowRight size={15} />
                        </button>
                        <Link
                          to={`/jobs/companies/${q.company?.slug}?back=${id}`}
                        >
                          View company
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {job.status === "review" && hirer && admin && (
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
                <ReviewFileList
                  files={detail.files.filter(
                    (f) =>
                      f.update_id ===
                      detail.updates.find((u) => u.kind === "completion")?.id,
                  )}
                />
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
              ["in_progress", "review", "completed"].includes(job.status) && (
                <div className="jobs-panel">
                  <h2>Progress</h2>
                  {job.status === "in_progress" && (
                    <div className="job-next">
                      <Clock3 size={18} />
                      {chosen
                        ? "Share progress as the work happens. When it is done, send it for review."
                        : "The selected company will share progress and final work here."}
                    </div>
                  )}
                  {detail.updates.length ? (
                    detail.updates.map((u) => (
                      <div className="job-update" key={u.id}>
                        <span className="job-update-dot" />
                        <div>
                          <small>
                            {u.company_name} · {date(u.created_at)}
                          </small>
                          <h3>
                            {u.kind === "completion"
                              ? "Work submitted"
                              : u.kind === "changes_requested"
                                ? "Changes requested"
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
            {
              <div className="jobs-panel">
                <h2>The work</h2>
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
                      {job.site_count} {job.site_count === 1 ? "site" : "sites"}
                    </span>
                  )}
                  {job.materials_by && (
                    <span>
                      <Wrench size={17} />
                      {materialsLabels[job.materials_by]}
                    </span>
                  )}
                  <span>
                    <Wrench size={17} />
                    {workLabel(job.trade)}
                  </span>
                  <span>
                    <MapPin size={17} />
                    {job.location}
                  </span>
                  <span>
                    <CalendarDays size={17} />
                    {job.start_window || "Start is flexible"}
                  </span>
                  {job.budget_cents != null && (
                    <span>
                      <BriefcaseBusiness size={17} />
                      {money(job.budget_cents)} budget
                    </span>
                  )}
                  {job.quote_deadline && (
                    <span>
                      <Clock3 size={17} />
                      Quotes until {date(job.quote_deadline)}
                    </span>
                  )}
                  {job.exact_address && (
                    <span>
                      <LockKeyhole size={17} />
                      {job.exact_address}
                    </span>
                  )}
                </div>
                <FileList
                  files={detail.files.filter(
                    (f) => !f.quote_id && !f.update_id,
                  )}
                />
              </div>
            }
            {detail.ownQuote && !quoteEditing && (
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
            {!company && !hirer && job.status === "open" && (
              <div className="jobs-panel job-accept">
                <h2>Interested in this job?</h2>
                <p>
                  {session.user
                    ? "A company profile is needed to send a quote."
                    : "Sign in with your company account to send a quote."}
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
            )}
          </section>
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
                  <button
                    className="job-report-link"
                    onClick={() => setTab("messages")}
                  >
                    Discuss an issue
                  </button>
                </div>
                <div className="jobs-panel job-review-info">
                  <CheckCircle2 size={20} />
                  <span>
                    After you accept, both companies can leave a review.
                  </span>
                </div>
              </>
            )}
            {!(job.status === "review" && hirer) && (
              <div className="jobs-panel job-details-side" id="quote-details">
                <h2>
                  {hirer && job.status === "open"
                    ? "Quote details"
                    : participant
                      ? "Job details"
                      : canQuote && !quoteEditing
                        ? "Ready for this project?"
                        : "Hiring company"}
                </h2>
                {canQuote && !quoteEditing && (
                  <button
                    className="jobs-button jobs-primary job-quote-cta"
                    onClick={editQuote}
                  >
                    {detail.ownQuote ? "Edit your quote" : "Send a quote"}
                    <ArrowRight size={16} />
                  </button>
                )}
                {!hirer && company && !sameEnvironment && (
                  <p className="job-muted">
                    {job.company?.is_demo || detail.hiringCompany.is_demo
                      ? "Demo jobs are for demo company accounts."
                      : "Use a regular company account to quote on this job."}
                  </p>
                )}
                {hirer && job.status === "open" && quote ? (
                  <>
                    <div className="job-company-side">
                      <JobLogo company={quote.company} />
                      <div>
                        <strong>{quote.company?.name}</strong>
                        <small>{quote.company?.location}</small>
                        <Link
                          to={`/jobs/companies/${quote.company?.slug}?back=${id}`}
                        >
                          Open full profile <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                    <div className="job-side-fact">
                      <b>Quoted price</b>
                      <span>{money(quote.amount_cents)}</span>
                    </div>
                    <div className="job-side-fact">
                      <b>Availability</b>
                      <span>{quote.start_window || "Flexible"}</span>
                    </div>
                    <div className="job-side-fact">
                      <b>Approach</b>
                      <span>{quote.note}</span>
                    </div>
                    {quote.duration && (
                      <div className="job-side-fact">
                        <b>Estimated duration</b>
                        <span>{quote.duration}</span>
                      </div>
                    )}
                    {quote.payment_terms && (
                      <div className="job-side-fact">
                        <b>Payment terms</b>
                        <span>{quote.payment_terms}</span>
                      </div>
                    )}
                    {!!quote.price_breakdown?.length && (
                      <div className="job-side-fact">
                        <b>Price breakdown</b>
                        <div className="quote-breakdown-display">
                          {quote.price_breakdown.map((item, i) => (
                            <span key={i}>
                              {item.label}
                              <b>{money(item.amountCents)}</b>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {quote.included && (
                      <div className="job-side-fact">
                        <b>Included scope</b>
                        <span>{quote.included}</span>
                      </div>
                    )}
                    {quote.excluded && (
                      <div className="job-side-fact">
                        <b>Not included</b>
                        <span>{quote.excluded}</span>
                      </div>
                    )}
                    <FileList
                      files={detail.files.filter(
                        (f) => f.quote_id === quote.id,
                      )}
                    />
                    <button
                      className="jobs-button jobs-primary"
                      disabled={working || !admin}
                      onClick={() =>
                        decision(
                          `Choose ${quote.company?.name}?`,
                          `Their quote is ${money(quote.amount_cents)}. They’ll be asked to confirm before the work starts. Your exact site address will be shared with them.`,
                          "Choose company",
                          "choose",
                          { quoteId: quote.id },
                          "Company chosen",
                        )
                      }
                    >
                      Choose company
                    </button>
                    <button
                      className="jobs-button jobs-secondary"
                      onClick={() => {
                        setMessageCompany(quote.provider_company_id);
                        setTab("messages");
                      }}
                    >
                      <MessageCircle size={16} /> Message
                    </button>
                  </>
                ) : (
                  <>
                    <div className="job-company-side">
                      <JobLogo company={detail.hiringCompany} />
                      <div>
                        <strong>{detail.hiringCompany.name}</strong>
                        <small>{detail.hiringCompany.location}</small>
                        <Link
                          to={`/jobs/companies/${detail.hiringCompany.slug}?back=${id}`}
                        >
                          View company profile <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                    {detail.selected && (
                      <div className="job-side-fact">
                        <b>Selected company</b>
                        <Link
                          to={`/jobs/companies/${detail.selected.company?.slug}?back=${id}`}
                        >
                          {detail.selected.company?.name}
                        </Link>
                      </div>
                    )}
                    {detail.selected && (
                      <div className="job-side-fact">
                        <b>Agreed quote</b>
                        <span>{money(detail.selected.amount_cents)}</span>
                      </div>
                    )}
                    {!detail.selected && (
                      <div className="job-side-fact">
                        <b>Project budget</b>
                        <span>
                          {job.budget_cents != null
                            ? money(job.budget_cents)
                            : "Open to quotes"}
                        </span>
                      </div>
                    )}
                    {job.quote_deadline && (
                      <div className="job-side-fact">
                        <b>Quote deadline</b>
                        <span>{date(job.quote_deadline)}</span>
                      </div>
                    )}
                    {job.start_window && (
                      <div className="job-side-fact">
                        <b>Start</b>
                        <span>{job.start_window}</span>
                      </div>
                    )}
                    {job.exact_address && (
                      <div className="job-side-fact">
                        <b>Private site address</b>
                        <span>{job.exact_address}</span>
                      </div>
                    )}
                    {canMessage && (
                      <button
                        className="jobs-button jobs-secondary"
                        onClick={() => setTab("messages")}
                      >
                        <MessageCircle size={16} /> Job messages
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
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
              close();
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
