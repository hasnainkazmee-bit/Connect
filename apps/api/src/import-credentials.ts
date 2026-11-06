import { pool, tx } from "./db.js";
import {
  credentialCatalog,
  credentialCheckedAt,
} from "./credential-catalog.js";
import { credentialInput } from "./credentials.js";
import { directoryCatalog } from "./directory-catalog.js";
import { readFile } from "node:fs/promises";
import { importReviewedCredentials } from "./credential-import.js";

// Explicit operator action; a normal build, migration or startup never imports claims.
const apply = process.argv.includes("--apply");
const fileFlag = process.argv.indexOf("--file");
try {
  if (fileFlag >= 0) {
    const file = process.argv[fileFlag + 1];
    if (!file || file.startsWith("--"))
      throw new Error("Pass a reviewed JSON batch after --file.");
    const result = await importReviewedCredentials(
      JSON.parse(await readFile(file, "utf8")),
      apply,
    );
    console.table(result);
    console.log(
      `${apply ? "Apply" : "Dry run"}: ${result.length} reviewed records; ${result.filter((row) => row.status.startsWith("skipped")).length} identity skips.`,
    );
  } else {
    const result = await tx(async (db) => {
      const result = [];
      for (const item of credentialCatalog) {
        credentialInput.parse({
          category: item.category,
          title: item.title,
          organization: item.organization,
          scope: item.scope,
          scopeDetail: item.scopeDetail,
          description: item.description,
          sourceUrl: item.sourceUrl,
          period: item.period || "",
        });
        const expected = directoryCatalog.find(
          (c) => c.username === item.company,
        );
        if (!expected)
          throw new Error(`Unknown catalog company: ${item.company}`);
        // Match the established identity and official website, not a mutable name alone.
        const { rows } = await db.query(
          "SELECT id,website FROM companies WHERE NOT is_demo AND (username=$1 OR slug=$1 OR id=(SELECT company_id FROM company_username_history WHERE username=$1))",
          [item.company],
        );
        const company = rows.length === 1 ? rows[0] : null;
        const hostname = (raw: string) => {
          try {
            return new URL(raw).hostname.replace(/^www\./, "");
          } catch {
            return "";
          }
        };
        if (
          !company ||
          hostname(company.website) !== hostname(expected.website)
        ) {
          result.push({
            company: item.company,
            credential: item.key,
            status: "skipped: missing or mismatched company",
          });
          continue;
        }
        if (apply)
          await db.query(
            `INSERT INTO company_credentials(company_id,catalog_key,category,title,organization,scope,scope_detail,description,source_url,evidence_basis,period,checked_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(company_id,catalog_key) DO UPDATE SET category=excluded.category,title=excluded.title,organization=excluded.organization,scope=excluded.scope,scope_detail=excluded.scope_detail,description=excluded.description,source_url=excluded.source_url,evidence_basis=excluded.evidence_basis,period=excluded.period,checked_at=excluded.checked_at,updated_at=now()`,
            [
              company.id,
              item.key,
              item.category,
              item.title,
              item.organization,
              item.scope,
              item.scopeDetail,
              item.description,
              item.sourceUrl,
              item.evidenceBasis,
              item.period || "",
              credentialCheckedAt,
            ],
          );
        result.push({
          company: item.company,
          credential: item.key,
          status: apply ? "imported" : "would import",
        });
      }
      return result;
    });
    console.table(result);
    if (!apply)
      console.log("Dry run only. Add --apply to save these sourced records.");
  }
} finally {
  await pool.end();
}
