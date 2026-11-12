import { pool, tx } from "./db.js";
import { providerResearch } from "./provider-enrichment.js";
import { projectProviderResearch } from "./provider-matching.js";
try {
  const apply = process.argv.includes("--apply");
  const result = await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(27182027)");
    const rows = (
      await db.query(`SELECT e.* FROM provider_capabilities e JOIN companies c ON c.id=e.company_id
    JOIN provider_profiles p ON p.company_id=c.id WHERE NOT c.is_demo AND p.updated_at<=e.updated_at
    ORDER BY e.company_id FOR UPDATE OF c,e,p`)
    ).rows;
    for (const r of rows) {
      const parsed = providerResearch.parse(r.research);
      // Do not replace a projection after profile edits. A new reviewed import must acknowledge them.
      const previous = (
        await db.query(
          "SELECT source_batch_id FROM provider_matching_profiles WHERE company_id=$1 AND state='reviewed'",
          [r.company_id],
        )
      ).rows[0];
      if (previous?.source_batch_id === r.batch_id) continue;
      await projectProviderResearch(
        db,
        r.company_id,
        r.batch_id,
        parsed,
        apply,
      );
    }
    return {
      status: apply ? "applied" : "ready",
      reviewedProfiles: rows.length,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
