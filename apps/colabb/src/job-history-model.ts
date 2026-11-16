import type { JobDetail } from "./jobs";
import type { JobFile } from "./job-attachments";
import type { ChatEvent, QuoteHistory } from "./project-chat-workflow";

export type JobHistoryEntry = {
  id: string;
  title: string;
  actor: string;
  at: string;
  tone: "neutral" | "blue" | "green" | "orange";
  body: string;
  files: JobFile[];
  kind: string;
  taskId?: string;
  taskTitle?: string;
};

// The API includes these IDs even though the older chat view needs only names.
type RecordedEvent = ChatEvent & {
  company_id?: string;
  provider_company_id?: string;
};
type RecordedUpdate = JobDetail["updates"][number] & {
  company_id?: string;
  author_name?: string;
};

const labels: Record<string, { title: string; tone: JobHistoryEntry["tone"] }> =
  {
    quote_recorded: { title: "Existing quote recorded", tone: "neutral" },
    quote_submitted: { title: "Quote received", tone: "blue" },
    quote_revised: { title: "Quote revised", tone: "blue" },
    quote_changes_requested: {
      title: "Quote changes requested",
      tone: "orange",
    },
    quote_declined: { title: "Quote declined", tone: "orange" },
    quote_withdrawn: { title: "Quote withdrawn", tone: "neutral" },
    company_chosen: { title: "Company chosen", tone: "blue" },
    not_chosen: { title: "Another company was chosen", tone: "neutral" },
    award_accepted: { title: "Company confirmed the job", tone: "green" },
    award_declined: { title: "Company declined the job", tone: "orange" },
    progress: { title: "Progress update", tone: "neutral" },
    completion: { title: "Work sent for final review", tone: "blue" },
    work_submitted: { title: "Work sent for final review", tone: "blue" },
    work_accepted: { title: "Job completed", tone: "green" },
    job_completed: { title: "Job completed", tone: "green" },
    update_requested: { title: "Update requested", tone: "blue" },
    changes_requested: { title: "Changes requested", tone: "orange" },
    work_changes_requested: {
      title: "Final work changes requested",
      tone: "orange",
    },
    problem: { title: "Problem reported", tone: "orange" },
    change_proposed: { title: "Job change proposed", tone: "blue" },
    change_accepted: { title: "Job change approved", tone: "green" },
    change_declined: { title: "Job change declined", tone: "orange" },
    scope_proposed: { title: "Job change proposed", tone: "blue" },
    scope_accepted: { title: "Job change approved", tone: "green" },
    scope_declined: { title: "Job change declined", tone: "orange" },
  };

const validDate = (at: string | undefined): at is string =>
  !!at && Number.isFinite(Date.parse(at));
const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const actorLabel = (name?: string, company?: string) =>
  [name?.trim(), company?.trim()]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" · ");

/** Recorded history, rather than milestones inferred from today's job status. */
export function buildJobHistory(
  detail: JobDetail,
  history?: QuoteHistory | null,
): JobHistoryEntry[] {
  const provider = detail.selected?.provider_company_id;
  const providerName = detail.selected?.company?.name;
  const belongsToProvider = (id?: string | null) => !id || id === provider;
  const visibleFile = (file: JobFile) =>
    belongsToProvider(file.provider_company_id);
  const uniqueFiles = (files: JobFile[]) => [
    ...new Map(
      files.filter(visibleFile).map((file) => [file.id, file]),
    ).values(),
  ];
  const updates = (detail.updates as RecordedUpdate[]).filter(
    (update) =>
      belongsToProvider(update.provider_company_id) &&
      validDate(update.created_at),
  );
  const entries: JobHistoryEntry[] = [];

  if (validDate(detail.job.created_at)) {
    entries.push({
      id: `job:${detail.job.id}`,
      kind: "job_created",
      title: "Job created",
      actor: detail.hiringCompany.name,
      at: detail.job.created_at,
      tone: "neutral",
      body: "",
      files: [],
    });
  }

  const events = (history?.events || []).filter(
    (event: RecordedEvent) =>
      belongsToProvider(event.provider_company_id) &&
      validDate(event.created_at),
  ) as RecordedEvent[];
  const eventIds = new Set<string>();
  const updateIds = new Set<string>();

  const add = (event: RecordedEvent, files: JobFile[], id: string) => {
    const label = labels[event.kind] || {
      title: "Project update",
      tone: "neutral" as const,
    };
    const entry: JobHistoryEntry = {
      id,
      kind: event.kind,
      ...label,
      actor: actorLabel(event.actor_name, event.company_name),
      at: event.created_at,
      body: event.body,
      files: uniqueFiles(files),
    };

    if (event.kind === "progress") {
      const firstLine = event.body.split(/\r?\n/, 1)[0];
      const isCompany = (id: string | undefined, name: string | undefined) =>
        event.company_id
          ? event.company_id === id
          : !!name && event.company_name === name;
      for (const item of detail.job.work_checklist || []) {
        // Latest proof has a structured submission ID; older records retain the
        // server-generated task heading. Require an exact task and the right side.
        const isProof =
          isCompany(provider, providerName) &&
          ((!!event.update_id && event.update_id === item.submissionId) ||
            firstLine === `Proof submitted: ${item.title}`);
        const isApproval =
          isCompany(detail.hiringCompany.id, detail.hiringCompany.name) &&
          firstLine === `Task approved: ${item.title}`;
        const isChanges =
          isCompany(detail.hiringCompany.id, detail.hiringCompany.name) &&
          firstLine === `Task changes requested: ${item.title}`;
        if (!isProof && !isApproval && !isChanges) continue;
        entry.kind = isProof
          ? "task_proof"
          : isApproval
            ? "task_approved"
            : "task_changes_requested";
        entry.title = isProof
          ? "Task proof submitted"
          : isApproval
            ? "Task approved"
            : "Task changes requested";
        entry.tone = isProof ? "blue" : isApproval ? "green" : "orange";
        entry.taskId = item.id;
        entry.taskTitle = item.title;
        break;
      }
    }
    entries.push(entry);
  };

  for (const event of events) {
    if (
      eventIds.has(event.id) ||
      (event.update_id && updateIds.has(event.update_id))
    )
      continue;
    eventIds.add(event.id);
    if (event.update_id) updateIds.add(event.update_id);
    const version = history?.versions.find(
      (version) =>
        version.version === event.quote_version &&
        (!event.quote_id || event.quote_id === history.quote?.id),
    );
    add(
      event,
      [
        ...(event.update_id
          ? detail.files.filter((file) => file.update_id === event.update_id)
          : []),
        ...(version?.files || []),
      ],
      `event:${event.id}`,
    );
  }

  for (const update of updates) {
    if (updateIds.has(update.id)) continue;
    // Final decisions with a note also produce a legacy update, without an
    // update_id on their event. They are one action, not two timeline steps.
    if (
      events.some(
        (event) =>
          ["work_accepted", "work_changes_requested"].includes(event.kind) &&
          ["system", "changes_requested"].includes(update.kind) &&
          event.body === update.body &&
          event.company_name === update.company_name &&
          sameTime(event.created_at, update.created_at),
      )
    )
      continue;
    updateIds.add(update.id);
    add(
      {
        id: update.id,
        kind: update.kind,
        body: update.body,
        update_id: update.id,
        actor_name: update.author_name || "",
        company_name: update.company_name,
        company_id: update.company_id,
        created_at: update.created_at,
      },
      detail.files.filter((file) => file.update_id === update.id),
      `update:${update.id}`,
    );
  }

  entries.sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
  const proofCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "task_proof" || !entry.taskId) continue;
    const previous = proofCounts.get(entry.taskId) || 0;
    if (previous) entry.title = "Task proof resubmitted";
    proofCounts.set(entry.taskId, previous + 1);
  }
  return entries;
}
