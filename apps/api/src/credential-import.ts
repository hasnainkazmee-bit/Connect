import { z } from "zod";
import { tx } from "./db.js";
import { credentialInput } from "./credentials.js";

// Operator-only batch format. A discovery crawl is not valid import input.
export const reviewedCredential = credentialInput
  .extend({
    companyId: z.string().uuid(),
    companyName: z.string().trim().min(1).max(300),
    website: z.string().url(),
    key: z.string().regex(/^[a-z0-9][a-z0-9:-]{1,100}$/),
    evidenceBasis: z.enum(["issuer", "company", "directory"]),
    checkedAt: z.iso.datetime({ offset: true }),
    reviewMethod: z.enum([
      "manual",
      "issuer_directory_domain_match",
      "directory_profile_identity_match",
      "first_party_explicit_claim",
    ]),
    evidenceNote: z.string().trim().min(10).max(600),
  })
  .strict()
  .superRefine((record, context) => {
    if (new Date(record.checkedAt).getTime() > Date.now() + 300000)
      context.addIssue({
        code: "custom",
        path: ["checkedAt"],
        message: "Source check cannot be in the future.",
      });
    if (
      record.evidenceBasis === "company" &&
      hostname(record.sourceUrl) !== hostname(record.website)
    )
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message:
          "Company-reported evidence must come from the matched official website.",
      });
    if (
      record.reviewMethod === "first_party_explicit_claim" &&
      record.evidenceBasis !== "company"
    )
      context.addIssue({
        code: "custom",
        path: ["evidenceBasis"],
        message:
          "A first-party claim cannot be promoted to issuer or directory evidence.",
      });
  });
export const reviewedBatch = z
  .object({
    version: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    inventoryOrigin: z.string().url(),
    records: z.array(reviewedCredential).max(50000),
  })
  .strict()
  .superRefine((batch, context) => {
    const seen = new Set<string>();
    for (const [index, record] of batch.records.entries()) {
      const key = `${record.companyId}:${record.key}`;
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          path: ["records", index, "key"],
          message: "Duplicate company credential key.",
        });
      seen.add(key);
    }
  });
export function hostname(raw: string) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function importReviewedCredentials(
  input: unknown,
  apply: boolean,
) {
  const batch = reviewedBatch.parse(input);
  return tx(async (db) => {
    const results = [];
    for (const record of batch.records) {
      const company = (
        await db.query(
          "SELECT id,website FROM companies WHERE id=$1 AND NOT is_demo FOR SHARE",
          [record.companyId],
        )
      ).rows[0];
      if (
        !company ||
        !hostname(record.website) ||
        hostname(company.website) !== hostname(record.website)
      ) {
        results.push({
          company: record.companyName,
          credential: record.key,
          status: "skipped: missing or mismatched company",
        });
        continue;
      }
      if (apply)
        await db.query(
          `INSERT INTO company_credentials(company_id,catalog_key,category,title,organization,scope,scope_detail,description,source_url,evidence_basis,period,valid_until,checked_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(company_id,catalog_key) DO UPDATE SET category=excluded.category,title=excluded.title,organization=excluded.organization,scope=excluded.scope,scope_detail=excluded.scope_detail,description=excluded.description,source_url=excluded.source_url,evidence_basis=excluded.evidence_basis,period=excluded.period,valid_until=excluded.valid_until,checked_at=excluded.checked_at,updated_at=now()
         WHERE company_credentials.checked_at IS NULL OR company_credentials.checked_at<=excluded.checked_at`,
          [
            company.id,
            record.key,
            record.category,
            record.title,
            record.organization,
            record.scope,
            record.scopeDetail,
            record.description,
            record.sourceUrl,
            record.evidenceBasis,
            record.period,
            record.validUntil,
            record.checkedAt,
          ],
        );
      results.push({
        company: record.companyName,
        credential: record.key,
        status: apply ? "applied (newer evidence preserved)" : "would import",
      });
    }
    return results;
  });
}
