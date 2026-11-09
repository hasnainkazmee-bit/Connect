import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { hashToken, requireAdmin } from "./auth.js";
import { pool, tx, HttpError } from "./db.js";

const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const redirectUri = `${origin}/api/google-business/callback`;
const scope = "https://www.googleapis.com/auth/business.manage";
const key = process.env.GOOGLE_BUSINESS_TOKEN_KEY
  ? Buffer.from(process.env.GOOGLE_BUSINESS_TOKEN_KEY, "base64")
  : null;
const configured = () =>
  !!(
    process.env.GOOGLE_BUSINESS_CLIENT_ID &&
    process.env.GOOGLE_BUSINESS_CLIENT_SECRET &&
    key?.length === 32
  );
const safeName = z.string().regex(/^accounts\/\d+\/locations\/\d+$/);
const safeAccount = z.string().regex(/^accounts\/\d+$/);
type Connection = {
  company_id: string;
  refresh_token_ciphertext: string;
  account_name: string | null;
  location_name: string | null;
  location_title: string | null;
  google_maps_uri: string | null;
  rating: number | null;
  review_count: number | null;
  rating_fetched_at: Date | null;
};
type GoogleAccount = { name: string; accountName?: string };
type GoogleLocation = {
  name: string;
  title?: string;
  websiteUri?: string;
  metadata?: { mapsUri?: string; placeId?: string };
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
  };
};

function encrypt(token: string, companyId: string) {
  if (!key) throw new HttpError(503, "Google Business Profile is unavailable.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(companyId));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}
function decrypt(ciphertext: string, companyId: string) {
  if (!key) throw new HttpError(503, "Google Business Profile is unavailable.");
  const [iv, tag, body] = ciphertext
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16)
    throw new HttpError(
      503,
      "Google Business Profile needs to be reconnected.",
    );
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(companyId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}
async function googleJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new HttpError(
        409,
        "Google access expired. Reconnect your Business Profile.",
      );
    if (response.status === 403)
      throw new HttpError(
        403,
        "Google Business Profile API access is not enabled for Connect yet.",
      );
    throw new HttpError(
      502,
      "Google Business Profile is temporarily unavailable.",
    );
  }
  return response.json() as Promise<T>;
}
async function accessToken(connection: Connection) {
  if (!configured())
    throw new HttpError(503, "Google Business Profile is unavailable.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET!,
      refresh_token: decrypt(
        connection.refresh_token_ciphertext,
        connection.company_id,
      ),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(
      409,
      "Google access expired. Reconnect your Business Profile.",
    );
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token)
    throw new HttpError(502, "Google did not return an access token.");
  return data.access_token;
}
async function connectionFor(companyId: string) {
  return (
    await pool.query<Connection>(
      "SELECT * FROM google_business_connections WHERE company_id=$1",
      [companyId],
    )
  ).rows[0];
}
async function locationsFor(access: string) {
  const accounts: GoogleAccount[] = [];
  let nextAccountPage = "";
  for (let page = 0; page < 5; page++) {
    const url = new URL(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    );
    url.searchParams.set("pageSize", "20");
    if (nextAccountPage) url.searchParams.set("pageToken", nextAccountPage);
    const result = await googleJson<{
      accounts?: GoogleAccount[];
      nextPageToken?: string;
    }>(url.toString(), access);
    accounts.push(
      ...(result.accounts || []).filter(
        (a) => safeAccount.safeParse(a.name).success,
      ),
    );
    nextAccountPage = result.nextPageToken || "";
    if (!nextAccountPage) break;
  }
  const locations: (GoogleLocation & { accountName: string })[] = [];
  for (const account of accounts) {
    let nextLocationPage = "";
    for (let page = 0; page < 2; page++) {
      const url = new URL(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`,
      );
      url.searchParams.set(
        "readMask",
        "name,title,websiteUri,storefrontAddress,metadata",
      );
      url.searchParams.set("pageSize", "100");
      if (nextLocationPage) url.searchParams.set("pageToken", nextLocationPage);
      const result = await googleJson<{
        locations?: GoogleLocation[];
        nextPageToken?: string;
      }>(url.toString(), access);
      for (const location of result.locations || []) {
        if (safeName.safeParse(`${account.name}/${location.name}`).success)
          locations.push({ ...location, accountName: account.name });
      }
      nextLocationPage = result.nextPageToken || "";
      if (!nextLocationPage || locations.length >= 200) break;
    }
    if (locations.length >= 200) break;
  }
  return locations;
}
function cleanName(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}
function siteHost(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
function mapsUrl(location: GoogleLocation) {
  try {
    const uri = new URL(location.metadata?.mapsUri || "");
    if (
      uri.protocol === "https:" &&
      ["www.google.com", "maps.google.com"].includes(uri.hostname)
    )
      return uri.toString();
  } catch {
    /* A missing Maps URI falls back to the stable Place ID. */
  }
  if (location.metadata?.placeId)
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(location.metadata.placeId)}`;
  return "";
}
async function fetchRating(
  access: string,
  accountName: string,
  locationName: string,
) {
  const url = `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews?pageSize=1`;
  const data = await googleJson<{
    averageRating?: number;
    totalReviewCount?: number;
  }>(url, access);
  const count = Number(data.totalReviewCount || 0);
  const rating = Number(data.averageRating);
  return {
    rating:
      count && Number.isFinite(rating) && rating >= 1 && rating <= 5
        ? rating
        : null,
    count,
  };
}

export async function refreshGoogleBusinessRatings() {
  // Google-provided score snapshots are temporary. Remove expired data rather
  // than merely hiding it from public queries when refreshes stop succeeding.
  await pool.query(
    `UPDATE google_business_connections
     SET rating=NULL,review_count=NULL,rating_fetched_at=NULL,updated_at=now()
     WHERE rating_fetched_at <= now()-interval '30 days'`,
  );
  if (!configured()) return;
  const rows = (
    await pool.query<Connection>(
      "SELECT * FROM google_business_connections WHERE location_name IS NOT NULL AND (rating_fetched_at IS NULL OR rating_fetched_at < now()-interval '24 hours') AND (last_refresh_attempt_at IS NULL OR last_refresh_attempt_at < now()-interval '6 hours') ORDER BY last_refresh_attempt_at NULLS FIRST LIMIT 20",
    )
  ).rows;
  for (const row of rows) {
    try {
      await pool.query(
        "UPDATE google_business_connections SET last_refresh_attempt_at=now() WHERE company_id=$1",
        [row.company_id],
      );
      const access = await accessToken(row);
      const result = await fetchRating(
        access,
        safeAccount.parse(row.account_name),
        z
          .string()
          .regex(/^locations\/\d+$/)
          .parse(row.location_name),
      );
      await pool.query(
        "UPDATE google_business_connections SET rating=$2,review_count=$3,rating_fetched_at=now(),updated_at=now() WHERE company_id=$1 AND location_name=$4",
        [row.company_id, result.rating, result.count, row.location_name],
      );
    } catch {
      // Keep a recent snapshot; expired scores are removed on the next pass.
    }
  }
}

export function googleBusinessRoutes() {
  const router = Router();
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  router.get("/google-business/config", (_req, res) =>
    res.json({ enabled: configured() }),
  );
  router.get(
    "/google-business/start",
    requireAdmin,
    limit,
    async (req, res) => {
      if (!configured())
        throw new HttpError(
          503,
          "Google Business Profile connection is not available yet.",
        );
      const state = randomBytes(32).toString("base64url");
      await pool.query(
        "DELETE FROM google_business_oauth_states WHERE expires_at<now()",
      );
      await pool.query(
        "INSERT INTO google_business_oauth_states(state_hash,session_hash,company_id,user_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
        [
          hashToken(state),
          req.auth!.tokenHash,
          req.auth!.companyId,
          req.auth!.userId,
        ],
      );
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [field, value] of Object.entries({
        client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope,
        access_type: "offline",
        prompt: "consent",
        state,
      }))
        url.searchParams.set(field, value);
      res.redirect(url.toString());
    },
  );
  router.get("/google-business/callback", async (req, res) => {
    const state = z.string().max(200).safeParse(req.query.state);
    const code = z.string().max(4000).safeParse(req.query.code);
    if (!state.success || !code.success || !configured() || !req.auth)
      return res.redirect("/?google=failed");
    const flow = await tx(async (db) => {
      const result = await db.query<{
        company_id: string;
        user_id: string;
        session_hash: string;
      }>(
        "DELETE FROM google_business_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING company_id,user_id,session_hash",
        [hashToken(state.data)],
      );
      return result.rows[0];
    });
    if (
      !flow ||
      flow.session_hash !== req.auth.tokenHash ||
      flow.user_id !== req.auth.userId ||
      flow.company_id !== req.auth.companyId ||
      !["owner", "admin"].includes(req.auth.role || "")
    )
      return res.redirect("/?google=failed");
    const company = (
      await pool.query<{ username: string; slug: string }>(
        "SELECT username,slug FROM companies WHERE id=$1",
        [flow.company_id],
      )
    ).rows[0];
    const returnTo = `/${encodeURIComponent(company?.username || company?.slug || "")}?tab=reviews`;
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code.data,
          client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID!,
          client_secret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await response.json()) as { refresh_token?: string };
      if (!response.ok || !data.refresh_token)
        return res.redirect(`${returnTo}&google=failed`);
      await pool.query(
        `INSERT INTO google_business_connections(company_id,authorized_by,refresh_token_ciphertext)
         VALUES($1,$2,$3) ON CONFLICT(company_id) DO UPDATE SET authorized_by=EXCLUDED.authorized_by,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
         account_name=NULL,location_name=NULL,location_title=NULL,google_maps_uri=NULL,rating=NULL,review_count=NULL,rating_fetched_at=NULL,last_refresh_attempt_at=NULL,updated_at=now()`,
        [
          flow.company_id,
          flow.user_id,
          encrypt(data.refresh_token, flow.company_id),
        ],
      );
      res.redirect(`${returnTo}&google=choose`);
    } catch {
      res.redirect(`${returnTo}&google=failed`);
    }
  });
  router.get(
    "/companies/current/google-business",
    requireAdmin,
    async (req, res) => {
      const row = await connectionFor(req.auth!.companyId!);
      res.json({
        enabled: configured(),
        connected: !!row,
        locationName: row?.location_name || null,
        locationTitle: row?.location_title || null,
        rating: row?.rating ?? null,
        count: row?.review_count ?? 0,
        updatedAt: row?.rating_fetched_at || null,
      });
    },
  );
  router.get(
    "/companies/current/google-business/locations",
    requireAdmin,
    limit,
    async (req, res) => {
      const row = await connectionFor(req.auth!.companyId!);
      if (!row)
        throw new HttpError(404, "Connect your Google Business Profile first.");
      const locations = await locationsFor(await accessToken(row));
      res.json({
        locations: locations.map((location) => ({
          accountName: location.accountName,
          locationName: location.name,
          title: location.title || "Untitled location",
          address: [
            location.storefrontAddress?.addressLines?.join(", "),
            location.storefrontAddress?.locality,
            location.storefrontAddress?.administrativeArea,
          ]
            .filter(Boolean)
            .join(", "),
          website: location.websiteUri || "",
        })),
      });
    },
  );
  router.post(
    "/companies/current/google-business/location",
    requireAdmin,
    limit,
    async (req, res) => {
      const { accountName, locationName } = z
        .object({
          accountName: safeAccount,
          locationName: z.string().regex(/^locations\/\d+$/),
        })
        .parse(req.body);
      const companyId = req.auth!.companyId!;
      const row = await connectionFor(companyId);
      if (!row)
        throw new HttpError(404, "Connect your Google Business Profile first.");
      const access = await accessToken(row);
      const location = (await locationsFor(access)).find(
        (item) =>
          item.accountName === accountName && item.name === locationName,
      );
      if (!location)
        throw new HttpError(
          404,
          "That Google location is not available to this account.",
        );
      const company = (
        await pool.query<{ name: string; website: string }>(
          "SELECT name,website FROM companies WHERE id=$1",
          [companyId],
        )
      ).rows[0];
      const listedName = cleanName(location.title || "");
      const companyName = cleanName(company.name);
      const sameWebsite =
        !!siteHost(company.website) &&
        siteHost(company.website) === siteHost(location.websiteUri || "");
      const similarName =
        listedName.length >= 5 &&
        companyName.length >= 5 &&
        (listedName.includes(companyName) || companyName.includes(listedName));
      if (
        !listedName ||
        (listedName !== companyName && !(sameWebsite && similarName))
      )
        throw new HttpError(
          409,
          "This location does not match your company name or website.",
        );
      const result = await fetchRating(access, accountName, locationName);
      await pool.query(
        `UPDATE google_business_connections SET account_name=$2,location_name=$3,location_title=$4,google_maps_uri=$5,
       rating=$6,review_count=$7,rating_fetched_at=now(),last_refresh_attempt_at=now(),updated_at=now() WHERE company_id=$1`,
        [
          companyId,
          accountName,
          locationName,
          location.title || company.name,
          mapsUrl(location),
          result.rating,
          result.count,
        ],
      );
      res.json({ linked: true, rating: result.rating, count: result.count });
    },
  );
  router.delete(
    "/companies/current/google-business",
    requireAdmin,
    async (req, res) => {
      await pool.query(
        "DELETE FROM google_business_connections WHERE company_id=$1",
        [req.auth!.companyId],
      );
      res.json({ ok: true });
    },
  );
  return router;
}
