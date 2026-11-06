import { pool, root, tx } from "./db.js";
import {
  loadMasterCompanySnapshot,
  planMasterCompanyImport,
  type ExistingCompany,
} from "./master-company-import.js";

const apply = process.argv.includes("--apply");
if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--apply"))
  throw new Error(
    "Only --apply is supported. Without it, the import is a dry run.",
  );

try {
  const records = await loadMasterCompanySnapshot(root);
  const result = await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(20261104)");
    const existing = (
      await db.query<ExistingCompany>(
        "SELECT id,name_key,slug,username,website FROM companies WHERE NOT is_demo",
      )
    ).rows;
    const claimDomains = (
      await db.query<{ domain: string }>(
        "SELECT DISTINCT domain FROM company_claim_domains",
      )
    ).rows.map((r) => r.domain);
    const usernameHistory = (
      await db.query<{ username: string }>(
        "SELECT username FROM company_username_history",
      )
    ).rows.map((r) => r.username);
    const plan = planMasterCompanyImport(
      records,
      existing,
      claimDomains,
      usernameHistory,
    );
    if (apply && plan.additions.length) {
      const payload = plan.additions.map((c) => ({
        slug: c.username,
        username: c.username,
        name: c.name,
        type: c.type,
        location: c.location,
        service_areas: c.serviceAreas,
        services: c.services,
        tagline: c.tagline,
        description: c.description,
        website: c.website,
        logo_url: c.logoUrl,
        audiences: c.audiences,
        phone: c.phone,
        employee_count: c.employeeCount,
        established: c.established,
        source_url: c.website,
        source_checked_at: c.sourceCheckedAt + "T00:00:00Z",
        domain: c.domain,
      }));
      const inserted = await db.query<{ id: string; username: string }>(
        `INSERT INTO companies (
          slug,username,name,type,location,service_areas,services,tagline,description,
          website,logo_url,cover_url,logo_style,listing_status,audiences,phone,
          employee_count,established,source_url,source_checked_at
        )
        SELECT slug,username,name,type,location,service_areas,services,tagline,description,
          website,logo_url,'','building','unclaimed',audiences,phone,
          employee_count,established,source_url,source_checked_at
        FROM jsonb_to_recordset($1::jsonb) AS r(
          slug text,username text,name text,type text,location text,service_areas text[],
          services text[],tagline text,description text,website text,logo_url text,
          audiences text[],phone text,employee_count text,established integer,
          source_url text,source_checked_at timestamptz,domain text
        )
        RETURNING id,username`,
        [JSON.stringify(payload)],
      );
      if (inserted.rowCount !== plan.additions.length)
        throw new Error("Import count mismatch; transaction will roll back.");
      await db.query(
        `INSERT INTO company_username_history(username,company_id)
         SELECT c.username,c.id FROM companies c
         JOIN jsonb_to_recordset($1::jsonb) AS r(username text)
         ON c.username=r.username
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(payload)],
      );
      await db.query(
        `INSERT INTO company_claim_domains(company_id,domain,source_url)
         SELECT c.id,r.domain,c.website FROM companies c
         JOIN jsonb_to_recordset($1::jsonb) AS r(username text,domain text)
         ON c.username=r.username
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(payload)],
      );
    }
    return {
      mode: apply ? "applied" : "dry-run",
      snapshot: records.length,
      existingProfilesPreserved:
        plan.skipped.existingName + plan.skipped.existingDomain,
      existingByName: plan.skipped.existingName,
      existingByDomain: plan.skipped.existingDomain,
      added: plan.additions.length,
      byType: Object.fromEntries(
        [...new Set(plan.additions.map((c) => c.type))]
          .sort()
          .map((type) => [
            type,
            plan.additions.filter((c) => c.type === type).length,
          ]),
      ),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
