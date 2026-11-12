/** Present supported company facts beside the requirements for one job. */
export type MatchCompany = {
  id: string;
  name: string;
  slug: string;
  username?: string;
  logo_url: string;
  logo_style?: string;
  is_demo?: boolean;
  location: string;
  claimed: boolean;
};

type Credential = { title: string; scope: string };
export type MatchPreferences = {
  kind: string;
  categoryId: string;
  countryCode: string;
  stateCode: string;
  city?: string;
  sector?: string;
  systemType?: string;
  delivery?: string;
  preferredCredentials: Credential[];
  requiredCredentials?: { catalogKey: string; scope: string }[];
  preferAvailable: boolean;
  preferLocal?: boolean;
  preferredStart?: string;
  requireAvailability?: boolean;
  startBy?: string;
};

export type Match = {
  company: MatchCompany;
  eligible: boolean;
  evidenceLevel?: string;
  reasons: string[];
  followUp: string[];
  offerings: {
    offering: {
      id?: string;
      kind?: string;
      categoryId?: string;
      title: string;
      detail: string;
      delivery?: string;
      productRole?: string;
      sectors?: string[];
      systemTypes?: string[];
    };
    sources: { url: string; title: string; basis?: string }[];
    needsConfirmation?: string[];
    preferredCredentials?: (Credential & {
      basis?: string;
      sourceUrl?: string;
    })[];
    coverage?: {
      label: string;
      kind: string;
      countryCode: string;
      stateCode?: string;
    }[];
    availability: string;
    earliestStart?: string | null;
    availabilityValidUntil?: string | null;
  }[];
};

export type Matches = {
  configured: boolean;
  canEdit?: boolean;
  job: {
    id: string;
    title: string;
    location: string;
    status: string;
    quote_deadline?: string;
    system_size_kw?: number | null;
    people_needed?: number | null;
    project_type?: string;
    start_window?: string;
  };
  matches?: Match[];
  needsConfirmation?: Match[];
  totalMatches?: number;
  totalNeedsConfirmation?: number;
  invitedCompanyIds?: string[];
  conversationCompanyIds?: string[];
  pageSize?: number;
  preferences?: MatchPreferences;
};

export type MatchFact = {
  key: string;
  label: string;
  value: string;
  state: "matched" | "check" | "unavailable";
  detail?: string;
};
export type MatchFit = {
  facts: MatchFact[];
  gaps: MatchFact[];
  heading: string;
  summary: string;
};

const labels: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  industrial: "Industrial",
  agricultural: "Agricultural",
  municipal: "Municipal",
  nonprofit: "Nonprofit",
  utility: "Utility-scale",
  rooftop: "Rooftop",
  "ground-mount": "Ground mount",
  carport: "Carport",
  pergola: "Pergola",
  "fixed-tilt": "Fixed tilt",
  "tracker-foundations": "Tracker foundations",
  floating: "Floating",
  tracking: "Tracking",
  turnkey: "Complete installation",
  "labor-only": "Labor only",
  "specialist-service": "Specialist service",
  "contract-staff": "Contract staff",
  advisory: "Advice or consulting",
  "managed-project": "Project management",
  supply: "Supply",
};
const label = (value: string) =>
  labels[value] ||
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");
const joined = (values: string[]) =>
  values.length < 2
    ? values[0] || ""
    : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
const credentialLabel = (credential: Credential) =>
  `${credential.title}${credential.scope === "company" ? "" : ` (${credential.scope})`}`;
const credentialKey = (credential: Credential) =>
  `${credential.title.trim().toLowerCase()}:${credential.scope}`;
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

export function matchFit(match: Match, data: Matches): MatchFit {
  const best = match.offerings[0];
  const offering = best?.offering;
  const preferences = data.preferences;
  const missing = new Set(best?.needsConfirmation || []);
  const facts: MatchFact[] = [];
  const gaps: MatchFact[] = [];
  const add = (fact: MatchFact, hardKeys: string[] = []) => {
    facts.push(fact);
    if (hardKeys.some((key) => missing.has(key))) gaps.push(fact);
  };

  add({
    key: "work",
    label: preferences?.kind === "product" ? "Product" : "Work",
    value: offering?.title || "Requested service",
    state: "matched",
  });
  const areaMatches =
    best?.needsConfirmation !== undefined && !missing.has("service_area");
  add(
    {
      key: "service_area",
      label: "Service area",
      value: areaMatches
        ? `Serves ${data.job.location}`
        : `Confirm ${data.job.location} coverage`,
      state: areaMatches ? "matched" : "check",
    },
    ["service_area"],
  );

  if (preferences?.sector) {
    const confirmed =
      !missing.has("project_sector") &&
      !!offering?.sectors?.includes(preferences.sector);
    add(
      {
        key: "project_sector",
        label: "Project type",
        value: `${label(preferences.sector)} projects`,
        state: confirmed ? "matched" : "check",
        ...(!confirmed && {
          detail: "Confirm their experience with this type of project.",
        }),
      },
      ["project_sector"],
    );
  }
  if (preferences?.systemType) {
    const confirmed =
      !missing.has("system_type") &&
      !!offering?.systemTypes?.includes(preferences.systemType);
    add(
      {
        key: "system_type",
        label: "System type",
        value: label(preferences.systemType),
        state: confirmed ? "matched" : "check",
        ...(!confirmed && {
          detail: "Confirm their experience with this system.",
        }),
      },
      ["system_type"],
    );
  }
  if (preferences?.delivery) {
    const confirmed =
      !missing.has("delivery_method") &&
      offering?.delivery === preferences.delivery;
    add(
      {
        key: "delivery_method",
        label: "Work approach",
        value: label(preferences.delivery),
        state: confirmed ? "matched" : "check",
        ...(!confirmed && {
          detail: "Confirm how much of the work their team will handle.",
        }),
      },
      ["delivery_method"],
    );
  }

  if (preferences?.kind !== "product" && offering?.kind !== "product") {
    const status = best?.availability;
    const earliest = best?.earliestStart?.slice(0, 10);
    const validEarliest =
      earliest &&
      /^\d{4}-\d{2}-\d{2}$/.test(earliest) &&
      !Number.isNaN(Date.parse(earliest));
    const requestedStart = preferences?.startBy || preferences?.preferredStart;
    const startUnknown =
      !!requestedStart && (!validEarliest || earliest > requestedStart);
    const accepting = status === "accepting" || status === "limited";
    let availability: MatchFact = {
      key: "availability",
      label: requestedStart ? "Start date" : "Availability",
      value: requestedStart
        ? "Start date to confirm"
        : "Ask about availability",
      state: "check",
    };
    if (status === "unavailable") {
      availability = {
        ...availability,
        value: "Not accepting new work",
        state: "unavailable",
      };
    } else if (
      accepting &&
      !startUnknown &&
      !missing.has("availability") &&
      !missing.has("start_date")
    ) {
      availability = {
        ...availability,
        value:
          status === "limited" ? "Limited availability" : "Accepting new work",
        state: "matched",
        ...(validEarliest && {
          detail: `Earliest start: ${dateLabel(earliest)}`,
        }),
      };
    } else if (
      accepting &&
      validEarliest &&
      requestedStart &&
      earliest > requestedStart
    ) {
      availability = {
        ...availability,
        value: `Available from ${dateLabel(earliest)}`,
        detail: "Their listed start is later than your preferred date.",
      };
    }
    add(availability, ["availability", "start_date", "not_accepting_work"]);
  }

  const preferred = preferences?.preferredCredentials || [];
  if (preferred.length) {
    const listed = new Set(
      (best?.preferredCredentials || []).map(credentialKey),
    );
    const absent = preferred.filter(
      (credential) => !listed.has(credentialKey(credential)),
    );
    const matched = preferred.length - absent.length;
    add({
      key: "preferred_credentials",
      label: "Preferred certifications",
      value: absent.length
        ? `${matched} of ${preferred.length} listed`
        : preferred.map(credentialLabel).join(", "),
      state: absent.length ? "check" : "matched",
      detail: absent.length
        ? `Ask about ${joined(absent.map(credentialLabel))}.`
        : "Listed on their company profile.",
    });
  }
  if (
    preferences?.requiredCredentials?.length ||
    missing.has("required_credentials")
  ) {
    const requiredMissing = missing.has("required_credentials");
    add(
      {
        key: "required_credentials",
        label: "Required certifications",
        value: requiredMissing
          ? "Confirm required certifications"
          : "Required certifications match",
        state: requiredMissing ? "check" : "matched",
      },
      ["required_credentials"],
    );
  }
  if (data.job.system_size_kw && data.job.system_size_kw > 0) {
    add({
      key: "capacity",
      label: "Project capacity",
      value: `Confirm ${new Intl.NumberFormat("en-US").format(data.job.system_size_kw)} kW capacity`,
      state: "check",
    });
  }
  if (data.job.people_needed && data.job.people_needed > 0) {
    add({
      key: "crew",
      label: "Crew size",
      value: `Confirm ${data.job.people_needed} ${data.job.people_needed === 1 ? "person" : "people"}`,
      state: "check",
    });
  }

  const gapSubjects: Record<string, string> = {
    service_area: "service area",
    project_sector: preferences?.sector
      ? `${label(preferences.sector).toLowerCase()} experience`
      : "project experience",
    system_type: preferences?.systemType
      ? `${label(preferences.systemType).toLowerCase()} experience`
      : "system experience",
    delivery_method: "work approach",
    required_credentials: "required certifications",
    availability:
      preferences?.preferredStart || preferences?.startBy
        ? "start date"
        : "availability",
  };
  const subjects = [
    ...new Set(gaps.map((fact) => gapSubjects[fact.key]).filter(Boolean)),
  ];
  const heading = match.eligible ? "Service & area match" : "Check job fit";
  const summary = missing.has("not_accepting_work")
    ? "They are not accepting new work. Ask whether they can take this job."
    : subjects.length
      ? `Confirm their ${joined(subjects)}.`
      : match.eligible
        ? "Their listed service and service area fit this job."
        : "Check the company details before starting a conversation.";

  return { facts, gaps, heading, summary };
}
