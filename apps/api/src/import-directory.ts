import { access } from "node:fs/promises";
import path from "node:path";
import { pool, tx, root } from "./db.js";
import { claimUsername } from "./profiles.js";
import { normalizedName, preventDuplicateCompany } from "./directory.js";
import { directoryCatalog } from "./directory-catalog.js";

// Explicit, idempotent import. Never runs at application startup and never creates users.
try {
  for (const item of directoryCatalog)
    await access(
      path.join(root, "apps/web/dist/assets/companies", item.username + ".png"),
    );
  const results = await tx(async (db) => {
    const results: { company: string; status: string }[] = [];
    for (const item of directoryCatalog) {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,8))", [
        normalizedName(item.name),
      ]);
      const existing = (
        await db.query(
          "SELECT id FROM companies WHERE username=$1 OR slug=$1 OR name_key=$2",
          [item.username, normalizedName(item.name)],
        )
      ).rows[0];
      if (existing) {
        results.push({
          company: item.name,
          status: "existing profile preserved",
        });
        continue;
      }
      await preventDuplicateCompany(db, item.name);

      const c = (
        await db.query(
          "INSERT INTO companies(slug,name,type,location,service_areas,services,tagline,description,website,logo_url,cover_url,logo_style,listing_status,audiences,phone,source_url,source_checked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'','building','unclaimed',$11,$12,$13,'2026-11-02T00:00:00Z') RETURNING id",
          [
            item.username,
            item.name,
            item.type,
            item.location,
            item.areas,
            item.services,
            item.tagline,
            item.description,
            item.website,
            `/assets/companies/${item.username}.png`,
            item.audiences,
            item.phone,
            item.source,
          ],
        )
      ).rows[0];
      await claimUsername(db, c.id, item.username);
      for (const domain of item.domains)
        await db.query(
          "INSERT INTO company_claim_domains(company_id,domain,source_url) VALUES($1,$2,$3)",
          [c.id, domain, item.website],
        );
      results.push({ company: item.name, status: "unclaimed listing added" });
    }
    return results;
  });
  console.table(results);
} finally {
  await pool.end();
}
