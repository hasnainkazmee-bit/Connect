import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool, HttpError } from "./db.js";

const cursorSchema = z.string().uuid();
const limitSchema = z.coerce.number().int().min(1).max(200).default(200);

function authorized(header: string | undefined) {
  const secret = process.env.CONNECT_SUNHUB_SYNC_TOKEN || "";
  if (secret.length < 32) return false;
  const supplied = /^Bearer (\S+)$/.exec(header || "")?.[1] || "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return (
    supplied.length >= 32 && timingSafeEqual(digest(supplied), digest(secret))
  );
}

/** A read-only, server-to-server snapshot. Contact lists never live in Connect. */
export function sunhubIntegrationRoutes() {
  const router = Router();
  router.get("/integrations/sunhub/companies", async (req, res) => {
    if (
      !process.env.CONNECT_SUNHUB_SYNC_TOKEN ||
      process.env.CONNECT_SUNHUB_SYNC_TOKEN.length < 32
    )
      throw new HttpError(404, "API endpoint not found.");
    if (!authorized(req.headers.authorization))
      throw new HttpError(401, "Integration authentication required.");

    const after = req.query.after ? cursorSchema.parse(req.query.after) : null;
    const limit = limitSchema.parse(req.query.limit);
    const { rows } = await pool.query(
      `SELECT c.id AS "companyId",c.username,c.name,c.name_key AS "nameKey",
        c.website,c.listing_status AS "listingStatus",
        COALESCE(d.domains,'{}'::text[]) AS domains,
        CASE WHEN cl.status='approved' THEN 'claimed'
             WHEN c.listing_status='managed' THEN 'joined'
             WHEN cl.status='pending' THEN 'pending'
             ELSE 'unclaimed' END AS "claimStatus",
        CASE WHEN cl.status='pending' THEN cl.created_at END AS "claimRequestedAt",
        CASE WHEN cl.status='approved' THEN COALESCE(cl.reviewed_at,c.ownership_verified_at) END AS "claimedAt",
        CASE WHEN cl.status IN ('pending','approved') THEN cl.email END AS "claimantEmail"
       FROM companies c
       LEFT JOIN LATERAL (
         SELECT array_agg(domain ORDER BY domain) AS domains
         FROM company_claim_domains WHERE company_id=c.id
       ) d ON true
       LEFT JOIN LATERAL (
         SELECT cl.status,cl.created_at,cl.reviewed_at,u.email
         FROM company_claims cl JOIN users u ON u.id=cl.user_id
         WHERE cl.company_id=c.id AND cl.status IN ('pending','approved')
         ORDER BY (cl.status='approved') DESC,cl.created_at DESC LIMIT 1
       ) cl ON true
       WHERE NOT c.is_demo AND ($1::uuid IS NULL OR c.id>$1::uuid)
       ORDER BY c.id LIMIT $2`,
      [after, limit],
    );
    const companies = rows.map((row) => ({
      ...row,
      profileUrl: `${process.env.APP_ORIGIN || "http://localhost:5173"}/${row.username || row.companyId}`,
      claimUrl: `${process.env.APP_ORIGIN || "http://localhost:5173"}/claim/${row.username || row.companyId}`,
    }));
    res.json({
      companies,
      nextCursor: rows.length === limit ? rows.at(-1).companyId : null,
    });
  });
  return router;
}
