import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import {
  companyLogoImage,
  reviewedCompanyLogos,
} from "./company-logo-image.js";
import { pool, tx } from "./db.js";
import { storeBuffer } from "./storage.js";

type Listing = { id: string; name: string; logo_url: string };
const maxSourceBytes = 4 * 1024 * 1024;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const event = args.find((arg) => arg.startsWith("--event="))?.slice(8) || "";
const cacheDir =
  args.find((arg) => arg.startsWith("--cache-dir="))?.slice(12) || "";
const limit = Number(
  args.find((arg) => arg.startsWith("--limit="))?.slice(8) || 0,
);
const concurrency = Number(
  args.find((arg) => arg.startsWith("--concurrency="))?.slice(14) || 12,
);
if (
  args.some(
    (arg) =>
      arg !== "--apply" &&
      !/^--limit=\d+$/.test(arg) &&
      !/^--concurrency=\d+$/.test(arg) &&
      !/^--cache-dir=.+$/.test(arg) &&
      !/^--event=[a-z0-9][a-z0-9-]{2,79}$/.test(arg),
  ) ||
  (cacheDir && !event) ||
  !Number.isSafeInteger(limit) ||
  !Number.isSafeInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 20
)
  throw new Error(
    "Use --apply, --limit=N, --event=event-key, --cache-dir=path (with event), and --concurrency=1..20 only.",
  );
const reviewed = cacheDir ? await reviewedCompanyLogos(cacheDir) : null;

function publicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c === 0))) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

async function downloadImage(input: string, redirects = 0): Promise<Buffer> {
  const url = new URL(input.replace(/^http:/, "https:"));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    redirects > 3
  )
    throw new Error("Unsupported logo source");
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  const address = addresses.find((item) => publicIpv4(item.address));
  if (!address) throw new Error("No public IPv4 address");
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: (_host, options, callback) => {
          if (options.all)
            callback(null, [{ address: address.address, family: 4 }]);
          else callback(null, address.address, 4);
        },
        signal: AbortSignal.timeout(16000),
        headers: {
          Accept:
            "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; ConnectLogoImporter/1.0)",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          const location = response.headers.location;
          if (!location) return reject(new Error("Redirect without location"));
          downloadImage(new URL(location, url).href, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status !== 200) {
          response.resume();
          return reject(new Error(`Source returned HTTP ${status}`));
        }
        if (Number(response.headers["content-length"] || 0) > maxSourceBytes) {
          response.resume();
          return reject(new Error("Logo exceeds size limit"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxSourceBytes)
            request.destroy(new Error("Logo exceeds size limit"));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

async function cacheLogo(company: Listing) {
  const source = reviewed
    ? await reviewed.read(company.logo_url)
    : await downloadImage(company.logo_url);
  const image = await companyLogoImage(source, Boolean(event));
  if (!image.length || image.length > 2 * 1024 * 1024)
    throw new Error("Normalized logo exceeds size limit");
  const key = `imported-logos/${company.id}.webp`;
  const stored = await storeBuffer(key, image, "image/webp");
  return tx(async (db) => {
    const assetId = randomUUID();
    const asset = await db.query<{ id: string }>(
      `INSERT INTO company_assets
       (id,company_id,storage_name,storage_backend,mime_type,size,sha256)
       VALUES($1,$2,$3,$4,'image/webp',$5,$6)
       ON CONFLICT(storage_name) DO UPDATE SET
         mime_type=EXCLUDED.mime_type,size=EXCLUDED.size,sha256=EXCLUDED.sha256
       RETURNING id`,
      [
        assetId,
        company.id,
        key,
        stored.storage_backend,
        image.length,
        stored.sha256,
      ],
    );
    const updated = await db.query(
      `UPDATE companies SET logo_url=$1
       WHERE id=$2 AND logo_url=$3 AND listing_status='unclaimed'`,
      [`/api/company-assets/${asset.rows[0].id}`, company.id, company.logo_url],
    );
    return updated.rowCount === 1;
  });
}

try {
  const { rows } = await pool.query<Listing>(
    `SELECT id,name,logo_url FROM companies
     WHERE NOT is_demo AND listing_status='unclaimed'
       AND (($1='' AND source_checked_at::date='2026-11-03') OR
         ($1<>'' AND EXISTS(SELECT 1 FROM company_event_participations ep WHERE ep.company_id=companies.id AND ep.event_key=$1)))
       AND logo_url ~* '^https?://'
     ORDER BY name,id`,
    [event],
  );
  const eligible = reviewed
    ? rows.filter((row) => reviewed.has(row.logo_url))
    : rows;
  const companies = limit ? eligible.slice(0, limit) : eligible;
  if (!apply) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        eligible: eligible.length,
        selected: companies.length,
      }),
    );
  } else {
    let next = 0;
    let completed = 0;
    let cached = 0;
    let unchanged = 0;
    const errors: Record<string, number> = {};
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, companies.length) },
        async () => {
          while (next < companies.length) {
            const company = companies[next++];
            try {
              if (await cacheLogo(company)) cached++;
              else unchanged++;
            } catch (error) {
              const reason =
                error instanceof Error ? error.message : String(error);
              errors[reason] = (errors[reason] || 0) + 1;
            }
            completed++;
            if (completed % 100 === 0 || completed === companies.length)
              console.log(
                JSON.stringify({
                  completed,
                  selected: companies.length,
                  cached,
                  unchanged,
                  failed: completed - cached - unchanged,
                }),
              );
          }
        },
      ),
    );
    console.log(
      JSON.stringify(
        {
          mode: "applied",
          selected: companies.length,
          cached,
          unchanged,
          failed: completed - cached - unchanged,
          errors,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await pool.end();
}
