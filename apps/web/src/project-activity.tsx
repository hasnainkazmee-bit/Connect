import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  History,
  Paperclip,
  RotateCcw,
  X,
} from "lucide-react";
import type { JobDetail } from "./jobs";
import { JobAttachments } from "./job-attachments";
import {
  ProjectEvent,
  ProjectNextAction,
  type QuoteHistory,
} from "./project-chat-workflow";
import {
  activityTasks,
  pendingActivityCount,
  scopedActivityDetail,
  scopedActivityHistory,
  scopedActivityQuoteHistory,
  taskActivityEventId,
} from "./project-activity-model";
import type { JobHistoryEntry } from "./job-history-model";
import "./project-activity.css";

export {
  pendingActivityCount,
  scopedActivityHistory,
} from "./project-activity-model";

const timestamp = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

export function ProjectActivity({
  detail,
  history,
  providerId,
  admin,
  onChanged,
  onClose,
}: {
  detail: JobDetail;
  history: QuoteHistory | null;
  providerId: string;
  admin: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"review" | "all">("review");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const context = `${detail.job.id}:${providerId}`;
  const safeDetail = useMemo(
    () => scopedActivityDetail(detail, providerId),
    [detail, providerId],
  );
  const safeHistory = useMemo(
    () => scopedActivityQuoteHistory(history, providerId),
    [history, providerId],
  );
  const entries = useMemo(
    () => scopedActivityHistory(detail, history, providerId).reverse(),
    [detail, history, providerId],
  );
  const tasks = activityTasks(detail, providerId);
  const pending = pendingActivityCount(detail, history, providerId, admin);
  const approved = tasks.filter(
    (task) => task.status === "approved" || task.completed,
  ).length;
  const pendingTasks = tasks.filter(
    (task) =>
      task.status === "submitted" || task.status === "changes_requested",
  );
  const currentProofEventIds = new Set(
    pendingTasks
      .map((task) => taskActivityEventId(task, entries, safeHistory))
      .filter((id): id is string => !!id)
      .map((id) => `event:${id}`),
  );
  const recentEntries = entries.filter(
    (entry) => !currentProofEventIds.has(entry.id),
  );
  const visibleEntries = tab === "all" ? entries : recentEntries.slice(0, 3);
  const provider =
    detail.selected?.provider_company_id === providerId
      ? detail.selected.company?.name ||
        detail.conversations.find((company) => company.id === providerId)
          ?.name ||
        "Selected company"
      : detail.conversations.find((company) => company.id === providerId)
          ?.name || "Company";
  const checklistHref = (taskId: string) =>
    `/jobs/${detail.job.id}?task=${encodeURIComponent(taskId)}#work-checklist`;
  const canReviewProof =
    admin &&
    detail.permissions.hirer &&
    ["in_progress", "review"].includes(detail.job.status);
  const canReviseProof =
    admin && detail.permissions.chosen && detail.job.status === "in_progress";
  const hasProofAction = pendingTasks.some((task) =>
    task.status === "submitted" ? canReviewProof : canReviseProof,
  );

  useEffect(() => {
    setTab("review");
    setExpanded({});
  }, [context]);

  const eventDetails = (entry: JobHistoryEntry) => {
    const event = safeHistory?.events.find(
      (event) => `event:${event.id}` === entry.id,
    );
    const version =
      event &&
      safeHistory?.versions.find(
        (version) => version.version === event.quote_version,
      );
    if (
      event &&
      version &&
      ["quote_submitted", "quote_revised", "quote_recorded"].includes(
        event.kind,
      )
    ) {
      return <ProjectEvent event={event} version={version} />;
    }
    return (
      <>
        {entry.body && (
          <p className="project-activity-record-body">{entry.body}</p>
        )}
        {!!entry.files.length && <JobAttachments files={entry.files} />}
        {entry.taskId && (
          <Link
            className="project-activity-all"
            to={checklistHref(entry.taskId)}
          >
            View task & proof
            <ArrowRight size={15} />
          </Link>
        )}
      </>
    );
  };
  const renderEntry = (entry: JobHistoryEntry) => {
    const isOpen = !!expanded[entry.id];
    const hasDetails =
      !!entry.body ||
      !!entry.files.length ||
      !!safeHistory?.events.find(
        (event) => `event:${event.id}` === entry.id && event.quote_version,
      );
    const eventId = entry.id.startsWith("event:")
      ? entry.id.slice(6)
      : undefined;
    return (
      <li
        key={entry.id}
        data-activity-entry-id={entry.id}
        data-event-id={eventId}
        className={`project-activity-record tone-${entry.tone} ${isOpen ? "is-expanded" : ""}`}
      >
        <span className="project-activity-record-icon" aria-hidden="true">
          {entry.tone === "green" ? (
            <Check size={15} />
          ) : entry.tone === "orange" ? (
            <RotateCcw size={15} />
          ) : (
            <FileText size={15} />
          )}
        </span>
        <div>
          <h3>{entry.title}</h3>
          {entry.taskTitle && (
            <p className="project-activity-task-name">{entry.taskTitle}</p>
          )}
          <p className="project-activity-actor">{entry.actor}</p>
          <time dateTime={entry.at}>{timestamp(entry.at)}</time>
          {hasDetails && (
            <button
              type="button"
              className="project-activity-disclosure"
              aria-expanded={isOpen}
              onClick={() =>
                setExpanded((current) => ({
                  ...current,
                  [entry.id]: !current[entry.id],
                }))
              }
            >
              {!!entry.files.length && (
                <>
                  <Paperclip size={13} />
                  {entry.files.length}
                  <span aria-hidden="true">·</span>
                </>
              )}
              {isOpen ? "Hide details" : "View details"}
              <ChevronDown size={14} />
            </button>
          )}
          {isOpen && hasDetails && (
            <div className="project-activity-record-details">
              {eventDetails(entry)}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <aside
      className={`project-activity-panel${hasProofAction ? " has-pending-proof" : ""}`}
      aria-label="Job activity"
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing
        )
          return;
        const viewerOpen = Array.from(
          document.querySelectorAll<HTMLElement>(".job-file-viewer"),
        ).some(
          (viewer) =>
            !viewer.closest("[hidden]") && viewer.getClientRects().length > 0,
        );
        if (viewerOpen) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="project-activity-heading">
        <div>
          <ClipboardCheck size={18} />
          <h2>Activity</h2>
        </div>
        <button
          type="button"
          className="inbox-icon-button"
          onClick={onClose}
          aria-label="Close activity"
        >
          <X size={19} />
        </button>
      </header>
      <div className="project-activity-tabs" aria-label="Activity views">
        <button
          type="button"
          aria-pressed={tab === "review"}
          onClick={() => setTab("review")}
        >
          Needs review{pending > 0 && <span>{pending}</span>}
        </button>
        <button
          type="button"
          aria-pressed={tab === "all"}
          onClick={() => setTab("all")}
        >
          All updates
        </button>
      </div>
      <div
        className="project-activity-scroll"
        tabIndex={0}
        aria-label="Activity updates"
      >
        <div className="project-activity-current" hidden={tab !== "review"}>
          {!!pendingTasks.length && (
            <section
              className="project-activity-proof-list"
              aria-label="Task proof"
            >
              {pendingTasks.map((task) => {
                const submitted = task.status === "submitted";
                const actionable = submitted ? canReviewProof : canReviseProof;
                return (
                  <article
                    className={`project-activity-proof ${submitted ? "needs-approval" : "needs-changes"}`}
                    key={task.id}
                    data-event-id={taskActivityEventId(
                      task,
                      entries,
                      safeHistory,
                    )}
                  >
                    <div className="project-activity-proof-state">
                      {submitted ? (
                        <ClipboardCheck size={15} />
                      ) : (
                        <RotateCcw size={15} />
                      )}
                      <span>
                        {submitted
                          ? "Proof awaiting approval"
                          : "Changes requested"}
                      </span>
                    </div>
                    <h3>{task.title}</h3>
                    <p className="project-activity-actor">
                      {submitted
                        ? `${provider} submitted proof`
                        : `${detail.hiringCompany.name} requested changes`}
                    </p>
                    {(submitted ? task.submittedAt : task.reviewedAt) && (
                      <time
                        dateTime={
                          (submitted ? task.submittedAt : task.reviewedAt)!
                        }
                      >
                        {timestamp(
                          submitted ? task.submittedAt : task.reviewedAt,
                        )}
                      </time>
                    )}
                    {!submitted && task.reviewNote && (
                      <p className="project-activity-proof-note">
                        {task.reviewNote}
                      </p>
                    )}
                    {submitted && task.proofNote && (
                      <p className="project-activity-proof-note">
                        {task.proofNote}
                      </p>
                    )}
                    {!!task.proofFiles?.length && (
                      <JobAttachments files={task.proofFiles} />
                    )}
                    <Link
                      className={`jobs-button ${actionable ? "jobs-primary" : "jobs-secondary"}`}
                      to={checklistHref(task.id)}
                    >
                      {submitted && canReviewProof
                        ? "Review proof"
                        : !submitted && canReviseProof
                          ? "Add revised proof"
                          : "View task & proof"}
                      <ArrowRight size={15} />
                    </Link>
                  </article>
                );
              })}
            </section>
          )}
          {/* Keep mounted across tabs so upload retries and unfinished actions survive. */}
          <ProjectNextAction
            detail={safeDetail}
            history={safeHistory}
            admin={admin}
            providerId={providerId}
            onChanged={onChanged}
          />
          {pending === 0 && !pendingTasks.length && (
            <p className="project-activity-caught-up">
              <CheckCircle2 size={16} />
              <span>No actions waiting on you.</span>
            </p>
          )}
        </div>
        {(tab === "all" ||
          recentEntries.length > 0 ||
          !pendingTasks.length) && (
          <section
            className="project-activity-history"
            aria-label="Recorded activity"
          >
            <header>
              <h3>{tab === "all" ? "All updates" : "Recent activity"}</h3>
              <span>
                <History size={13} />
                Latest first
              </span>
            </header>
            {visibleEntries.length ? (
              <ol>{visibleEntries.map(renderEntry)}</ol>
            ) : (
              <p className="project-activity-empty">
                Quotes, work updates, and decisions will appear here.
              </p>
            )}
            {tab !== "all" && recentEntries.length > 3 && (
              <button
                type="button"
                className="project-activity-all"
                onClick={() => setTab("all")}
              >
                View all updates
                <ArrowRight size={15} />
              </button>
            )}
          </section>
        )}
      </div>
      <footer className="project-activity-footer">
        {!!tasks.length && (
          <div className="project-activity-progress">
            <div>
              <span>Tasks approved</span>
              <strong>
                {approved} of {tasks.length}
              </strong>
            </div>
            <progress
              value={approved}
              max={tasks.length}
              aria-label={`${approved} of ${tasks.length} tasks approved`}
            />
          </div>
        )}
        <Link
          to={`/jobs/${detail.job.id}`}
          className="project-activity-open-job"
        >
          Open job
          <ArrowRight size={16} />
        </Link>
      </footer>
    </aside>
  );
}
