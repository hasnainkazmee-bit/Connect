import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, tx, HttpError } from "./db.js";
import { requireAuth } from "./auth.js";

const states: Record<string, string> = {
  al: "Alabama",
  ak: "Alaska",
  az: "Arizona",
  ar: "Arkansas",
  ca: "California",
  co: "Colorado",
  ct: "Connecticut",
  de: "Delaware",
  fl: "Florida",
  ga: "Georgia",
  hi: "Hawaii",
  id: "Idaho",
  il: "Illinois",
  in: "Indiana",
  ia: "Iowa",
  ks: "Kansas",
  ky: "Kentucky",
  la: "Louisiana",
  me: "Maine",
  md: "Maryland",
  ma: "Massachusetts",
  mi: "Michigan",
  mn: "Minnesota",
  ms: "Mississippi",
  mo: "Missouri",
  mt: "Montana",
  ne: "Nebraska",
  nv: "Nevada",
  nh: "New Hampshire",
  nj: "New Jersey",
  nm: "New Mexico",
  ny: "New York",
  nc: "North Carolina",
  nd: "North Dakota",
  oh: "Ohio",
  ok: "Oklahoma",
  or: "Oregon",
  pa: "Pennsylvania",
  ri: "Rhode Island",
  sc: "South Carolina",
  sd: "South Dakota",
  tn: "Tennessee",
  tx: "Texas",
  ut: "Utah",
  vt: "Vermont",
  va: "Virginia",
  wa: "Washington",
  wv: "West Virginia",
  wi: "Wisconsin",
  wy: "Wyoming",
  dc: "District of Columbia",
};
export const directoryPlaces = [
  { slug: "austin-tx", name: "Austin, TX", region: "Texas" },
  { slug: "denver-co", name: "Denver, CO", region: "Colorado" },
  { slug: "boulder-co", name: "Boulder, CO", region: "Colorado" },
  { slug: "minneapolis-mn", name: "Minneapolis, MN", region: "Minnesota" },
  { slug: "portland-me", name: "Portland, ME", region: "Maine" },
  { slug: "baltimore-md", name: "Baltimore, MD", region: "Maryland" },
];
const clean = (value: unknown, max = 100) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const literal = (value: string) => value.replace(/[\\%_]/g, "\\$&");
export function locationTerms(input: string) {
  const value = input.trim().toLowerCase();
  if (!value) return [];
  const place = directoryPlaces.find(
    (p) =>
      p.slug === value ||
      p.name.toLowerCase() === value ||
      p.name.split(",")[0].toLowerCase() === value,
  );
  if (place)
    return [place.name.split(",")[0], place.name, place.region].map((v) =>
      v.toLowerCase(),
    );
  const region = (states[value] || input).toLowerCase();
  const cities = directoryPlaces
    .filter((p) => p.region.toLowerCase() === region)
    .map((p) => p.name.toLowerCase());
  return [region, ...cities];
}
export async function directorySearch(input: Record<string, unknown>) {
  const q = clean(input.q),
    type = clean(input.type, 80),
    service = clean(input.service, 80),
    area = clean(input.area, 60),
    office = clean(input.office),
    audience = clean(input.audience, 40);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(input.page || 1);
  const terms = locationTerms(area);
  const country = area.toLowerCase();
  const usArea =
    terms.some((t) =>
      Object.values(states).some((s) => s.toLowerCase() === t),
    ) || ["united states", "us", "usa"].includes(country);
  const globalSupply = usArea || country === "canada";
  const { rows } = await pool.query(
    `WITH filtered AS (
      SELECT c.*,r.rating_average,r.review_count FROM companies c
      LEFT JOIN LATERAL (SELECT round(avg(rating),1)::float AS rating_average,count(*)::int AS review_count FROM company_reviews r WHERE r.company_id=c.id AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=c.id AND m.user_id=r.user_id)) r ON true
      WHERE NOT c.is_demo
      AND ($1='' OR ($10<>'' AND c.name_key LIKE '%'||$10||'%') OR concat_ws(' ',c.name,c.tagline,c.description,c.location,array_to_string(c.services,' '),array_to_string(c.service_areas,' ')) ILIKE '%'||$1||'%')
      AND ($2='' OR c.type=$2) AND ($3='' OR $3=ANY(c.services))
      AND ($4::text[]='{}' OR EXISTS(SELECT 1 FROM unnest(c.service_areas) a,unnest($4::text[]) t WHERE lower(a)=t OR split_part(lower(a),',',1)=t) OR (c.type='Manufacturer' AND (($8 AND 'United States'=ANY(c.service_areas)) OR ($9 AND 'Worldwide'=ANY(c.service_areas)))))
      AND ($5='' OR c.location ILIKE '%'||$5||'%') AND ($6='' OR $6=ANY(c.audiences))
    ), paged AS (SELECT * FROM filtered ORDER BY name,id LIMIT 24 OFFSET $7)
    SELECT COALESCE((SELECT json_agg(paged ORDER BY name,id) FROM paged),'[]') AS companies,
    (SELECT count(*)::int FROM filtered) AS total,
    ARRAY(SELECT DISTINCT unnest(services) AS value FROM companies WHERE NOT is_demo ORDER BY value) AS services,
    ARRAY(SELECT DISTINCT unnest(service_areas) AS value FROM companies WHERE NOT is_demo ORDER BY value) AS areas,
    (SELECT json_object_agg(type,total) FROM (SELECT type,count(*)::int AS total FROM companies WHERE NOT is_demo GROUP BY type) counts) AS types`,
    [
      literal(q),
      type,
      service,
      terms,
      literal(office),
      audience,
      (page - 1) * 24,
      usArea,
      globalSupply,
      normalizedName(q),
    ],
  );
  return { ...rows[0], page, pageSize: 24, places: directoryPlaces };
}

export const normalizedName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export async function preventDuplicateCompany(
  db: PoolClient,
  name: string,
  exceptId?: string,
) {
  const key = normalizedName(name);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,8))", [key]);
  const existing = (
    await db.query(
      "SELECT id,name,username FROM companies WHERE NOT is_demo AND ($1::uuid IS NULL OR id<>$1) AND name_key=$2 LIMIT 1",
      [exceptId || null, key],
    )
  ).rows[0];
  if (existing)
    throw new HttpError(
      409,
      `${existing.name} already has a profile. Find it in the directory to claim it or ask its administrator for an invitation.`,
    );
}
export async function requireManagedCompany(
  db: Pick<PoolClient, "query">,
  companyId: string,
) {
  const company = (
    await db.query("SELECT listing_status FROM companies WHERE id=$1", [
      companyId,
    ])
  ).rows[0];
  if (!company) throw new HttpError(404, "Company not found.");
  if (company.listing_status === "unclaimed")
    throw new HttpError(
      409,
      "This company hasn’t joined Connect yet. Contact it through its official website.",
    );
}
export async function approveClaim(
  db: PoolClient,
  claimId: string,
  reviewer: string,
  note: string,
) {
  const entry = (
    await db.query("SELECT company_id FROM company_claims WHERE id=$1", [
      claimId,
    ])
  ).rows[0];
  if (!entry) throw new HttpError(404, "Claim not found.");
  const c = (
    await db.query(
      "SELECT id,listing_status FROM companies WHERE id=$1 FOR UPDATE",
      [entry.company_id],
    )
  ).rows[0];
  const claim = (
    await db.query(
      "SELECT cl.*,u.account_type,u.email_verified_at FROM company_claims cl JOIN users u ON u.id=cl.user_id WHERE cl.id=$1 FOR UPDATE OF cl",
      [claimId],
    )
  ).rows[0];
  if (claim.status !== "pending" || c.listing_status !== "unclaimed")
    throw new HttpError(409, "This claim has already been handled.");
  if (claim.account_type !== "company" || !claim.email_verified_at)
    throw new HttpError(403, "A verified company account is required.");
  if (
    (await db.query("SELECT 1 FROM memberships WHERE company_id=$1", [c.id]))
      .rowCount
  )
    throw new HttpError(409, "This company already has a manager.");
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
    [claim.user_id, c.id],
  );
  await db.query(
    "UPDATE companies SET listing_status='managed',ownership_verified_at=now() WHERE id=$1",
    [c.id],
  );
  await db.query(
    "UPDATE company_claims SET status='approved',reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE id=$1",
    [claimId, reviewer, note],
  );
  await db.query(
    "UPDATE company_claims SET status='superseded',reviewed_at=now() WHERE company_id=$1 AND status='pending'",
    [c.id],
  );
  await db.query(
    "UPDATE users SET onboarding_completed_at=COALESCE(onboarding_completed_at,now()) WHERE id=$1",
    [claim.user_id],
  );
  await db.query("INSERT INTO auth_events(user_id,event) VALUES($1,$2)", [
    claim.user_id,
    `company_claim_approved:${c.id}`,
  ]);
  return c.id as string;
}

export function directoryRoutes() {
  const router = Router();
  router.get("/directory/matches", async (req, res) => {
    const query = clean(req.query.q);
    if (query.length < 2) return res.json({ companies: [] });
    const companies = (
      await pool.query(
        "SELECT id,name,username,slug,logo_url,logo_style,location,type,listing_status FROM companies WHERE NOT is_demo AND (name ILIKE '%'||$1||'%' OR ($3<>'' AND name_key LIKE '%'||$3||'%')) ORDER BY (lower(name)=lower($2)) DESC,name LIMIT 5",
        [literal(query), query, normalizedName(query)],
      )
    ).rows;
    res.json({ companies });
  });
  router.get("/companies/:id/claim", async (req, res) => {
    const c = (
      await pool.query(
        "SELECT id,name,username,slug,logo_url,logo_style,location,type,listing_status,website FROM companies WHERE id::text=$1 OR username=$1 OR slug=$1",
        [req.params.id],
      )
    ).rows[0];
    if (!c) throw new HttpError(404, "Company not found.");
    const domains = (
      await pool.query(
        "SELECT domain FROM company_claim_domains WHERE company_id=$1 ORDER BY domain",
        [c.id],
      )
    ).rows.map((r) => r.domain);
    const user = req.auth
      ? (
          await pool.query(
            "SELECT email,email_verified_at,account_type FROM users WHERE id=$1",
            [req.auth.userId],
          )
        ).rows[0]
      : null;
    const claim = req.auth
      ? (
          await pool.query(
            "SELECT id,status,method,created_at,review_note FROM company_claims WHERE company_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1",
            [c.id, req.auth.userId],
          )
        ).rows[0]
      : null;
    res.json({
      company: c,
      domains,
      emailMatches: !!user && domains.includes(user.email.split("@")[1]),
      verified: !!user?.email_verified_at,
      claim: claim || null,
    });
  });
  router.post("/companies/:id/claim", requireAuth, async (req, res) => {
    const b = z
      .object({
        method: z.enum(["work_email", "manual"]),
        role: z.string().trim().min(2).max(120),
        evidence: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    if (req.auth!.accountType !== "company")
      throw new HttpError(
        403,
        "Use a company account to claim a business. Individual accounts cannot manage companies.",
      );
    if (!req.auth!.emailVerified)
      throw new HttpError(403, "Verify your email before claiming a company.");
    if (b.method === "manual" && b.evidence.length < 30)
      throw new HttpError(
        400,
        "Tell us how we can confirm your role, including a public business contact or supporting link (at least 30 characters).",
      );
    const result = await tx(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,9))", [
        req.auth!.userId,
      ]);
      const c = (
        await db.query(
          "SELECT id,listing_status FROM companies WHERE id::text=$1 OR username=$1 OR slug=$1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!c) throw new HttpError(404, "Company not found.");
      if (c.listing_status !== "unclaimed")
        throw new HttpError(
          409,
          "This company is already managed. Ask its administrator for an employee invitation.",
        );
      const pending = (
        await db.query(
          "SELECT id,status FROM company_claims WHERE company_id=$1 AND user_id=$2 AND status='pending'",
          [c.id, req.auth!.userId],
        )
      ).rows[0];
      if (pending) return pending;
      const count = (
        await db.query(
          "SELECT count(*)::int AS count FROM company_claims WHERE user_id=$1 AND created_at>now()-interval '1 day'",
          [req.auth!.userId],
        )
      ).rows[0].count;
      if (count >= 5)
        throw new HttpError(
          429,
          "You can request up to five company claims per day.",
        );
      if (b.method === "work_email") {
        const match = await db.query(
          "SELECT 1 FROM company_claim_domains d JOIN users u ON lower(split_part(u.email,'@',2))=d.domain WHERE d.company_id=$1 AND u.id=$2 AND u.email_verified_at IS NOT NULL",
          [c.id, req.auth!.userId],
        );
        if (!match.rowCount)
          throw new HttpError(
            403,
            "Use a verified email on the company’s official domain, or request a manual review.",
          );
      }
      const claim = (
        await db.query(
          "INSERT INTO company_claims(company_id,user_id,method,role_description,evidence) VALUES($1,$2,$3,$4,$5) RETURNING id,status",
          [c.id, req.auth!.userId, b.method, b.role, b.evidence],
        )
      ).rows[0];
      if (b.method === "work_email") {
        await approveClaim(
          db,
          claim.id,
          "verified_work_email",
          "Verified email matched an independently sourced company domain.",
        );
        await db.query(
          "UPDATE sessions SET company_id=$1 WHERE token_hash=$2",
          [c.id, req.auth!.tokenHash],
        );
        claim.status = "approved";
      }
      return claim;
    });
    res.status(201).json(result);
  });
  return router;
}
