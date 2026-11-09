#!/usr/bin/env node
// Operator-only matching tool. Never saves Google Places content other than a Place ID.
import dotenv from "dotenv";
import pg from "pg";
import path from "node:path";

dotenv.config({ path: path.resolve(".env"), quiet: true });
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, ...value] = arg.replace(/^--/, "").split("=");
    return [name, value.join("=")];
  }),
);
if (!args.company || !process.env.GOOGLE_PLACES_API_KEY) {
  console.error(
    "Usage: GOOGLE_PLACES_API_KEY=… node tools/google-place-match.mjs --company=company-username [--place-id=ID --confirm-name=Exact Google name]",
  );
  process.exit(2);
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const googleKey = process.env.GOOGLE_PLACES_API_KEY;
const host = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const queryGoogle = async (url, body, fieldMask) => {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Google Places returned ${response.status}`);
  return response.json();
};
try {
  const company = (
    await db.query(
      "SELECT id,name,username,slug,location,website FROM companies WHERE username=$1 OR slug=$1",
      [args.company],
    )
  ).rows[0];
  if (!company) throw new Error("Company not found.");
  if (!args["place-id"]) {
    const result = await queryGoogle(
      "https://places.googleapis.com/v1/places:searchText",
      {
        textQuery: `${company.name} ${company.location}`.trim(),
        maxResultCount: 5,
      },
      "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.googleMapsUri",
    );
    console.log(
      `Connect: ${company.name} | ${company.location} | ${company.website}`,
    );
    for (const place of result.places || [])
      console.log(
        `${place.id}\n  ${place.displayName?.text || ""}\n  ${place.formattedAddress || ""}\n  ${place.websiteUri || ""}\n  ${place.googleMapsUri || ""}`,
      );
    console.log(
      "Review the business identity, location, and website before linking. Search results are not linked automatically.",
    );
  } else {
    const id = args["place-id"];
    if (!/^[A-Za-z0-9_-]{10,255}$/.test(id) || !args["confirm-name"])
      throw new Error("Supply a valid --place-id and --confirm-name.");
    const place = await queryGoogle(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
      null,
      "id,displayName,formattedAddress,websiteUri",
    );
    if (place.id !== id || place.displayName?.text !== args["confirm-name"])
      throw new Error(
        "The confirmed name does not match Google's current listing.",
      );
    if (
      !host(company.website) ||
      host(company.website) !== host(place.websiteUri)
    )
      throw new Error(
        "Website domains differ or are missing; leave this company unlinked for manual investigation.",
      );
    const city = company.location.split(",")[0].trim().toLowerCase();
    if (
      city &&
      city !== "united states" &&
      city !== "worldwide" &&
      !place.formattedAddress?.toLowerCase().includes(city)
    )
      throw new Error(
        "Google's listing address does not match the company city.",
      );
    await db.query(
      `INSERT INTO company_google_places(company_id,place_id)
       VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE
       SET place_id=EXCLUDED.place_id,matched_at=now()`,
      [company.id, id],
    );
    console.log(
      `Linked ${company.username || company.slug} to Google Place ID ${id}.`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
