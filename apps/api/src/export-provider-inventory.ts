import { pool } from "./db.js";
try {
  const companies = (
    await pool.query(`SELECT c.id,c.name,c.username,c.slug,c.type,c.website,c.location,c.listing_status,c.is_demo,
  EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=c.id) AS managed,e.checked_at AS researched_at
  FROM companies c LEFT JOIN provider_capabilities e ON e.company_id=c.id ORDER BY c.id`)
  ).rows;
  console.log(
    JSON.stringify({
      version: 1,
      origin: "https://connect.sunhubapp.com",
      generatedAt: new Date().toISOString(),
      companies,
    }),
  );
} finally {
  await pool.end();
}
