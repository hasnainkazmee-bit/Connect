import { createHash } from "node:crypto";
import { z } from "zod";
import { tx } from "./db.js";

const key = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const refs = z.array(key).min(1).max(12);
const strings = (max: number) => z.array(text(100)).max(max);
const url = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "Evidence must use a public HTTPS URL without credentials.");
const sector = z.enum([
  "residential",
  "commercial",
  "industrial",
  "agricultural",
  "municipal",
  "nonprofit",
  "utility",
]);
const category = z.enum([
  "solar-installation",
  "solar-design",
  "battery-storage",
  "solar-maintenance",
  "solar-detach-reset",
  "electrical",
  "ev-charging",
  "lighting",
  "backup-power",
  "solar-thermal",
  "wind-power",
  "project-management",
  "contract-maintenance-staff",
  "safety-audits",
  "solar-development",
  "energy-consulting",
  "energy-procurement",
  "equipment-procurement",
  "equipment-supply",
  "logistics",
  "racking-design",
  "racking-installation",
]);
const service = z
  .object({
    id: key,
    category,
    title: text(80),
    detail: text(320),
    sectors: z.array(sector).max(7),
    delivery: z.enum([
      "turnkey",
      "specialist-service",
      "advisory",
      "managed-project",
      "contract-staff",
      "supply",
    ]),
    systems: strings(8),
    thirdPartySystems: z.enum(["accepted", "unknown"]),
    sourceIds: refs,
  })
  .strict();
const product = z
  .object({
    id: key,
    category: z.enum([
      "solar-system",
      "solar-modules",
      "inverters",
      "battery-storage",
      "racking-mounting",
      "foundations",
      "electrical-bos",
      "backup-generators",
    ]),
    title: text(80),
    detail: text(240),
    role: z.enum(["manufactures", "distributes", "supplies-and-installs"]),
    brands: strings(12),
    sourceIds: refs,
  })
  .strict();
const coverage = z
  .object({
    label: text(100),
    kind: z.enum(["city", "metro", "region", "state", "country"]),
    countryCode: z.enum(["US", "CA"]).nullable(),
    stateCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    serviceIds: z.array(key).max(20),
    productIds: z.array(key).max(20),
    sourceIds: refs,
  })
  .strict();
const profile = z
  .object({
    description: z.string().max(5000),
    tagline: z.string().max(200),
    services: strings(20),
    serviceAreas: strings(30),
    trades: strings(12),
    projectTypes: strings(12),
  })
  .strict();

export const providerResearch = z
  .object({
    checkedAt: z.iso.datetime({ offset: true }),
    identityNote: text(500),
    identitySourceIds: refs,
    summarySourceIds: refs,
    baseLocation: z
      .object({
        city: text(100),
        stateCode: z.string().regex(/^[A-Z]{2}$/),
        countryCode: z.literal("US"),
        latitude: z.null(),
        longitude: z.null(),
        precision: z.literal("city"),
        sourceIds: refs,
      })
      .strict(),
    services: z.array(service).min(1).max(20),
    products: z.array(product).max(20),
    coverage: z.array(coverage).max(30),
    sources: z
      .array(
        z
          .object({
            id: key,
            title: text(150),
            url,
            evidence: text(650),
            basis: z.literal("company-website"),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    // Website research cannot establish today's staffing, stock or work schedule.
    availability: z.literal("unknown"),
    earliestStart: z.null(),
    crewCapacity: z.null(),
    stockAvailability: z.literal("unknown"),
    laborOnly: z.literal("unknown"),
    subcontracting: z.literal("unknown"),
    confirmationNeeded: z.array(text(180)).max(12),
    reviewNotes: z.array(text(240)).max(20),
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Date(r.checkedAt).getTime() > Date.now() + 300000)
      fail("Source check cannot be in the future.");
    for (const [name, items] of [
      ["source", r.sources],
      ["service", r.services],
      ["product", r.products],
    ] as const) {
      if (new Set(items.map((s) => s.id)).size !== items.length)
        fail(`Duplicate ${name} identifier.`);
    }
    const sources = new Set(r.sources.map((s) => s.id));
    const referenced = [
      r.identitySourceIds,
      r.summarySourceIds,
      r.baseLocation.sourceIds,
      ...[...r.services, ...r.products, ...r.coverage].map((s) => s.sourceIds),
    ];
    if (referenced.flat().some((id) => !sources.has(id)))
      fail("Every claim must reference an included source.");
    const services = new Set(r.services.map((s) => s.id));
    const products = new Set(r.products.map((s) => s.id));
    for (const area of r.coverage) {
      if (!area.serviceIds.length && !area.productIds.length)
        fail("Coverage must identify the offerings it applies to.");
      if (
        area.serviceIds.some((id) => !services.has(id)) ||
        area.productIds.some((id) => !products.has(id))
      )
        fail("Coverage references an unknown offering.");
      if (area.kind === "state" && (!area.stateCode || !area.countryCode))
        fail("State coverage needs a country and state code.");
      if (
        ["city", "metro"].includes(area.kind) &&
        (!area.stateCode || !area.countryCode)
      )
        fail("Local coverage needs a country and state code.");
      if (area.kind === "country" && (!area.countryCode || area.stateCode))
        fail("Country coverage needs a country, not a state.");
    }
  });

function host(raw: string) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
export const enrichmentBatch = z
  .object({
    version: z.literal(1),
    batchId: key,
    inventoryOrigin: z.literal("https://connect.sunhubapp.com"),
    cohort: text(200),
    records: z
      .array(
        z
          .object({
            companyId: z.string().uuid(),
            companyName: text(300),
            website: url,
            expectedProfile: profile,
            profile,
            research: providerResearch,
          })
          .strict(),
      )
      .min(1)
      .max(25),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      new Set(batch.records.map((r) => r.companyId)).size !==
      batch.records.length
    )
      fail("Duplicate company in the batch.");
    for (const r of batch.records) {
      if (r.research.sources.some((s) => host(s.url) !== host(r.website)))
        fail(`${r.companyName}: source is not the matched official domain.`);
      const labels = [
        ...r.research.services.map((s) => s.title),
        ...r.research.products.map((p) => p.title),
      ];
      if (r.profile.services.some((s) => !labels.includes(s)))
        fail("Searchable services must come from sourced offerings.");
      if (
        r.profile.serviceAreas.some(
          (s) => !r.research.coverage.some((c) => c.label === s),
        )
      )
        fail("Profile coverage must come from sourced coverage.");
    }
  });

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
};
const profileOf = (
  c: Record<string, any>,
  p: Record<string, any> | undefined,
) => ({
  description: c.description,
  tagline: c.tagline,
  services: c.services,
  serviceAreas: c.service_areas,
  trades: p?.trades || [],
  projectTypes: p?.project_types || [],
});

export async function importProviderEnrichment(input: unknown, apply = false) {
  const batch = enrichmentBatch.parse(input);
  return tx(async (db) => {
    // Serializes operator imports; the company row lock also coordinates claims/membership inserts.
    await db.query("SELECT pg_advisory_xact_lock(27182027)");
    const plans = [];
    for (const r of batch.records) {
      const hash = createHash("sha256").update(canonical(r)).digest("hex");
      const prior = (
        await db.query(
          "SELECT record_hash FROM provider_enrichment_audit WHERE batch_id=$1 AND company_id=$2",
          [batch.batchId, r.companyId],
        )
      ).rows[0];
      const c = (
        await db.query("SELECT * FROM companies WHERE id=$1 FOR UPDATE", [
          r.companyId,
        ])
      ).rows[0];
      const p = (
        await db.query(
          "SELECT * FROM provider_profiles WHERE company_id=$1 FOR UPDATE",
          [r.companyId],
        )
      ).rows[0];
      const existing = (
        await db.query(
          "SELECT * FROM provider_capabilities WHERE company_id=$1 FOR UPDATE",
          [r.companyId],
        )
      ).rows[0];
      const members = (
        await db.query(
          "SELECT 1 FROM memberships WHERE company_id=$1 LIMIT 1",
          [r.companyId],
        )
      ).rowCount;
      let status = "ready";
      if (prior)
        status =
          prior.record_hash === hash
            ? "unchanged"
            : "blocked: batch ID already used for different data";
      else if (
        !c ||
        c.is_demo ||
        c.name !== r.companyName ||
        host(c.website) !== host(r.website)
      )
        status = "blocked: company identity mismatch";
      else if (c.listing_status !== "unclaimed" || members)
        status = "blocked: company-managed profile";
      else if (canonical(profileOf(c, p)) !== canonical(r.expectedProfile))
        status = "blocked: profile changed since inventory";
      else if (
        existing &&
        new Date(existing.checked_at) >= new Date(r.research.checkedAt)
      )
        status = "blocked: research is not newer";
      plans.push({ r, hash, c, p, existing, status });
    }
    if (apply && plans.some((p) => p.status.startsWith("blocked"))) {
      throw new Error(
        "Nothing applied. " +
          plans
            .filter((p) => p.status.startsWith("blocked"))
            .map((p) => p.r.companyName + ": " + p.status)
            .join("; "),
      );
    }
    for (const plan of plans) {
      if (!apply || plan.status !== "ready") continue;
      const { r, c, p, existing, hash } = plan;
      await db.query(
        `INSERT INTO provider_enrichment_audit(batch_id,company_id,record_hash,before_profile,after_profile,before_capabilities)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [
          batch.batchId,
          r.companyId,
          hash,
          JSON.stringify({ company: c, provider: p || null }),
          JSON.stringify(r.profile),
          existing ? JSON.stringify(existing) : null,
        ],
      );
      await db.query(
        `UPDATE companies SET description=$2,tagline=$3,services=$4,service_areas=$5 WHERE id=$1`,
        [
          r.companyId,
          r.profile.description,
          r.profile.tagline,
          r.profile.services,
          r.profile.serviceAreas,
        ],
      );
      await db.query(
        `INSERT INTO provider_profiles(company_id,trades,project_types) VALUES($1,$2,$3)
        ON CONFLICT(company_id) DO UPDATE SET trades=excluded.trades,project_types=excluded.project_types,updated_at=now()`,
        [r.companyId, r.profile.trades, r.profile.projectTypes],
      );
      await db.query(
        `INSERT INTO provider_capabilities(company_id,batch_id,research,checked_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(company_id) DO UPDATE SET batch_id=excluded.batch_id,research=excluded.research,checked_at=excluded.checked_at,updated_at=now()`,
        [
          r.companyId,
          batch.batchId,
          JSON.stringify(r.research),
          r.research.checkedAt,
        ],
      );
      plan.status = "applied";
    }
    return plans.map(({ r, status }) => ({
      company: r.companyName,
      companyId: r.companyId,
      status,
      services: r.research.services.length,
      products: r.research.products.length,
      sources: r.research.sources.length,
    }));
  });
}
