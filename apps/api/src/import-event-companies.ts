import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { importEventCompanies } from "./event-company-import.js";
try {
  const args = process.argv.slice(2),
    index = args.indexOf("--file"),
    file = args[index + 1];
  if (
    index < 0 ||
    !file ||
    file.startsWith("--") ||
    args.some((v, i) => i !== index + 1 && !["--file", "--apply"].includes(v))
  )
    throw new Error(
      "Use --file <reviewed-batch.json> and optional --apply. Dry run is the default.",
    );
  console.log(
    JSON.stringify(
      await importEventCompanies(
        JSON.parse(await readFile(file, "utf8")),
        args.includes("--apply"),
      ),
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
