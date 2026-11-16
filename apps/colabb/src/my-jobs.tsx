import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  MapPin,
  Search,
  X,
} from "lucide-react";
import type { JobFocusInput } from "./job-list-focus";
import { myJobSummary, type MyJobSummary } from "./my-jobs-model";

type ManagedJob = JobFocusInput & {
  id: string;
  title: string;
  location: string;
  work_arrangement?: string;
  company?: { name: string };
};
type Entry = { job: ManagedJob; summary: MyJobSummary };
const activities = [
  ["all", "All activity"],
  ["posted", "Jobs you posted"],
  ["quotes", "Quotes you sent"],
  ["invitations", "Invitations"],
  ["drafts", "Drafts"],
] as const;
const views = [
  ["all", "All jobs"],
  ["attention", "Needs attention"],
  ["active", "In progress"],
  ["completed", "Finished"],
] as const;

function JobRow({ job, summary }: Entry) {
  const relationship = {
    hiring: "Posted by your company",
    providing:
      job.status === "awarded"
        ? "Your company was chosen"
        : job.status === "completed"
          ? "Completed by your company"
          : job.status === "cancelled"
            ? "Your company"
            : "You're doing this job",
    quoting: "Your quote",
    invited: "You were invited",
  }[summary.role];
  return (
    <li className={`my-job-row ${summary.attention ? "needs-attention" : ""}`}>
      <Link
        to={`/jobs/${job.id}${summary.actionSuffix}`}
        className="my-job-link"
      >
        <div className="my-job-identity">
          <span className="my-job-relationship">
            {relationship}
            {summary.role !== "hiring" && job.company?.name && (
              <>
                <span aria-hidden="true">·</span>
                {job.company.name}
              </>
            )}
          </span>
          <h3>{job.title || "Untitled draft"}</h3>
          {(job.location || job.work_arrangement === "remote") && (
            <span className="my-job-location">
              <MapPin size={14} aria-hidden="true" />
              {job.work_arrangement === "remote" ? "Remote" : job.location}
            </span>
          )}
        </div>
        <div className="my-job-state">
          <span className={`my-job-status tone-${summary.tone}`}>
            <span aria-hidden="true" />
            {summary.label}
          </span>
          <p>{summary.detail}</p>
        </div>
        <span className="my-job-action">
          {summary.actionLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

export function MyJobsWorkspace({
  jobs,
  companyId,
  canManage,
  loading,
  error,
  onRetry,
}: {
  jobs: ManagedJob[];
  companyId: string;
  canManage: boolean;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view") || "all";
  // Existing links from Jobs and notifications keep their original meaning.
  const legacyActivity = activities.some(
    ([key]) => key !== "all" && key === requestedView,
  )
    ? requestedView
    : "all";
  const activity = activities.some(([key]) => key === params.get("activity"))
    ? params.get("activity")!
    : legacyActivity;
  const view = views.some(([key]) => key === requestedView)
    ? requestedView
    : "all";
  const query = params.get("q") || "";
  const entries = useMemo(
    () =>
      jobs.map((job) => ({
        job,
        summary: myJobSummary(job, companyId, canManage),
      })),
    [jobs, companyId, canManage],
  );
  const scoped = entries.filter(({ job, summary }) => {
    if (activity === "posted") return job.hiring_company_id === companyId;
    if (activity === "quotes") return !!job.my_quote_status;
    if (activity === "invitations")
      return !!job.invited && job.status === "open" && !job.my_quote_status;
    if (activity === "drafts") return summary.stage === "drafts";
    return true;
  });
  const matchesView = ({ summary }: Entry, key: string) =>
    key === "attention"
      ? summary.attention
      : key === "active"
        ? summary.stage === "active"
        : key === "completed"
          ? summary.stage === "finished"
          : true;
  const search = query.trim().toLocaleLowerCase();
  const matching = scoped.filter(
    (entry) =>
      !search ||
      [entry.job.title, entry.job.location, entry.job.company?.name].some(
        (value) => value?.toLocaleLowerCase().includes(search),
      ),
  );
  const visible = matching.filter((entry) => matchesView(entry, view));
  const attention = visible
    .filter(({ summary }) => summary.attention)
    .sort((a, b) => a.summary.priority - b.summary.priority);
  const remaining = visible.filter(({ summary }) => !summary.attention);
  const attentionCount = entries.filter(
    ({ summary }) => summary.attention,
  ).length;
  function filterParams(next: {
    view?: string;
    activity?: string;
    q?: string;
  }) {
    const p = new URLSearchParams();
    const values = { view, activity, q: query, ...next };
    if (values.view !== "all") p.set("view", values.view);
    if (values.activity !== "all") p.set("activity", values.activity);
    if (values.q) p.set("q", values.q);
    return p;
  }
  const filtered = view !== "all" || activity !== "all" || !!query;
  return (
    <div className="jobs-page my-jobs-workspace">
      <header className="my-jobs-heading">
        <div>
          <h1>My jobs</h1>
          <p>
            Keep your jobs moving, from the first quote to the final approval.
          </p>
        </div>
        {!loading && !error && (
          <span
            className={`my-jobs-attention-note ${attentionCount ? "has-attention" : ""}`}
          >
            {attentionCount ? (
              <Clock3 size={17} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={17} aria-hidden="true" />
            )}
            {attentionCount
              ? `${attentionCount} ${attentionCount === 1 ? "job needs" : "jobs need"} your attention`
              : "No actions waiting on you"}
          </span>
        )}
      </header>
      <section className="my-jobs-panel" aria-label="Manage your jobs">
        <div className="my-jobs-controls">
          <nav className="my-jobs-views" aria-label="Job status">
            {views.map(([key, label]) => (
              <Link
                key={key}
                to={{
                  pathname: "/jobs/mine",
                  search: filterParams({ view: key }).toString(),
                }}
                aria-current={view === key ? "page" : undefined}
              >
                {label}
                <span>
                  {loading
                    ? "–"
                    : matching.filter((entry) => matchesView(entry, key))
                        .length}
                </span>
              </Link>
            ))}
          </nav>
          <div className="my-jobs-filters">
            <label className="my-jobs-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search your jobs"
                placeholder="Search jobs or companies"
                value={query}
                onChange={(event) =>
                  setParams(filterParams({ q: event.target.value }), {
                    replace: true,
                  })
                }
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() =>
                    setParams(filterParams({ q: "" }), { replace: true })
                  }
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label className="my-jobs-activity">
              <span className="my-jobs-sr-only">Filter by your activity</span>
              <select
                value={activity}
                onChange={(event) =>
                  setParams(filterParams({ activity: event.target.value }))
                }
              >
                {activities.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="my-jobs-results" aria-busy={loading}>
          {loading ? (
            <div className="my-jobs-empty" role="status">
              <Clock3 size={28} />
              <h2>Loading your jobs…</h2>
            </div>
          ) : error ? (
            <div className="my-jobs-empty">
              <p role="alert">{error}</p>
              <button className="jobs-button jobs-secondary" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : visible.length ? (
            <>
              <div className="my-jobs-columns" aria-hidden="true">
                <span>Job & company</span>
                <span>Where things stand</span>
                <span>Next step</span>
              </div>
              {!!attention.length && (
                <section
                  className="my-jobs-group"
                  aria-labelledby="my-jobs-attention-heading"
                >
                  <h2 id="my-jobs-attention-heading">
                    <span className="my-jobs-attention-dot" />
                    Needs your attention <span>{attention.length}</span>
                  </h2>
                  <ul>
                    {attention.map((entry) => (
                      <JobRow key={entry.job.id} {...entry} />
                    ))}
                  </ul>
                </section>
              )}
              {!!remaining.length && (
                <section
                  className="my-jobs-group"
                  aria-labelledby="my-jobs-other-heading"
                >
                  <h2 id="my-jobs-other-heading">
                    {attention.length
                      ? "Other jobs"
                      : view === "active"
                        ? "Work in progress"
                        : view === "completed"
                          ? "Finished jobs"
                          : activity === "drafts"
                            ? "Your drafts"
                            : "Your jobs"}
                    <span>{remaining.length}</span>
                  </h2>
                  <ul>
                    {remaining.map((entry) => (
                      <JobRow key={entry.job.id} {...entry} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="my-jobs-empty">
              {view === "attention" && !search ? (
                <CheckCircle2 size={30} />
              ) : (
                <BriefcaseBusiness size={30} />
              )}
              <h2>
                {search
                  ? "No jobs match your search"
                  : view === "attention"
                    ? activity === "all"
                      ? "You're all caught up"
                      : "No actions in this view"
                    : filtered
                      ? "No jobs here yet"
                      : "Your next job starts here"}
              </h2>
              <p>
                {search
                  ? "Try a job title, company name or location."
                  : view === "attention"
                    ? activity === "all"
                      ? "When a job needs a decision from you, you'll find it here."
                      : "Try another activity or view all jobs to see what needs your attention."
                    : activity === "quotes"
                      ? "Quotes your company sends will appear here."
                      : activity === "invitations"
                        ? "Invitations to quote will appear here."
                        : activity === "drafts"
                          ? "Jobs you save for later will appear here."
                          : view === "active"
                            ? "Once a company is chosen, follow the work here."
                            : view === "completed"
                              ? "Completed jobs and closed quotes will appear here."
                              : "Post a job to find a company, or find work for your own team."}
              </p>
              <div className="my-jobs-empty-actions">
                {filtered ? (
                  <button
                    className="jobs-button jobs-secondary"
                    onClick={() => setParams({})}
                  >
                    View all jobs
                  </button>
                ) : (
                  <>
                    {canManage && (
                      <Link className="jobs-button jobs-primary" to="/jobs/new">
                        Post a job
                        <ArrowRight size={16} />
                      </Link>
                    )}
                    <Link className="jobs-button jobs-secondary" to="/jobs">
                      Find work
                      <ArrowRight size={16} />
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {!loading && !error && visible.length > 0 && (
          <footer className="my-jobs-count" aria-live="polite">
            {visible.length} {visible.length === 1 ? "job" : "jobs"}
            {filtered ? " in this view" : " total"}
          </footer>
        )}
      </section>
    </div>
  );
}
