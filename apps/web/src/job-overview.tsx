import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  History,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { JobAttachments } from "./job-attachments";
import type { JobDetail } from "./jobs";
import { projectMoney, type QuoteHistory } from "./project-chat-workflow";
import { buildJobHistory } from "./job-history-model";
import "./job-overview.css";

const timestamp = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function JobOverview({
  detail,
  onTasks,
  onUpdates,
  onDetails,
}: {
  detail: JobDetail;
  onTasks: () => void;
  onUpdates: () => void;
  onDetails: () => void;
}) {
  const { company, revision } = useApp();
  const { job, selected, hiringCompany, permissions } = detail;
  const providerId = selected?.provider_company_id;
  const context = `${job.id}:${company?.id}:${providerId}`;
  const [record, setRecord] = useState<{
    key: string;
    history: QuoteHistory;
  } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setHistoryError("");
    api<QuoteHistory>(
      `/jobs/${job.id}/quote-history?providerId=${encodeURIComponent(providerId)}`,
      { signal: controller.signal },
    )
      .then((history) => {
        if (!controller.signal.aborted) setRecord({ key: context, history });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryError(
            "Some history couldn’t load. Your tasks and documents are still available.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    job.id,
    providerId,
    context,
    revision,
    job.status,
    job.checklist_version,
    retry,
  ]);
  const history = record?.key === context ? record.history : null;
  const entries = useMemo(
    () => buildJobHistory(detail, history),
    [detail, history],
  );
  const tasks = job.work_checklist || [];
  const approved = tasks.filter(
    (task) => task.status === "approved" || task.completed,
  ).length;
  const awaiting = tasks.filter((task) => task.status === "submitted").length;
  const changes = tasks.filter(
    (task) => task.status === "changes_requested",
  ).length;
  const provider =
    selected?.company?.name ||
    detail.conversations.find((c) => c.id === providerId)?.name ||
    "Selected company";
  const finished = job.status === "completed";
  const reviewing = job.status === "review";
  const completion = [...detail.updates]
    .filter((u) => u.kind === "completion")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const handoverFiles = completion
    ? detail.files.filter((file) => file.update_id === completion.id)
    : [];
  const finishedEvent = [...entries]
    .reverse()
    .find((entry) => ["work_accepted", "job_completed"].includes(entry.kind));
  const heading = finished
    ? "The work is complete"
    : reviewing
      ? "The final work is ready to review"
      : job.status === "awarded"
        ? "Waiting for the company to confirm"
        : awaiting && permissions.hirer
          ? `${awaiting} ${awaiting === 1 ? "task needs" : "tasks need"} your approval`
          : changes && permissions.chosen
            ? "There’s feedback on your work"
            : "The work is in progress";
  const description = finished
    ? `${hiringCompany.name} accepted ${provider}’s final handover${finishedEvent ? ` on ${timestamp(finishedEvent.at)}` : ""}.`
    : reviewing
      ? `${provider} has sent the final handover. ${hiringCompany.name} reviews it before the job is finished.`
      : job.status === "awarded"
        ? `${hiringCompany.name} chose ${provider}. Work can begin after the company confirms.`
        : awaiting
          ? `${provider} has submitted proof. ${hiringCompany.name} approves each task before it counts as done.`
          : `${provider} submits the work and supporting proof. ${hiringCompany.name} reviews and approves it.`;
  const stage = finished ? 3 : reviewing ? 2 : job.status === "awarded" ? 0 : 1;
  const steps = ["Company chosen", "Work underway", "Final review", "Finished"];
  return (
    <section className="project-overview" aria-label="Job overview">
      <div className={`project-outcome ${finished ? "is-finished" : ""}`}>
        <span className="project-outcome-icon">
          {finished ? (
            <CheckCircle2 size={26} />
          ) : reviewing ? (
            <FileText size={26} />
          ) : (
            <Clock3 size={26} />
          )}
        </span>
        <div>
          <h2>{heading}</h2>
          <p>{description}</p>
        </div>
        {!!tasks.length && (
          <button className="jobs-button jobs-secondary" onClick={onTasks}>
            {finished
              ? "View tasks & proof"
              : reviewing
                ? "Review final handover"
                : permissions.hirer && awaiting
                  ? "Review task proof"
                  : "Open work checklist"}
            <ArrowRight size={16} />
          </button>
        )}
        {!finished && reviewing && !tasks.length && (
          <button className="jobs-button jobs-primary" onClick={onTasks}>
            Review final handover
            <ArrowRight size={16} />
          </button>
        )}
      </div>
      <ol className="project-journey" aria-label="Job stages">
        {steps.map((label, index) => (
          <li
            key={label}
            className={
              finished || index < stage
                ? "is-done"
                : index === stage
                  ? "is-current"
                  : ""
            }
            aria-current={!finished && index === stage ? "step" : undefined}
          >
            <span>
              {finished || index < stage ? <Check size={15} /> : index + 1}
            </span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      <div className="project-overview-grid">
        <section
          className="project-history-panel"
          aria-labelledby="project-history-heading"
        >
          <header>
            <div>
              <h2 id="project-history-heading">What happened</h2>
              <p>
                From the first step to{" "}
                {finished ? "final approval" : "the latest update"}.
              </p>
            </div>
            <span className="project-history-order">
              <History size={15} /> Oldest first
            </span>
          </header>
          {historyError && (
            <div role="status" className="project-history-error">
              {historyError}
              <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
            </div>
          )}
          {loading && (
            <p className="project-history-loading" role="status">
              Loading the full history…
            </p>
          )}
          <div
            className="project-history-scroll"
            tabIndex={0}
            role="region"
            aria-label="Job history, oldest first"
          >
            <ol className="project-history-list">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={`project-history-item tone-${entry.tone}`}
                >
                  <span className="project-history-marker">
                    {entry.tone === "green" ? (
                      <Check size={15} />
                    ) : entry.tone === "orange" ? (
                      <RotateCcw size={14} />
                    ) : (
                      <span />
                    )}
                  </span>
                  <div className="project-history-entry">
                    <div className="project-history-line">
                      <h3>{entry.title}</h3>
                      <time dateTime={entry.at}>{timestamp(entry.at)}</time>
                    </div>
                    <p className="project-history-actor">
                      {entry.actor}
                      {entry.taskTitle && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <strong>{entry.taskTitle}</strong>
                        </>
                      )}
                    </p>
                    {(entry.body || entry.files.length > 0) && (
                      <details className="project-history-evidence">
                        <summary>
                          {entry.files.length ? (
                            <>
                              <Paperclip size={14} />
                              {entry.files.length}{" "}
                              {entry.files.length === 1
                                ? "attachment"
                                : "attachments"}
                              <span aria-hidden="true"> · </span>
                            </>
                          ) : null}
                          View details
                          <ChevronDown size={14} />
                        </summary>
                        <div>
                          {entry.body && <p>{entry.body}</p>}
                          <JobAttachments files={entry.files} />
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <aside className="project-summary-stack" aria-label="Project summary">
          <section className="project-summary-card">
            <h2>The agreement</h2>
            <dl>
              <div>
                <dt>Hiring company</dt>
                <dd>{hiringCompany.name}</dd>
              </div>
              <div>
                <dt>Selected company</dt>
                <dd>{provider}</dd>
              </div>
              {(detail.agreement || selected) && (
                <div>
                  <dt>Agreed price</dt>
                  <dd>
                    {projectMoney(
                      detail.agreement?.amount_cents ?? selected!.amount_cents,
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <button className="project-summary-link" onClick={onDetails}>
              View scope & agreement
              <ArrowRight size={16} />
            </button>
            {providerId && (
              <Link
                className="project-summary-link"
                to={`/jobs/inbox?job=${job.id}&provider=${providerId}`}
              >
                Conversation & quote history
                <ArrowRight size={16} />
              </Link>
            )}
          </section>
          {!!tasks.length && (
            <section className="project-summary-card">
              <div className="project-summary-heading">
                <h2>Work completed</h2>
                <span>
                  {approved} of {tasks.length}
                </span>
              </div>
              <progress
                value={approved}
                max={tasks.length}
                aria-label={`${approved} of ${tasks.length} tasks approved`}
              />
              <ul className="project-task-summary">
                {tasks.map((task) => (
                  <li key={task.id}>
                    {task.completed || task.status === "approved" ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <Clock3 size={17} />
                    )}
                    <span>
                      {task.title}
                      <small>
                        {task.completed || task.status === "approved"
                          ? "Approved"
                          : task.status === "submitted"
                            ? "Awaiting approval"
                            : task.status === "changes_requested"
                              ? "Changes requested"
                              : "Not submitted"}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              <button className="project-summary-link" onClick={onTasks}>
                View tasks & proof
                <ArrowRight size={16} />
              </button>
            </section>
          )}
          {!!handoverFiles.length && (
            <section className="project-summary-card project-handover">
              <h2>Final handover</h2>
              <p>Files submitted by {provider}.</p>
              <JobAttachments files={handoverFiles} />
            </section>
          )}
          {!finished && (
            <button className="jobs-button jobs-secondary" onClick={onUpdates}>
              See updates
              <ArrowRight size={16} />
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
