import type { JobDetail, Quote } from "./jobs";
import type { JobFile } from "./job-attachments";
import { buildJobHistory, type JobHistoryEntry } from "./job-history-model";
import type { ChatEvent, QuoteHistory } from "./project-chat-workflow";
import type { WorkChecklistItem } from "./work-checklist";

const isThreadFile = (file: JobFile, providerId: string) =>
  !file.provider_company_id || file.provider_company_id === providerId;

export function activityTasks(
  detail: JobDetail,
  providerId: string,
): WorkChecklistItem[] {
  if (
    detail.selected?.provider_company_id !== providerId ||
    !(detail.permissions.hirer || detail.permissions.chosen)
  )
    return [];
  return (detail.job.work_checklist || []).map((item) => ({
    ...item,
    proofFiles: (item.proofFiles || []).filter((file) =>
      isThreadFile(file, providerId),
    ),
  }));
}

/** A hirer may have several private conversations about the same job. */
export function scopedActivityDetail(
  detail: JobDetail,
  providerId: string,
): JobDetail {
  const chosen =
    detail.selected?.provider_company_id === providerId &&
    (detail.permissions.hirer || detail.permissions.chosen);
  const quotes = detail.quotes.filter(
    (quote) => quote.provider_company_id === providerId,
  );
  const quoteIds = new Set(quotes.map((quote) => quote.id));
  if (detail.ownQuote?.provider_company_id === providerId)
    quoteIds.add(detail.ownQuote.id);
  if (chosen && detail.selected) quoteIds.add(detail.selected.id);
  return {
    ...detail,
    job: { ...detail.job, work_checklist: activityTasks(detail, providerId) },
    selected: chosen ? detail.selected : null,
    ownQuote:
      detail.ownQuote?.provider_company_id === providerId
        ? detail.ownQuote
        : null,
    quotes,
    agreement: chosen ? detail.agreement : null,
    paymentStages: chosen ? detail.paymentStages : [],
    paymentStagesNeedReview: chosen && detail.paymentStagesNeedReview,
    updates: chosen
      ? detail.updates.filter(
          (update) =>
            !update.provider_company_id ||
            update.provider_company_id === providerId,
        )
      : [],
    files: detail.files.filter(
      (file) =>
        isThreadFile(file, providerId) &&
        (!file.quote_id || quoteIds.has(file.quote_id)) &&
        (!file.update_id || chosen),
    ),
    permissions: {
      ...detail.permissions,
      chosen: chosen && detail.permissions.chosen,
    },
  };
}

export function scopedActivityQuoteHistory(
  history: QuoteHistory | null,
  providerId: string,
): QuoteHistory | null {
  if (!history) return null;
  return {
    ...history,
    events: history.events.filter((event) => {
      const provider = (event as ChatEvent & { provider_company_id?: string })
        .provider_company_id;
      return !provider || provider === providerId;
    }),
    versions: history.versions.map((version) => ({
      ...version,
      files: (version.files || []).filter((file) =>
        isThreadFile(file, providerId),
      ),
    })),
  };
}

/** Exact recorded events for the requested thread, in chronological order. */
export function scopedActivityHistory(
  detail: JobDetail,
  history: QuoteHistory | null,
  providerId: string,
): JobHistoryEntry[] {
  const scoped = scopedActivityDetail(detail, providerId);
  const threadQuote = scoped.selected || scoped.ownQuote || scoped.quotes[0];
  const providerCompany = detail.conversations.find(
    (company) => company.id === providerId,
  );
  // buildJobHistory uses selected only as the provider identity for filtering.
  // This private scope anchor does not assert that a quote was sent or chosen.
  const identity =
    threadQuote ||
    ({ provider_company_id: providerId, company: providerCompany } as Quote);
  return buildJobHistory(
    { ...scoped, selected: identity },
    scopedActivityQuoteHistory(history, providerId),
  ).filter((entry) => entry.kind !== "job_created");
}

/** Only a recorded event for this exact submission/review can mark proof read. */
export function taskActivityEventId(
  task: WorkChecklistItem,
  entries: JobHistoryEntry[],
  history: QuoteHistory | null,
): string | undefined {
  const isCurrent = (entry: JobHistoryEntry) => {
    if (entry.taskId !== task.id || !entry.id.startsWith("event:"))
      return false;
    const event = history?.events.find(
      (event) => `event:${event.id}` === entry.id,
    );
    if (!event) return false;
    if (task.status === "submitted") {
      return (
        entry.kind === "task_proof" &&
        !!task.submissionId &&
        event.update_id === task.submissionId
      );
    }
    return (
      task.status === "changes_requested" &&
      entry.kind === "task_changes_requested" &&
      !!task.reviewedAt &&
      Number.isFinite(Date.parse(task.reviewedAt)) &&
      Date.parse(entry.at) === Date.parse(task.reviewedAt)
    );
  };
  return entries.find(isCurrent)?.id.slice(6);
}

/** Count actions this viewer can take, not unread or historical notifications. */
export function pendingActivityCount(
  detail: JobDetail,
  history: QuoteHistory | null,
  providerId: string,
  admin: boolean,
): number {
  if (!admin) return 0;
  const { job, permissions } = detail;
  const participant =
    detail.selected?.provider_company_id === providerId &&
    (permissions.hirer || permissions.chosen);
  if (["completed", "cancelled", "draft"].includes(job.status)) return 0;
  const tasks = activityTasks(detail, providerId);
  let count = tasks.filter((task) =>
    permissions.hirer && ["in_progress", "review"].includes(job.status)
      ? task.status === "submitted"
      : permissions.chosen &&
        job.status === "in_progress" &&
        task.status === "changes_requested",
  ).length;
  const quote = history?.quote;
  if (quote?.upload_pending && history?.permissions.provider) count += 1;
  else if (job.status === "open" && history?.permissions.canDecide) count += 1;
  else if (job.status === "awarded" && history?.permissions.canConfirm)
    count += 1;
  else if (
    job.status === "open" &&
    history?.permissions.canRevise &&
    quote?.status === "changes_requested"
  )
    count += 1;
  if (participant && permissions.hirer && job.status === "review") count += 1;
  const ownCompanyId = permissions.hirer ? detail.hiringCompany.id : providerId;
  if (
    participant &&
    history?.changes?.some(
      (change) =>
        change.status === "pending" && change.company_id !== ownCompanyId,
    )
  )
    count += 1;
  return count;
}
