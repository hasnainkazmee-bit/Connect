import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { importProviderEnrichment } from "./provider-enrichment.js";

try {
  const args = process.argv.slice(2);
  const file = args[args.indexOf("--file") + 1];
  if (!args.includes("--file") || !file || file.startsWith("--"))
    throw new Error(
      "Pass a reviewed batch with --file. Dry run is the default; --apply publishes it.",
    );
  const rows = await importProviderEnrichment(
    JSON.parse(await readFile(file, "utf8")),
    args.includes("--apply"),
  );
  console.table(rows);
  if (rows.some((r) => r.status.startsWith("blocked"))) process.exitCode = 1;
  console.log(
    args.includes("--apply")
      ? "Finished. Original profiles retained in provider_enrichment_audit."
      : "Dry run only. No profiles changed.",
  );
} finally {
  await pool.end();
}
