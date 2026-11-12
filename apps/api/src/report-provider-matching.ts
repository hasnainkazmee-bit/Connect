import { pool } from "./db.js";
try {
  const summary = (
    await pool.query(`SELECT count(*) FILTER(WHERE NOT c.is_demo)::int AS real_companies,
  count(*) FILTER(WHERE c.is_demo)::int AS demo_companies,
  count(*) FILTER(WHERE NOT c.is_demo AND m.state='reviewed')::int AS reviewed_profiles,
  count(*) FILTER(WHERE NOT c.is_demo AND m.state='source_checked')::int AS source_checked_profiles,
  count(*) FILTER(WHERE NOT c.is_demo AND EXISTS(SELECT 1 FROM provider_current_offerings o WHERE o.company_id=c.id))::int AS active_matching_profiles
  FROM companies c JOIN provider_matching_profiles m ON m.company_id=c.id`)
  ).rows[0];
  const candidates = (
    await pool.query(
      `SELECT match_state,count(DISTINCT company_id)::int AS companies,count(*)::int AS offerings FROM provider_current_candidates GROUP BY match_state ORDER BY match_state`,
    )
  ).rows;
  const geography = (
    await pool.query(
      `SELECT count(DISTINCT o.company_id)::int AS companies_with_scoped_coverage FROM provider_current_candidates o JOIN provider_coverage_offerings co ON co.company_id=o.company_id AND co.offering_id=o.id`,
    )
  ).rows[0];
  const gaps = (
    await pool.query(`SELECT
      count(DISTINCT o.company_id) FILTER(WHERE NOT EXISTS(SELECT 1 FROM provider_coverage_offerings co WHERE co.company_id=o.company_id))::int AS companies_without_scoped_coverage,
      count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM provider_coverage_offerings co WHERE co.company_id=o.company_id AND co.offering_id=o.id))::int AS offerings_without_scoped_coverage,
      count(DISTINCT o.company_id) FILTER(WHERE o.kind='service' AND (p.work_settings_confirmed_at>now()-interval '30 days' OR EXISTS(SELECT 1 FROM provider_service_availability av WHERE av.company_id=o.company_id AND av.category_id=o.category_id AND av.valid_until>now())))::int AS companies_with_recent_availability
      FROM provider_current_candidates o LEFT JOIN provider_profiles p ON p.company_id=o.company_id`)
  ).rows[0];
  const latest =
    (
      await pool.query(
        "SELECT id,generated_at,imported_at,summary FROM provider_research_runs ORDER BY imported_at DESC LIMIT 1",
      )
    ).rows[0] || null;
  console.log(
    JSON.stringify(
      { summary, candidates, geography, gaps, latestResearchRun: latest },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
