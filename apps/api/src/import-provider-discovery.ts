import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { importProviderDiscovery } from "./provider-matching.js";
try {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`Provide ${name}.`);
    return args[i + 1];
  };
  const inventory = JSON.parse(await readFile(option("--inventory"), "utf8"));
  const lines = (await readFile(option("--results"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  // Crawler resumes are append-only. The last complete result for each company wins.
  const records = [...new Map(lines.map((r) => [r.companyId, r])).values()];
  console.log(
    JSON.stringify(
      await importProviderDiscovery(
        option("--run-id"),
        inventory,
        records,
        args.includes("--apply"),
      ),
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
