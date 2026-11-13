import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileText,
  LoaderCircle,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { usePageGuard } from "./page-navigation";
import {
  AttachmentPicker,
  JobAttachments,
  type JobFile,
} from "./job-attachments";
import type { JobDetail } from "./jobs";
import { ProposalAnswers, type ProposalAnswer } from "./proposal-questions";

export type QuoteVersion = {
  version: number;
  amount_cents: number;
  start_window: string;
  duration: string;
  note: string;
  included: string;
  excluded: string;
  payment_terms: string;
  price_breakdown: { label: string; amountCents: number }[];
  revision_note: string;
  created_at: string;
  author_name: string;
  files: JobFile[];
  proposal_answers?: ProposalAnswer[];
};
export type ChatEvent = {
  id: string;
  kind: string;
  body: string;
  quote_id?: string;
  quote_version?: number;
  update_id?: string;
  change_id?: string;
  actor_name: string;
  company_name: string;
  created_at: string;
};
export type QuoteHistory = {
  quote: {
    id: string;
    current_version: number;
    accepted_version: number | null;
    amount_cents: number;
    status: string;
    decision_note?: string;
    upload_pending?: boolean;
  } | null;
  versions: QuoteVersion[];
  events: ChatEvent[];
  agreement?: {
    job_id: string;
    quote_id: string;
    quote_version: number;
    revision: number;
    amount_cents: number;
    start_window: string;
    duration: string;
    scope: string;
    updated_at: string;
  } | null;
  changes?: {
    id: string;
    job_id: string;
    company_id: string;
    agreement_revision: number;
    title: string;
    scope: string;
    amount_delta_cents: number;
    start_window: string;
    duration: string;
    status: "pending" | "accepted" | "declined";
    decision_note: string;
    created_at: string;
    decided_at: string | null;
    author_name: string;
    company_name: string;
  }[];
  paymentStagesNeedReview?: boolean;
  permissions: {
    hirer: boolean;
    provider: boolean;
    canDecide: boolean;
    canRevise: boolean;
    canConfirm: boolean;
    canProposeChange?: boolean;
  };
};
export const projectMoney = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 100 ? 2 : 0,
  }).format(value / 100);
const eventLabels: Record<string, string> = {
  quote_recorded: "Existing quote",
  work_submitted: "Work ready for review",
  change_proposed: "Change proposed",
  change_accepted: "Change accepted",
  change_declined: "Change declined",
  quote_submitted: "Quote received",
  quote_revised: "Quote revised",
  quote_changes_requested: "Quote changes requested",
  quote_declined: "Quote declined",
  company_chosen: "Company chosen",
  not_chosen: "Another company was chosen",
  award_accepted: "Job confirmed",
  award_declined: "Job declined",
  progress: "Progress update",
  completion: "Work ready for review",
  changes_requested: "Changes requested",
  work_accepted: "Work accepted",
  update_requested: "Update requested",
  work_changes_requested: "Changes requested",
  job_completed: "Job finished",
  scope_proposed: "Change proposed",
  scope_accepted: "Change accepted",
  scope_declined: "Change declined",
};
export function ProjectEvent({
  event,
  version,
  files = [],
}: {
  event: ChatEvent;
  version?: QuoteVersion;
  files?: JobFile[];
}) {
  const isQuote = [
    "quote_submitted",
    "quote_revised",
    "quote_recorded",
  ].includes(event.kind);
  return (
    <article
      data-event-id={event.id}
      className={`project-event ${isQuote ? "project-event-quote" : ""}`}
    >
      <div className="project-event-heading">
        <span className="project-event-icon">
          {isQuote ? (
            <FileText size={17} />
          ) : ["award_accepted", "work_accepted", "job_completed"].includes(
              event.kind,
            ) ? (
            <CheckCheck size={17} />
          ) : (
            <ClipboardCheck size={17} />
          )}
        </span>
        <div>
          <strong>
            {eventLabels[event.kind] || event.kind.replaceAll("_", " ")}
          </strong>
          <span>
            {event.actor_name || event.company_name}
            {event.actor_name && event.company_name
              ? ` · ${event.company_name}`
              : ""}
          </span>
        </div>
        <time dateTime={event.created_at}>
          {new Date(event.created_at).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </div>
      {isQuote && version ? (
        <>
          <div className="project-quote-summary">
            <b>{projectMoney(version.amount_cents)}</b>
            <span>Version {version.version}</span>
          </div>
          <div className="project-quote-facts">
            <span>
              Start <strong>{version.start_window || "To be agreed"}</strong>
            </span>
            {version.duration && (
              <span>
                Duration <strong>{version.duration}</strong>
              </span>
            )}
          </div>
          <p>{version.note}</p>
          <details>
            <summary>View quote details</summary>
            <QuoteTerms version={version} />
          </details>
        </>
      ) : (
        event.body && <p>{event.body}</p>
      )}
      {!!files.length && <JobAttachments files={files} />}
    </article>
  );
}
function QuoteTerms({
  version,
  showAnswers = true,
}: {
  version: QuoteVersion;
  showAnswers?: boolean;
}) {
  return (
    <div className="project-quote-terms">
      {!!version.price_breakdown?.length && (
        <dl>
          {version.price_breakdown.map((line, i) => (
            <div key={i}>
              <dt>{line.label}</dt>
              <dd>{projectMoney(line.amountCents)}</dd>
            </div>
          ))}
        </dl>
      )}
      {[
        ["Included", version.included],
        ["Not included", version.excluded],
        ["Payment terms", version.payment_terms],
        ["What changed", version.revision_note],
      ].map(([label, value]) =>
        value ? (
          <div key={label}>
            <h4>{label}</h4>
            <p>{value}</p>
          </div>
        ) : null,
      )}
      {!!version.files?.length && <JobAttachments files={version.files} />}
      {showAnswers && (
        <ProposalAnswers answers={version.proposal_answers || []} />
      )}
    </div>
  );
}
type Action =
  | "quote"
  | "choose"
  | "changes"
  | "decline"
  | "confirm"
  | "decline-job"
  | "progress"
  | "completion"
  | "review"
  | "review-changes"
  | "propose-change"
  | "review-change"
  | "decline-change"
  | null;
export function ProjectNextAction({
  detail,
  history,
  admin,
  providerId,
  onChanged,
}: {
  detail: JobDetail;
  history: QuoteHistory | null;
  admin: boolean;
  providerId: string;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<Action>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]),
    [pendingUpdate, setPendingUpdate] = useState<{
      id: string;
      kind: string;
    } | null>(null);
  usePageGuard(!!pendingUpdate || busy, busy);
  const [notice, setNotice] = useState("");
  const [changeTitle, setChangeTitle] = useState(""),
    [changeScope, setChangeScope] = useState(""),
    [changeAmount, setChangeAmount] = useState(""),
    [changeStart, setChangeStart] = useState(""),
    [changeDuration, setChangeDuration] = useState("");
  const lock = useRef(false);
  const uploadIds = useRef(new WeakMap<File, string>());
  const q = history?.quote,
    latest = history?.versions.find((v) => v.version === q?.current_version);
  const { job, permissions } = detail;
  const latestCompletion = detail.updates.find(
    (update) =>
      update.kind === "completion" &&
      (!update.provider_company_id ||
        update.provider_company_id === providerId),
  );
  const isChosenThread =
    !!detail.selected && detail.selected.provider_company_id === providerId;
  const participant =
    isChosenThread && (permissions.hirer || permissions.chosen);
  const pendingChange = history?.changes?.find(
    (change) => change.status === "pending",
  );
  const ownCompanyId = permissions.hirer ? detail.hiringCompany.id : providerId;
  const canReviewChange =
    !!pendingChange &&
    pendingChange.company_id !== ownCompanyId &&
    admin &&
    participant;
  useEffect(() => {
    if (!pendingUpdate) setAction(null);
  }, [job.status, q?.current_version, q?.status, latestCompletion?.id]);
  const open = (next: Action) => {
    setAction(next);
    setNote("");
    setError("");
    setNotice("");
  };
  const run = async (path: string, body: object, success: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await post(`/jobs/${job.id}/${path}`, body);
      setAction(null);
      setNote("");
      setNotice(success);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const update = async (kind: "progress" | "completion") => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved =
        pendingUpdate ||
        (await post<{ id: string }>(`/jobs/${job.id}/updates`, {
          kind,
          body: note,
          attachmentCount: files.length,
        }));
      setPendingUpdate({ id: saved.id, kind });
      for (const file of files) {
        const uploadId = uploadIds.current.get(file) || crypto.randomUUID();
        uploadIds.current.set(file, uploadId);
        await api(
          `/jobs/${job.id}/files?updateId=${saved.id}&uploadId=${uploadId}&name=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            body: file,
            headers: { "Content-Type": file.type },
          },
        );
        setFiles((current) => current.filter((f) => f !== file));
      }
      await post(`/jobs/${job.id}/updates/${saved.id}/publish`, {});
      setPendingUpdate(null);
      setFiles([]);
      setAction(null);
      setNote("");
      setNotice(
        kind === "completion" ? "Work sent for review." : "Progress shared.",
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  let title = "",
    body = "",
    label = "",
    next: Action = null,
    href = "";
  if (q?.upload_pending) {
    title = history?.permissions.provider
      ? "Your quote is still being prepared"
      : "Quote attachments are being prepared";
    body =
      "The quote will be ready for review after all attachments finish uploading.";
    if (admin && history?.permissions.provider) {
      label = "Finish quote";
      href = `/jobs/${job.id}?action=quote`;
    }
  } else if (canReviewChange) {
    title = "A job change needs your approval";
    body = pendingChange!.title;
    label = "Review change";
    next = "review-change";
  } else if (pendingChange && participant) {
    title = "Waiting for approval on your change";
    body = pendingChange.title;
  } else if (admin && history?.permissions.canDecide) {
    title = "A quote is ready for you";
    body = latest
      ? `${projectMoney(latest.amount_cents)} · ${latest.start_window || "Start to be agreed"}`
      : "Review the proposal, then choose your next step.";
    label = "Review quote";
    next = "quote";
  } else if (admin && history?.permissions.canConfirm) {
    title = "Your company was chosen";
    body = "Confirm the quote and start date to begin this job.";
    label = "Review & confirm";
    next = "confirm";
  } else if (
    participant &&
    job.status === "review" &&
    permissions.hirer &&
    admin
  ) {
    title = "The work is ready for review";
    body = "Check the final update and files before finishing the job.";
    label = "Review work";
    next = "review";
  } else if (participant && job.status === "in_progress") {
    title = permissions.chosen
      ? "Keep your client up to date"
      : "Work is underway";
    body = permissions.chosen
      ? "Share progress, photos, or send finished work for review."
      : "Updates and decisions stay here with the job.";
    label = permissions.chosen ? "Share progress" : "Request an update";
    next = permissions.chosen ? "progress" : null;
  } else if (
    permissions.hirer &&
    job.status === "open" &&
    q?.status === "changes_requested"
  ) {
    title = "Waiting for a revised quote";
    body = "Your change request has been sent to this company.";
  } else if (
    permissions.hirer &&
    job.status === "open" &&
    q?.status === "declined"
  ) {
    title = "Quote declined";
    body = "This company can send a revised quote while the job is open.";
  } else if (admin && history?.permissions.canRevise) {
    title =
      q?.status === "changes_requested"
        ? "Changes to your quote were requested"
        : q?.status === "declined"
          ? "Your quote was declined"
          : "Your quote is being reviewed";
    body =
      q?.decision_note ||
      "You can revise your quote while this job is receiving quotes.";
    label = "Revise quote";
    href = `/jobs/${job.id}?action=quote`;
  } else if (
    admin &&
    history?.permissions.provider &&
    !q &&
    job.status === "open" &&
    (!job.quote_deadline ||
      new Date(job.quote_deadline).getTime() >= Date.now())
  ) {
    title = "Ready to quote?";
    body = "Share your price, availability, and what is included.";
    label = "Send a quote";
    href = `/jobs/${job.id}?action=quote`;
  } else if (participant && job.status === "awarded" && permissions.hirer) {
    title = "Waiting for company confirmation";
    body = "The job starts when the selected company accepts the agreed quote.";
  } else if (participant && job.status === "review") {
    title = "Your work is being reviewed";
    body = "Your client will accept the work or request changes here.";
  } else if (participant && job.status === "completed") {
    title = "Job finished";
    body = "Your messages, files, and agreement are saved together.";
    label = "Leave a review";
    href = `/jobs/${job.id}#job-review`;
  }
  if (!title && !action && !notice) return null;
  const close = () => {
    if (!busy && !pendingUpdate) {
      setAction(null);
      setError("");
      setFiles([]);
    }
  };
  const noteForm = (
    heading: string,
    placeholder: string,
    submit: () => void,
    buttonLabel: string,
  ) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3>{heading}</h3>
      <label className="project-action-label">
        {placeholder}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={5000}
          required
          disabled={busy}
        />
      </label>
      <button
        className="jobs-button jobs-primary"
        disabled={busy || !note.trim()}
      >
        {busy ? "Saving…" : buttonLabel}
      </button>
    </form>
  );
  return (
    <section
      className={`project-next-action ${action ? "is-expanded" : ""}`}
      aria-label="Next step"
    >
      {title && (
        <div className="project-next-summary">
          <span className="project-next-icon">
            <ClipboardCheck size={18} />
          </span>
          <div>
            <strong>{title}</strong>
            <p>{body}</p>
          </div>
          {label &&
            !action &&
            (href ? (
              <Link className="jobs-button jobs-primary" to={href}>
                {label}
                <ArrowRight size={15} />
              </Link>
            ) : (
              <button
                className="jobs-button jobs-primary"
                disabled={busy}
                onClick={() =>
                  next
                    ? open(next)
                    : void run(
                        "activity",
                        { kind: "update_requested" },
                        "Update requested.",
                      )
                }
              >
                {label}
              </button>
            ))}
          {action && (
            <button
              className="inbox-icon-button"
              aria-label="Close action"
              disabled={busy || !!pendingUpdate}
              onClick={close}
            >
              <X size={18} />
            </button>
          )}
        </div>
      )}
      {!action &&
        history?.permissions.canProposeChange &&
        history.agreement &&
        !pendingChange && (
          <div className="project-secondary-action">
            <button
              className="project-text-button"
              onClick={() => {
                setChangeScope("");
                setChangeTitle("");
                setChangeAmount("");
                setChangeStart(history.agreement!.start_window);
                setChangeDuration(history.agreement!.duration);
                open("propose-change");
              }}
            >
              Propose a scope, price, or date change
            </button>
          </div>
        )}
      {history?.paymentStagesNeedReview && (
        <p className="project-payment-review">
          Update payment stages to match the agreed price.{" "}
          <Link to={`/jobs/${job.id}?tab=payments`}>
            Review payment stages <ArrowRight size={13} />
          </Link>
        </p>
      )}
      {notice && (
        <p className="project-action-notice" role="status">
          <Check size={15} />
          {notice}
        </p>
      )}
      {action && (
        <div className="project-action-body">
          {(action === "quote" ||
            action === "choose" ||
            action === "confirm") &&
            latest && (
              <>
                <div className="project-quote-summary">
                  <b>{projectMoney(latest.amount_cents)}</b>
                  <span>Quote version {latest.version}</span>
                </div>
                <p className="project-quote-note">{latest.note}</p>
                <div className="project-quote-facts">
                  <span>
                    Start{" "}
                    <strong>{latest.start_window || "To be agreed"}</strong>
                  </span>
                  <span>
                    Duration{" "}
                    <strong>{latest.duration || "To be agreed"}</strong>
                  </span>
                </div>
                <details>
                  <summary>Scope, payment terms & files</summary>
                  <QuoteTerms version={latest} showAnswers={false} />
                </details>
                <ProposalAnswers answers={latest.proposal_answers || []} />
              </>
            )}
          {action === "quote" && (
            <div className="project-action-buttons">
              <button
                className="jobs-button jobs-primary"
                onClick={() => open("choose")}
              >
                Choose this company
              </button>
              <button
                className="jobs-button jobs-secondary"
                onClick={() => open("changes")}
              >
                Request changes
              </button>
              <button
                className="project-text-button"
                onClick={() => open("decline")}
              >
                Decline quote
              </button>
            </div>
          )}
          {action === "choose" && (
            <>
              <p>
                Choosing this company closes the other quotes. This company will
                be asked to confirm before work begins.
              </p>
              <button
                className="jobs-button jobs-primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    "choose",
                    { quoteId: q!.id, version: q!.current_version },
                    "Company chosen. Waiting for confirmation.",
                  )
                }
              >
                {busy ? "Choosing…" : "Choose company & send confirmation"}
              </button>
            </>
          )}
          {action === "confirm" && (
            <div className="project-action-buttons">
              <button
                className="jobs-button jobs-primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    "confirm",
                    {
                      decision: "accept",
                      quoteId: q!.id,
                      version: q!.accepted_version || q!.current_version,
                    },
                    "Job confirmed. You can now share progress.",
                  )
                }
              >
                Confirm & start job
              </button>
              <button
                className="project-text-button"
                disabled={busy}
                onClick={() => open("decline-job")}
              >
                Decline this job
              </button>
            </div>
          )}
          {action === "changes" &&
            noteForm(
              "Request quote changes",
              "Tell the company what needs to change",
              () =>
                void run(
                  "quote-decision",
                  {
                    quoteId: q!.id,
                    version: q!.current_version,
                    decision: "changes",
                    note,
                  },
                  "Changes requested.",
                ),
              "Send change request",
            )}
          {action === "decline" &&
            noteForm(
              "Decline this quote",
              "Give the company a reason",
              () =>
                void run(
                  "quote-decision",
                  {
                    quoteId: q!.id,
                    version: q!.current_version,
                    decision: "decline",
                    note,
                  },
                  "Quote declined.",
                ),
              "Decline quote",
            )}
          {action === "decline-job" &&
            noteForm(
              "Decline this job",
              "Let the client know why you cannot take this job",
              () =>
                void run(
                  "confirm",
                  {
                    decision: "decline",
                    note,
                    quoteId: q!.id,
                    version: q!.accepted_version || q!.current_version,
                  },
                  "The client has been notified.",
                ),
              "Decline job",
            )}
          {(action === "progress" || action === "completion") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void update(action);
              }}
            >
              <h3>
                {action === "completion"
                  ? "Send finished work for review"
                  : "Share a progress update"}
              </h3>
              <label className="project-action-label">
                {action === "completion"
                  ? "What was completed?"
                  : "What has been done?"}
                <textarea
                  rows={3}
                  required
                  maxLength={5000}
                  placeholder={
                    action === "completion"
                      ? "Summarize the completed work and include final photos or documents."
                      : "For example, 8 of 18 systems installed. We are on schedule."
                  }
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy || !!pendingUpdate}
                />
              </label>
              <AttachmentPicker
                files={files}
                onChange={setFiles}
                disabled={busy || !!pendingUpdate}
                label="Add photos or documents"
              />
              <div className="project-action-buttons">
                <button
                  className="jobs-button jobs-primary"
                  disabled={busy || !note.trim()}
                >
                  {busy ? (
                    <LoaderCircle className="inbox-spinner" size={16} />
                  ) : (
                    <Check size={16} />
                  )}{" "}
                  {pendingUpdate
                    ? files.length
                      ? "Retry remaining files"
                      : "Finish sharing update"
                    : action === "completion"
                      ? "Send for review"
                      : "Share update"}
                </button>
                {permissions.chosen &&
                  action === "progress" &&
                  !pendingUpdate &&
                  !pendingChange && (
                    <button
                      type="button"
                      className="project-text-button"
                      disabled={busy}
                      onClick={() => setAction("completion")}
                    >
                      Work finished?
                    </button>
                  )}
              </div>
              {pendingUpdate && (
                <p className="project-action-helper">
                  Your update is saved. Finish sharing it before leaving this
                  screen; remaining files will be retried.
                </p>
              )}
            </form>
          )}
          {action === "propose-change" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  "changes",
                  {
                    title: changeTitle,
                    scope: changeScope,
                    amountDeltaCents: Math.round(
                      Number(changeAmount || 0) * 100,
                    ),
                    agreementVersion: history!.agreement!.revision,
                    startWindow: changeStart,
                    duration: changeDuration,
                  },
                  "Change proposed. The other company must approve it before the agreement changes.",
                );
              }}
            >
              <h3>Propose a change to this job</h3>
              <p>
                Both companies must agree before the price, scope, or dates
                change.
              </p>
              <label className="project-action-label">
                What is changing?
                <input
                  required
                  minLength={3}
                  maxLength={160}
                  value={changeTitle}
                  onChange={(e) => setChangeTitle(e.target.value)}
                  placeholder="For example, add two more rooftop systems"
                  disabled={busy}
                />
              </label>
              <label className="project-action-label">
                Describe the change to the work
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={changeScope}
                  onChange={(e) => setChangeScope(e.target.value)}
                  maxLength={5000}
                  disabled={busy}
                />
              </label>
              <div className="project-change-fields">
                <label className="project-action-label">
                  Price change (USD)
                  <input
                    type="number"
                    step="0.01"
                    value={changeAmount}
                    onChange={(e) => setChangeAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={busy}
                  />
                  <small>Use a minus for a reduction.</small>
                </label>
                <label className="project-action-label">
                  Updated start
                  <input
                    value={changeStart}
                    maxLength={120}
                    onChange={(e) => setChangeStart(e.target.value)}
                    disabled={busy}
                    placeholder={
                      history?.agreement?.start_window || "No change"
                    }
                  />
                </label>
                <label className="project-action-label">
                  Updated duration
                  <input
                    value={changeDuration}
                    maxLength={120}
                    onChange={(e) => setChangeDuration(e.target.value)}
                    disabled={busy}
                    placeholder={history?.agreement?.duration || "No change"}
                  />
                </label>
              </div>
              <button
                className="jobs-button jobs-primary"
                disabled={
                  busy ||
                  changeTitle.trim().length < 3 ||
                  changeScope.trim().length < 10
                }
              >
                {busy ? "Sending…" : "Send for approval"}
              </button>
            </form>
          )}
          {action === "review-change" && pendingChange && (
            <>
              <h3>{pendingChange.title}</h3>
              <p className="project-quote-note">{pendingChange.scope}</p>
              <div className="project-quote-facts">
                <span>
                  Price change
                  <strong>
                    {pendingChange.amount_delta_cents > 0 ? "+" : ""}
                    {projectMoney(pendingChange.amount_delta_cents)}
                  </strong>
                </span>
                {history?.agreement && (
                  <span>
                    New agreed total
                    <strong>
                      {projectMoney(
                        history.agreement.amount_cents +
                          pendingChange.amount_delta_cents,
                      )}
                    </strong>
                  </span>
                )}
                {pendingChange.start_window && (
                  <span>
                    Start<strong>{pendingChange.start_window}</strong>
                  </span>
                )}
                {pendingChange.duration && (
                  <span>
                    Duration<strong>{pendingChange.duration}</strong>
                  </span>
                )}
              </div>
              <div className="project-action-buttons">
                <button
                  className="jobs-button jobs-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      `changes/${pendingChange.id}/decision`,
                      { decision: "accept" },
                      "Change accepted. The agreement has been updated.",
                    )
                  }
                >
                  Accept change
                </button>
                <button
                  className="jobs-button jobs-secondary"
                  disabled={busy}
                  onClick={() => open("decline-change")}
                >
                  Decline change
                </button>
              </div>
            </>
          )}
          {action === "decline-change" &&
            pendingChange &&
            noteForm(
              "Decline this change",
              "Tell the company why",
              () =>
                void run(
                  `changes/${pendingChange.id}/decision`,
                  { decision: "decline", note },
                  "Change declined. The existing agreement stays in place.",
                ),
              "Decline change",
            )}
          {action === "review" && (
            <>
              <h3>Review the finished work</h3>
              {detail.updates
                .filter(
                  (u) =>
                    u.kind === "completion" &&
                    (!u.provider_company_id ||
                      u.provider_company_id === providerId),
                )
                .slice(0, 1)
                .map((update) => (
                  <div key={update.id}>
                    <p className="project-quote-note">{update.body}</p>
                    <JobAttachments
                      files={detail.files.filter(
                        (f) => f.update_id === update.id,
                      )}
                    />
                  </div>
                ))}
              <div className="project-action-buttons">
                <button
                  className="jobs-button jobs-primary"
                  disabled={busy || !latestCompletion}
                  onClick={() =>
                    void run(
                      "review-work",
                      { decision: "accept", updateId: latestCompletion?.id },
                      "Work accepted. The job is finished.",
                    )
                  }
                >
                  Accept & finish job
                </button>
                <button
                  className="jobs-button jobs-secondary"
                  disabled={busy}
                  onClick={() => open("review-changes")}
                >
                  Request changes
                </button>
              </div>
            </>
          )}
          {action === "review-changes" &&
            noteForm(
              "Request changes to the work",
              "Describe what still needs to be done",
              () =>
                void run(
                  "review-work",
                  { decision: "changes", note, updateId: latestCompletion?.id },
                  "Changes requested.",
                ),
              "Request changes",
            )}
          {error && (
            <p className="inbox-send-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
