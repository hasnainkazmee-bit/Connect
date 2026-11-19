// Public discovery uses recorded services, never keywords inferred from names.
export const usStates: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};
export const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const serviceNames: Record<string, string> = {
  "solar-installation": "Solar installers",
  electrical: "Electrical contractors",
  roofing: "Roofing companies",
  "solar-design": "Solar design and engineering companies",
  "battery-storage": "Battery storage installers",
  "ev-charging": "EV charger installers",
  "solar-maintenance": "Solar maintenance companies",
  "solar-detach-reset": "Solar removal and reinstallation companies",
  "solar-cleaning": "Solar panel cleaning companies",
  "crew-supply": "Solar installation crews",
  "equipment-supply": "Solar equipment suppliers",
  "equipment-procurement": "Equipment sourcing companies",
};
export const serviceGuidance: Record<string, [string, string]> = {
  "solar-installation": [
    "Compare installation experience",
    "Share the system size, roof or ground-mount layout, site location and target start date. Ask who handles electrical work, permits and final commissioning.",
  ],
  electrical: [
    "Define the electrical scope",
    "Include system voltage, drawings, equipment, interconnection requirements and the work already completed. Ask about licensing for the job location and experience with similar systems.",
  ],
  roofing: [
    "Plan the roof and solar work together",
    "Describe the roof material, age, condition and area. Say whether panels need to be removed and reinstalled, and clarify responsibility for waterproofing and warranties.",
  ],
  "solar-design": [
    "Prepare a useful design brief",
    "Share site measurements, system capacity, equipment choices and the required drawings. Confirm the engineer’s licensing, deliverables and permitting responsibilities.",
  ],
  "battery-storage": [
    "Specify what the storage system needs to do",
    "Share energy and power requirements, backup loads, existing equipment and site constraints. Confirm compatibility, installation scope and commissioning responsibilities.",
  ],
  "solar-maintenance": [
    "Explain the issue and the system",
    "Include system age, equipment models, monitoring alerts, photos and access details. Ask what the visit includes and how findings and repairs will be documented.",
  ],
};
export type PublicMetadata = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  image: string;
  imageAlt: string;
  schema: Record<string, unknown> | null;
};
export type PublicPagePayload = {
  metadata: PublicMetadata;
  discoveryHtml?: string;
  status: number;
  redirect?: string;
};
export const escapeHTML = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function httpUrl(
  value: string | null | undefined,
  origin: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function headquarters(
  location: string,
): { state: string; city: string; cityKey: string } | null {
  // Only an explicit US state in a city/state address. No guessed geocoding.
  const match = location
    .trim()
    .match(
      /^([^,]+),\s*([^,\d]+?)(?:\s+\d{5}(?:-\d{4})?)?(?:,\s*(?:US|USA|United States(?: of America)?))?$/i,
    );
  if (!match) return null;
  const state = Object.keys(usStates).find(
    (key) =>
      key === match[2].trim().toUpperCase() ||
      usStates[key].toLowerCase() === match[2].trim().toLowerCase(),
  );
  return state
    ? { state, city: match[1].trim(), cityKey: slugify(match[1]) }
    : null;
}
