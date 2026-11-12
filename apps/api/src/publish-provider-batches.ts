import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";
import {
  enrichmentBatch,
  importProviderEnrichment,
} from "./provider-enrichment.js";

try {
  const args = process.argv.slice(2);
  const dir = args[args.indexOf("--dir") + 1];
  if (!args.includes("--dir") || !dir || dir.startsWith("--"))
    throw new Error(
      "Pass --dir for publication batches. Dry run is the default.",
    );
  const files = (await readdir(dir))
    .filter((name) =>
      /^provider-source-publication-[a-z0-9-]+\.json$/.test(name),
    )
    .sort();
  if (!files.length) throw new Error("No publication batches found.");
  const batches = await Promise.all(
    files.map(async (name) =>
      enrichmentBatch.parse(
        JSON.parse(await readFile(path.join(dir, name), "utf8")),
      ),
    ),
  );
  const ids = batches.flatMap((batch) => batch.records.map((r) => r.companyId));
  if (new Set(ids).size !== ids.length)
    throw new Error("A company appears in more than one batch.");
  if (
    batches.some((b) =>
      b.records.some(
        (r) =>
          !r.preserveProfile || r.research.reviewMethod !== "source-check-v1",
      ),
    )
  )
    throw new Error(
      "Directory publication accepts additive source-checked batches only.",
    );
  // Preview every batch before any write. Individual transactions recheck edits and ownership.
  const preview = [];
  for (const batch of batches)
    preview.push(...(await importProviderEnrichment(batch)));
  const blocked = preview.filter((r) => r.status.startsWith("blocked"));
  if (blocked.length)
    throw new Error("Nothing applied: " + JSON.stringify(blocked));
  const results = [];
  if (args.includes("--apply")) {
    for (const batch of batches) {
      results.push(...(await importProviderEnrichment(batch, true)));
      console.log(
        JSON.stringify({
          batch: batch.batchId,
          processed: results.length,
          total: ids.length,
        }),
      );
    }
  } else results.push(...preview);
  console.log(
    JSON.stringify(
      {
        apply: args.includes("--apply"),
        companies: results.length,
        statuses: results.reduce<Record<string, number>>(
          (a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }),
          {},
        ),
        services: results.reduce((n, r) => n + r.services, 0),
        products: results.reduce((n, r) => n + r.products, 0),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
