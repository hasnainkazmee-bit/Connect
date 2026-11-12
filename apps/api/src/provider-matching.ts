import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { tx } from "./db.js";
import type { ProviderResearch } from "./provider-enrichment.js";

export const matchingSnapshotSql = `jsonb_build_object('type',c.type,'website',c.website,'services',c.services,'serviceAreas',c.service_areas,
 'trades',COALESCE(p.trades,'{}'::text[]),'projectTypes',COALESCE(p.project_types,'{}'::text[]))`;

/** Only validated, reviewed research reaches the queryable projection. */
export async function projectProviderResearch(
  db: PoolClient,
  companyId: string,
  batchId: string,
  r: ProviderResearch,
  apply = true,
) {
  const current = (
    await db.query(
      `SELECT ${matchingSnapshotSql} snapshot,c.is_demo,p.updated_at<=e.updated_at AS unchanged,
    e.batch_id,a.after_profile FROM companies c LEFT JOIN provider_profiles p ON p.company_id=c.id
    JOIN provider_capabilities e ON e.company_id=c.id
    JOIN provider_enrichment_audit a ON a.company_id=e.company_id AND a.batch_id=e.batch_id WHERE c.id=$1 FOR UPDATE OF c`,
      [companyId],
    )
  ).rows[0];
  if (
    !current ||
    current.is_demo ||
    !current.unchanged ||
    current.batch_id !== batchId
  )
    throw new Error("Reviewed projection is stale or has no matching company.");
  const observed = current.snapshot;
  const after = current.after_profile;
  if (
    (after.type
      ? ["type", "services", "serviceAreas", "trades", "projectTypes"]
      : ["services", "serviceAreas", "trades", "projectTypes"]
    ).some((k) => JSON.stringify(observed[k]) !== JSON.stringify(after[k])) ||
    r.sources.some(
      (s) =>
        new URL(s.url).hostname.replace(/^www\./, "") !==
        new URL(observed.website).hostname.replace(/^www\./, ""),
    )
  )
    throw new Error(
      "Company facts changed after source review; do not re-project stale research.",
    );
  if (!apply) return;
  await db.query(
    `INSERT INTO provider_matching_profiles(company_id,state,source_batch_id,profile_snapshot,checked_at,valid_until,projected_at)
    VALUES($1,$5,$2,$3,$4,$4::timestamptz+interval '180 days',now())
    ON CONFLICT(company_id) DO UPDATE SET state=$5,source_batch_id=$2,profile_snapshot=$3,
    checked_at=$4,valid_until=$4::timestamptz+interval '180 days',projected_at=now()`,
    [
      companyId,
      batchId,
      JSON.stringify(current.snapshot),
      r.checkedAt,
      r.reviewMethod === "source-check-v1" ? "source_checked" : "reviewed",
    ],
  );
  // The confirmed availability table is independent and never changed here.
  await db.query("DELETE FROM provider_coverage_areas WHERE company_id=$1", [
    companyId,
  ]);
  await db.query("DELETE FROM provider_offerings WHERE company_id=$1", [
    companyId,
  ]);
  await db.query("DELETE FROM provider_evidence WHERE company_id=$1", [
    companyId,
  ]);
  for (const s of r.sources)
    await db.query(
      `INSERT INTO provider_evidence(company_id,id,url,title,evidence,basis,checked_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [companyId, s.id, s.url, s.title, s.evidence, s.basis, r.checkedAt],
    );
  for (const [kind, items] of [
    ["service", r.services],
    ["product", r.products],
  ] as const) {
    for (const item of items) {
      const service = "delivery" in item ? item : undefined;
      const product = "role" in item ? item : undefined;
      const id = `${kind}:${item.id}`;
      await db.query(
        `INSERT INTO provider_offerings(company_id,id,kind,category_id,title,detail,sectors,delivery,product_role,systems,brands,third_party_systems,system_types)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          companyId,
          id,
          kind,
          item.category,
          item.title,
          item.detail,
          service?.sectors || [],
          service?.delivery || null,
          product?.role || null,
          service?.systems || [],
          product?.brands || [],
          service?.thirdPartySystems || "unknown",
          (service?.systems || []).flatMap(
            (s) =>
              (
                ({
                  rooftop: ["rooftop"],
                  "ground mount": ["ground-mount"],
                  carport: ["carport"],
                  pergola: ["pergola"],
                  "fixed tilt": ["fixed-tilt"],
                  "tracker foundations": ["tracker-foundations"],
                }) as Record<string, string[]>
              )[s.toLowerCase()] || [],
          ),
        ],
      );
      for (const source of item.sourceIds)
        await db.query(
          `INSERT INTO provider_offering_evidence(company_id,offering_id,evidence_id) VALUES($1,$2,$3)`,
          [companyId, id, source],
        );
    }
  }
  for (const [i, a] of r.coverage.entries()) {
    const id = `area-${i + 1}`;
    // City scope is deliberately exact. Regions and metros are never expanded to a state.
    const city =
      a.kind === "city"
        ? a.label.split(",")[0].trim().toLocaleLowerCase("en-US")
        : null;
    await db.query(
      `INSERT INTO provider_coverage_areas(company_id,id,label,kind,country_code,state_code,city_key,included_state_codes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        companyId,
        id,
        a.label,
        a.kind,
        a.countryCode,
        a.stateCode,
        city,
        a.stateCodes || [],
      ],
    );
    for (const offering of [
      ...a.serviceIds.map((s) => `service:${s}`),
      ...a.productIds.map((s) => `product:${s}`),
    ])
      await db.query(
        `INSERT INTO provider_coverage_offerings(company_id,area_id,offering_id) VALUES($1,$2,$3)`,
        [companyId, id, offering],
      );
    for (const source of a.sourceIds)
      await db.query(
        `INSERT INTO provider_coverage_evidence(company_id,area_id,evidence_id) VALUES($1,$2,$3)`,
        [companyId, id, source],
      );
  }
}

const short = (max: number) => z.string().max(max);
const publicUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Use a public HTTP(S) URL without credentials.");
const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (s) => new Date(s).getTime() <= Date.now() + 300000,
    "Future source date",
  );
const status = z.enum([
  "ready_for_review",
  "no_offerings_found",
  "identity_review",
  "robots_or_access_blocked",
  "unreachable",
  "no_website",
  "excluded_demo",
]);
export const discoveryRecord = z
  .object({
    companyId: z.string().uuid(),
    companyName: short(300),
    website: short(2000),
    checkedAt: timestamp,
    identityStatus: z.enum([
      "unknown",
      "name_on_official_domain",
      "parked_or_inactive",
      "needs_review",
    ]),
    status,
    pages: z
      .array(
        z
          .object({
            url: short(2000),
            status: z.enum([
              "ok",
              "robots_or_access_blocked",
              "identity_redirect_review",
              "not_html",
              "fetch_failed",
            ]),
            finalUrl: publicUrl.optional(),
            checkedAt: timestamp.optional(),
            contentHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            title: short(200).optional(),
            cacheKey: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            error: short(240).optional(),
          })
          .strict(),
      )
      .max(5),
    candidates: z
      .array(
        z
          .object({
            kind: z.enum(["service", "product"]),
            categoryId: short(80),
            sourceUrl: publicUrl,
            evidence: short(650),
            sectorHints: z
              .array(
                z.enum([
                  "residential",
                  "commercial",
                  "industrial",
                  "agricultural",
                  "municipal",
                  "nonprofit",
                  "utility",
                ]),
              )
              .max(7),
            reviewStatus: z.literal("unreviewed"),
          })
          .strict(),
      )
      .max(50),
    coverageCandidates: z
      .array(
        z
          .object({
            sourceUrl: publicUrl,
            evidence: short(450),
            offeringScope: z.literal("needs_review"),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const host = (u: string) => {
      try {
        return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        return "";
      }
    };
    const ok = new Set(
      r.pages.filter((p) => p.status === "ok").map((p) => p.url),
    );
    for (const p of r.pages.filter((p) => p.status === "ok")) {
      if (
        !publicUrl.safeParse(p.url).success ||
        !publicUrl.safeParse(r.website).success ||
        !p.checkedAt ||
        !p.contentHash ||
        !r.website ||
        host(p.url) !== host(r.website)
      )
        fail(
          "Read evidence must include a current check, hash and official domain.",
        );
    }
    for (const c of [...r.candidates, ...r.coverageCandidates])
      if (!ok.has(c.sourceUrl))
        fail("Candidate evidence must reference a page read in this run.");
    if (
      r.status === "ready_for_review" &&
      (r.identityStatus !== "name_on_official_domain" || !r.candidates.length)
    )
      fail("Ready-for-review needs identity evidence and candidates.");
    if (
      ["excluded_demo", "no_website"].includes(r.status) &&
      (r.pages.length || r.candidates.length || r.coverageCandidates.length)
    )
      fail("Skipped profiles cannot contain scraped claims.");
  });

const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function importProviderDiscovery(
  runId: string,
  inventoryInput: unknown,
  input: unknown[],
  apply = false,
) {
  if (!/^[a-z][a-z0-9-]{5,100}$/.test(runId))
    throw new Error("Use a descriptive immutable research run ID.");
  const inventory = z
    .object({
      version: z.literal(1),
      origin: z.literal("https://connect.sunhubapp.com"),
      generatedAt: timestamp,
      companies: z
        .array(
          z
            .object({
              id: z.string().uuid(),
              name: short(300),
              website: z.string(),
              is_demo: z.boolean(),
            })
            .passthrough(),
        )
        .min(1)
        .max(10000),
    })
    .parse(inventoryInput);
  const records = z
    .array(discoveryRecord)
    .max(10000)
    .parse(input)
    .sort((a, b) => a.companyId.localeCompare(b.companyId));
  const ids = new Set(inventory.companies.map((c) => c.id));
  if (
    ids.size !== inventory.companies.length ||
    records.length !== ids.size ||
    new Set(records.map((r) => r.companyId)).size !== ids.size ||
    records.some((r) => !ids.has(r.companyId))
  )
    throw new Error(
      "The research run must account for every inventory company exactly once.",
    );
  const summary = {
    companies: records.length,
    realCompanies: inventory.companies.filter((c) => !c.is_demo).length,
    pagesRead: records.reduce(
      (n, r) => n + r.pages.filter((p) => p.status === "ok").length,
      0,
    ),
    candidates: records.reduce((n, r) => n + r.candidates.length, 0),
    statuses: Object.fromEntries(
      status.options.map((s) => [
        s,
        records.filter((r) => r.status === s).length,
      ]),
    ),
  };
  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(27182027)");
    const old = (
      await db.query("SELECT * FROM provider_research_runs WHERE id=$1", [
        runId,
      ])
    ).rows[0];
    const inventoryHash = digest(inventory),
      resultHash = digest(records);
    if (old) {
      if (
        old.inventory_hash !== inventoryHash ||
        old.result_hash !== resultHash
      )
        throw new Error("Research run ID already used for different input.");
      return { status: "unchanged", ...summary };
    }
    const companies = new Map(
      (
        await db.query(
          "SELECT id,name,website,is_demo FROM companies WHERE id=ANY($1::uuid[]) FOR UPDATE",
          [[...ids]],
        )
      ).rows.map((c) => [c.id, c]),
    );
    const taxonomy = new Set(
      (await db.query("SELECT kind,id FROM provider_taxonomy")).rows.map(
        (t) => `${t.kind}:${t.id}`,
      ),
    );
    for (const r of records) {
      const c = companies.get(r.companyId),
        expected = inventory.companies.find((c) => c.id === r.companyId)!;
      if (
        !c ||
        c.name !== r.companyName ||
        c.website !== r.website ||
        c.name !== expected.name ||
        c.website !== expected.website ||
        c.is_demo !== expected.is_demo
      )
        throw new Error(
          `${r.companyName}: identity changed since inventory; refresh this record.`,
        );
      if (c.is_demo !== (r.status === "excluded_demo"))
        throw new Error("Demo profiles must be excluded from real research.");
      if (r.candidates.some((f) => !taxonomy.has(`${f.kind}:${f.categoryId}`)))
        throw new Error("Candidate uses an unknown taxonomy key.");
    }
    if (apply) {
      await db.query(
        "INSERT INTO provider_research_runs(id,inventory_hash,result_hash,generated_at,summary) VALUES($1,$2,$3,$4,$5)",
        [
          runId,
          inventoryHash,
          resultHash,
          inventory.generatedAt,
          JSON.stringify(summary),
        ],
      );
      for (const r of records)
        await db.query(
          `INSERT INTO provider_research_results(run_id,company_id,status,identity_status,checked_at,report) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            runId,
            r.companyId,
            r.status,
            r.identityStatus,
            r.checkedAt,
            JSON.stringify(r),
          ],
        );
    }
    return { status: apply ? "applied" : "ready", ...summary };
  });
}
