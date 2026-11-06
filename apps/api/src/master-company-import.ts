import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normalizedName } from "./directory.js";
import { usernameSchema } from "./profiles.js";

const recordSchema = z.strictObject({
  name: z.string().trim().min(1),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  type: z.string().trim().min(1),
  location: z.string(),
  website: z.url(),
  description: z.string().trim().min(1),
  tagline: z.string().trim().min(1),
  services: z.array(z.string()),
  serviceAreas: z.array(z.string()),
  audiences: z.array(z.string()),
  phone: z.string(),
  logoUrl: z.string(),
  employeeCount: z.string(),
  established: z.number().int().min(1800).max(2100).nullable(),
  suggestedUsername: z.string(),
  sourceCheckedAt: z.iso.date(),
});
export type MasterCompany = z.infer<typeof recordSchema>;

function verifiedPublicCorrection(item: MasterCompany): MasterCompany {
  if (item.name !== "Barnhart Pump Co" || item.domain !== "barnhartpump.com")
    return item;
  // Official services: https://www.barnhartpump.com/services/solar-water-pumps/
  return {
    ...item,
    type: "Service provider",
    location: "Peyton, CO",
    tagline: "Water well pumps, including solar-powered systems",
    description:
      "Barnhart Pump Co designs, installs and repairs water well pump systems and provides water treatment in Colorado. Its solar work is solar-powered water pumps for off-grid homes, farms and remote sites.",
    services: [
      "Solar water pumps",
      "Water well pump installation",
      "Well pump repair",
      "Water treatment",
    ],
    serviceAreas: ["Peyton", "Colorado Springs", "Pikes Peak region"],
  };
}
export type ExistingCompany = {
  id: string;
  name_key: string;
  slug: string;
  username: string | null;
  website: string;
};

function host(url: string) {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}
function matchesDomain(website: string, domain: string) {
  const hostname = host(website);
  return hostname === domain || hostname.endsWith("." + domain);
}
function slugBase(record: MasterCompany) {
  const suggested = record.suggestedUsername.toLowerCase();
  if (usernameSchema.safeParse(suggested).success)
    return suggested.slice(0, 24).replace(/-+$/, "");
  let base = record.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(base)) base = "company-" + base;
  return base.slice(0, 24).replace(/-+$/, "") || "company";
}

export async function loadMasterCompanySnapshot(root: string) {
  const dir = path.join(root, "apps/api/data");
  const files = (await readdir(dir))
    .filter((name) =>
      /^master-companies-public-2026-11-03-\d{2}\.ndjson$/.test(name),
    )
    .sort();
  if (files.length !== 14)
    throw new Error("The public company snapshot is incomplete.");
  const records: MasterCompany[] = [];
  for (const file of files) {
    const lines = (await readFile(path.join(dir, file), "utf8"))
      .split("\n")
      .filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const item = recordSchema.parse(JSON.parse(line));
      if (!matchesDomain(item.website, item.domain))
        throw new Error(`Website/domain mismatch in ${file} line ${index + 1}`);
      if (item.logoUrl && !host(item.logoUrl))
        throw new Error(`Invalid logo URL in ${file} line ${index + 1}`);
      records.push(verifiedPublicCorrection(item));
    }
  }
  if (records.length !== 3330)
    throw new Error(
      `Expected 3330 reviewed companies; found ${records.length}`,
    );
  return records;
}

export function planMasterCompanyImport(
  records: MasterCompany[],
  existing: ExistingCompany[],
  claimDomains: string[],
  usernameHistory: string[],
) {
  const names = new Set(existing.map((c) => c.name_key));
  const domains = new Set(claimDomains.map((d) => d.toLowerCase()));
  for (const c of existing) {
    const hostname = host(c.website);
    if (hostname) domains.add(hostname);
  }
  const usernames = new Set(usernameHistory);
  for (const c of existing) {
    usernames.add(c.slug);
    if (c.username) usernames.add(c.username);
  }
  const additions: (MasterCompany & { username: string })[] = [];
  const skipped = { existingName: 0, existingDomain: 0 };
  for (const record of records) {
    const key = normalizedName(record.name);
    if (names.has(key)) {
      skipped.existingName++;
      continue;
    }
    if (
      domains.has(record.domain) ||
      [...domains].some(
        (d) =>
          d.endsWith("." + record.domain) || record.domain.endsWith("." + d),
      )
    ) {
      skipped.existingDomain++;
      continue;
    }
    const base = slugBase(record);
    let username = "";
    for (let n = 1; n <= 10000; n++) {
      const suffix = n === 1 ? "" : "-" + n;
      const candidate = base.slice(0, 30 - suffix.length) + suffix;
      if (
        !usernames.has(candidate) &&
        usernameSchema.safeParse(candidate).success
      ) {
        username = candidate;
        break;
      }
    }
    if (!username) throw new Error("No available username for " + record.name);
    additions.push({ ...record, username });
    names.add(key);
    domains.add(record.domain);
    usernames.add(username);
  }
  return { additions, skipped };
}
