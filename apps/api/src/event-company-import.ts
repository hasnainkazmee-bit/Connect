import { createHash } from "node:crypto";
import { z } from "zod";
import { tx } from "./db.js";
import {
  masterCompanySchema,
  planMasterCompanyImport,
  type ExistingCompany,
} from "./master-company-import.js";

const https = z.url().refine((raw) => {
  const u = new URL(raw);
  return u.protocol === "https:" && !u.username && !u.password && !u.port;
}, "Use an HTTPS source without credentials or a port.");
const domain = z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const common = {
  domain,
  participation: z.enum(["attendee", "exhibitor", "sponsor", "speaker"]),
  sourceReference: text(2, 600),
  identityNote: text(10, 1200),
};
export const eventCompanyBatch = z
  .strictObject({
    version: z.literal(1),
    batchId: text(5, 120),
    checkedAt: z.iso.datetime({ offset: true }),
    event: z.strictObject({
      key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
      name: text(2, 120),
      year: z.number().int().min(2000).max(2100),
      website: https,
      logoPath: z.string().regex(/^\/brand\/events\/[a-z0-9.-]+$/),
    }),
    sourceUrl: https,
    records: z
      .array(
        z.discriminatedUnion("action", [
          z.strictObject({
            ...common,
            action: z.literal("existing"),
            companyId: z.uuid(),
            expectedName: text(1, 200),
          }),
          z.strictObject({
            ...common,
            action: z.literal("create"),
            profile: masterCompanySchema,
            trades: z.array(text(2, 100)).max(12),
            projectTypes: z.array(text(2, 100)).max(12),
            evidence: z
              .array(z.strictObject({ url: https, note: text(10, 1500) }))
              .min(1)
              .max(20),
          }),
        ]),
      )
      .min(1)
      .max(100),
  })
  .superRefine((b, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (Date.parse(b.checkedAt) > Date.now() + 300000)
      fail("Source check cannot be in the future.");
    if (Date.parse(b.checkedAt) < Date.now() - 90 * 86400000)
      fail("Refresh evidence older than 90 days.");
    if (new Set(b.records.map((r) => r.domain)).size !== b.records.length)
      fail("Duplicate company domains.");
    if (
      new Set(
        b.records
          .filter((r) => r.action === "existing")
          .map((r) => r.companyId),
      ).size !== b.records.filter((r) => r.action === "existing").length
    )
      fail("Duplicate company IDs.");
    for (const r of b.records)
      if (r.action === "create") {
        if (
          host(r.profile.website) !== r.domain ||
          r.profile.domain !== r.domain
        )
          fail("Profile domain must match the reviewed company identity.");
        if (r.profile.description.length < 180 || r.profile.services.length < 1)
          fail(
            "New profiles need a substantive overview and sourced offerings.",
          );
        if (r.evidence.some((s) => host(s.url) !== r.domain))
          fail(
            "Profile facts must have first-party evidence on the reviewed domain.",
          );
        if (r.profile.serviceAreas.length)
          fail(
            "Use the scoped provider enrichment importer for service coverage; never infer it from an office address.",
          );
      }
  });
function host(raw: string) {
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
}

export async function importEventCompanies(input: unknown, apply = false) {
  const batch = eventCompanyBatch.parse(input);
  const hash = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(20261104)");
    const prior = (
      await db.query(
        "SELECT input_hash,summary FROM company_event_imports WHERE batch_id=$1",
        [batch.batchId],
      )
    ).rows[0];
    if (prior) {
      if (prior.input_hash !== hash)
        throw new Error("Batch ID already applied with different content.");
      return { mode: "already-applied", ...prior.summary };
    }
    const oldEvent = (
      await db.query("SELECT * FROM industry_events WHERE key=$1", [
        batch.event.key,
      ])
    ).rows[0];
    if (
      oldEvent &&
      (oldEvent.name !== batch.event.name ||
        oldEvent.year !== batch.event.year ||
        oldEvent.website !== batch.event.website ||
        oldEvent.logo_path !== batch.event.logoPath)
    )
      throw new Error(
        "Event identity changed; review the existing event first.",
      );
    const existing = (
      await db.query<ExistingCompany & { name: string; is_demo: boolean }>(
        "SELECT id,name,name_key,slug,username,website,is_demo FROM companies FOR UPDATE",
      )
    ).rows;
    const domains = (
      await db.query<{ domain: string }>(
        "SELECT DISTINCT domain FROM company_claim_domains",
      )
    ).rows.map((r) => r.domain);
    const history = (
      await db.query<{ username: string }>(
        "SELECT username FROM company_username_history",
      )
    ).rows.map((r) => r.username);
    const newRecords = batch.records.filter((r) => r.action === "create");
    const plan = planMasterCompanyImport(
      newRecords.map((r) => r.profile),
      existing,
      domains,
      history,
    );
    if (plan.additions.length !== newRecords.length)
      throw new Error(
        "A proposed new company already exists by name/domain; reconcile it before importing.",
      );
    for (const r of batch.records)
      if (r.action === "existing") {
        const c = existing.find((c) => c.id === r.companyId);
        if (
          !c ||
          c.is_demo ||
          !c.website ||
          host(c.website) !== r.domain ||
          c.name !== r.expectedName
        )
          throw new Error(
            "Company identity changed or is missing: " + r.expectedName,
          );
      }
    const summary = {
      batchId: batch.batchId,
      event: batch.event.key,
      created: plan.additions.length,
      existing: batch.records.length - plan.additions.length,
      participations: batch.records.length,
    };
    if (!apply) return { mode: "dry-run", ...summary };
    await db.query(
      "INSERT INTO industry_events(key,name,year,website,logo_path) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        batch.event.key,
        batch.event.name,
        batch.event.year,
        batch.event.website,
        batch.event.logoPath,
      ],
    );
    const results: { companyId: string; name: string; action: string }[] = [];
    for (const r of batch.records) {
      let id: string;
      if (r.action === "create") {
        const p = plan.additions.find((p) => p.domain === r.domain)!;
        const inserted = await db.query<{ id: string }>(
          `INSERT INTO companies(slug,username,name,type,location,service_areas,services,tagline,description,website,logo_url,cover_url,logo_style,listing_status,audiences,phone,employee_count,established,source_url,source_checked_at)
          VALUES($1,$1,$2,$3,$4,'{}',$5,$6,$7,$8,$9,'','building','unclaimed',$10,$11,$12,$13,$8,$14) RETURNING id`,
          [
            p.username,
            p.name,
            p.type,
            p.location,
            p.services,
            p.tagline,
            p.description,
            p.website,
            p.logoUrl,
            p.audiences,
            p.phone,
            p.employeeCount,
            p.established,
            batch.checkedAt,
          ],
        );
        id = inserted.rows[0].id;
        await db.query(
          "INSERT INTO company_username_history(username,company_id) VALUES($1,$2)",
          [p.username, id],
        );
        await db.query(
          "INSERT INTO company_claim_domains(company_id,domain,source_url) VALUES($1,$2,$3)",
          [id, p.domain, p.website],
        );
        await db.query(
          "INSERT INTO provider_profiles(company_id,trades,project_types) VALUES($1,$2,$3) ON CONFLICT(company_id) DO UPDATE SET trades=excluded.trades,project_types=excluded.project_types",
          [id, r.trades, r.projectTypes],
        );
        await db.query(
          "INSERT INTO company_event_profile_sources(company_id,batch_id,evidence) VALUES($1,$2,$3)",
          [id, batch.batchId, JSON.stringify(r.evidence)],
        );
      } else id = r.companyId;
      await db.query(
        `INSERT INTO company_event_participations(company_id,event_key,participation,source_url,source_reference,identity_note,checked_at,batch_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(company_id,event_key) DO NOTHING`,
        [
          id,
          batch.event.key,
          r.participation,
          batch.sourceUrl,
          r.sourceReference,
          r.identityNote,
          batch.checkedAt,
          batch.batchId,
        ],
      );
      results.push({
        companyId: id,
        name: r.action === "create" ? r.profile.name : r.expectedName,
        action: r.action,
      });
    }
    await db.query(
      "INSERT INTO company_event_imports(batch_id,input_hash,summary) VALUES($1,$2,$3)",
      [batch.batchId, hash, JSON.stringify({ ...summary, companies: results })],
    );
    return { mode: "applied", ...summary, companies: results };
  });
}
