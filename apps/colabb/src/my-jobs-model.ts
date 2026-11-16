import { jobNextStep, type JobFocusInput } from "./job-list-focus";

export type MyJobStage = "quotes" | "active" | "drafts" | "finished";
export type MyJobSummary = {
  stage: MyJobStage;
  label: string;
  tone: "neutral" | "blue" | "green" | "orange";
  detail: string;
  actionLabel: string;
  actionSuffix: string;
  attention: boolean;
  priority: number;
  role: "hiring" | "providing" | "quoting" | "invited";
};

/** Describe this company's involvement, rather than somebody else's job progress. */
export function myJobSummary(
  job: JobFocusInput,
  companyId?: string,
  canManage = false,
): MyJobSummary {
  const own = !!companyId && job.hiring_company_id === companyId;
  const chosen = !own && job.my_quote_status === "chosen";
  const role: MyJobSummary["role"] = own
    ? "hiring"
    : chosen
      ? "providing"
      : job.invited && !job.my_quote_status
        ? "invited"
        : "quoting";
  const base: MyJobSummary = {
    stage: "quotes",
    label: "Job details",
    tone: "neutral",
    detail: "Open the job to see the latest details.",
    actionLabel: "View job",
    actionSuffix: "",
    attention: false,
    priority: 99,
    role,
  };
  const quoteOutcome: Record<string, Pick<MyJobSummary, "label" | "detail">> = {
    declined: {
      label: "Quote declined",
      detail: "The hiring company declined your quote.",
    },
    withdrawn: {
      label: "Quote withdrawn",
      detail: "Your company withdrew its quote.",
    },
    award_declined: {
      label: "Job declined",
      detail: "Your company declined the job after being chosen.",
    },
    not_chosen: {
      label: "Not chosen",
      detail: "Another company was chosen for this job.",
    },
  };
  const outcome =
    !own && job.my_quote_status ? quoteOutcome[job.my_quote_status] : undefined;

  // Terminal jobs never ask for an obsolete quote or invitation action.
  if (job.status === "cancelled") {
    return {
      ...base,
      stage: "finished",
      label: "Cancelled",
      detail: "This job was cancelled.",
    };
  }
  if (job.status === "completed") {
    return {
      ...base,
      stage: "finished",
      ...(own || chosen
        ? {
            label: "Completed",
            tone: "green" as const,
            detail: "This job is complete.",
          }
        : outcome || {
            label: "Job closed",
            detail: "This job is complete and is no longer accepting quotes.",
          }),
    };
  }
  if (outcome) return { ...base, stage: "finished", ...outcome };

  if (own && job.status === "draft") {
    return {
      ...base,
      stage: "drafts",
      label: "Draft",
      detail: "Saved for later. This job has not been published.",
      actionLabel: canManage ? "Finish draft" : "View job",
      actionSuffix: canManage ? "/edit" : "",
    };
  }

  let summary = base;
  if (own && job.status === "open") {
    const count =
      Number.isInteger(job.quote_count) && (job.quote_count ?? 0) > 0
        ? job.quote_count!
        : 0;
    summary = {
      ...base,
      label: "Receiving quotes",
      tone: "blue",
      detail: count
        ? `${count} ${count === 1 ? "quote" : "quotes"} received.`
        : "Your job is live. Waiting for companies to quote.",
    };
  } else if ((own || chosen) && job.status === "awarded") {
    summary = {
      ...base,
      stage: "active",
      label: "Awaiting confirmation",
      tone: "blue",
      detail: own
        ? "Waiting for your chosen company to confirm the job."
        : "Your company was chosen for this job.",
    };
  } else if ((own || chosen) && job.status === "in_progress") {
    summary = {
      ...base,
      stage: "active",
      label: "In progress",
      tone: "green",
      detail: "See the work checklist, proof, and updates.",
      actionLabel: "View progress",
    };
  } else if ((own || chosen) && job.status === "review") {
    summary = {
      ...base,
      stage: "active",
      label: own ? "Ready for review" : "Awaiting approval",
      tone: own ? "orange" : "blue",
      detail: own
        ? "Work has been submitted for your company's review."
        : "Waiting for the hiring company to review the submitted work.",
      actionLabel: "View progress",
    };
  } else if (
    !own &&
    ["awarded", "in_progress", "review"].includes(job.status)
  ) {
    return {
      ...base,
      stage: "finished",
      label: "Not chosen",
      detail: "Another company was chosen for this job.",
    };
  } else if (!own && job.status === "open") {
    if (job.my_quote_status === "changes_requested") {
      summary = {
        ...base,
        label: "Changes requested",
        tone: "orange",
        detail: "The hiring company requested changes to your quote.",
      };
    } else if (job.my_quote_status === "submitted") {
      summary = {
        ...base,
        label: "Quote sent",
        tone: "blue",
        detail: "Waiting for the hiring company to review your quote.",
      };
    } else if (job.invited && !job.my_quote_status) {
      summary = {
        ...base,
        label: "Invited to quote",
        tone: "blue",
        detail: "Your company was invited to quote for this job.",
      };
    }
  }

  const next = canManage ? jobNextStep(job, companyId) : null;
  return next
    ? {
        ...summary,
        detail: next.detail,
        actionLabel: next.label,
        attention: true,
        priority: next.priority,
      }
    : summary;
}
