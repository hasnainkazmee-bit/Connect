export type JobFocusInput = {
  status: string;
  hiring_company_id?: string | null;
  quote_count?: number | null;
  invited?: boolean;
  my_quote_status?: string | null;
};

export type JobNextStep = {
  label: string;
  detail: string;
  priority: number;
};

/** Only actions supported by the company's role and the current job state. */
export function jobNextStep(
  job: JobFocusInput,
  companyId?: string | null,
): JobNextStep | null {
  if (!companyId) return null;
  const own = job.hiring_company_id === companyId;

  if (own && job.status === "review") {
    return {
      label: "Review work",
      detail: "Work has been submitted. Review it before finishing the job.",
      priority: 1,
    };
  }
  if (!own && job.status === "awarded" && job.my_quote_status === "chosen") {
    return {
      label: "Confirm job",
      detail: "Your company was chosen. Confirm that you can take on this job.",
      priority: 2,
    };
  }
  if (
    own &&
    job.status === "open" &&
    Number.isInteger(job.quote_count) &&
    (job.quote_count ?? 0) > 0
  ) {
    return {
      label: "Review quotes",
      detail: `${job.quote_count} ${job.quote_count === 1 ? "quote is" : "quotes are"} ready to review.`,
      priority: 3,
    };
  }
  if (!own && job.status === "open" && job.invited && !job.my_quote_status) {
    return {
      label: "View invitation",
      detail: "You were invited to quote for this job.",
      priority: 4,
    };
  }
  if (own && job.status === "draft") {
    return {
      label: "Finish draft",
      detail: "Your job is saved as a draft. Finish it when you're ready.",
      priority: 5,
    };
  }
  return null;
}

/** Returns only actionable jobs, without changing the input or order of ties. */
export function sortAttentionJobs<T extends JobFocusInput>(
  jobs: readonly T[],
  companyId?: string | null,
): T[] {
  return jobs
    .map((job, index) => ({ job, index, next: jobNextStep(job, companyId) }))
    .filter((item) => item.next !== null)
    .sort((a, b) => a.next!.priority - b.next!.priority || a.index - b.index)
    .map((item) => item.job);
}
