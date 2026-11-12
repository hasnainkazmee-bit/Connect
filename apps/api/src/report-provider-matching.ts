import { pool } from "./db.js";
try {
  const summary = (
    await pool.query(`SELECT count(*) FILTER(WHERE NOT c.is_demo)::int AS real_companies,
  count(*) FILTER(WHERE c.is_demo)::int AS demo_companies,
  count(*) FILTER(WHERE NOT c.is_demo AND m.state='reviewed')::int AS reviewed_profiles,
  count(*) FILTER(WHERE NOT c.is_demo AND EXISTS(SELECT 1 FROM provider_current_offerings o WHERE o.company_id=c.id))::int AS active_matching_profiles
  FROM companies c JOIN provider_matching_profiles m ON m.company_id=c.id`)
  ).rows[0];
  const latest =
    (
      await pool.query(
        "SELECT id,generated_at,imported_at,summary FROM provider_research_runs ORDER BY imported_at DESC LIMIT 1",
      )
    ).rows[0] || null;
  console.log(JSON.stringify({ summary, latestResearchRun: latest }, null, 2));
} finally {
  await pool.end();
}
