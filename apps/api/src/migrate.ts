import { pool, tx, root } from "./db.js";
import fs from "node:fs/promises";
import path from "node:path";
await tx(async (db) => {
  await db.query("SELECT pg_advisory_xact_lock(27182026)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const dir = path.join(root, "apps/api/migrations");
  for (const name of (await fs.readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      !(await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
        .rowCount
    ) {
      await db.query(await fs.readFile(path.join(dir, name), "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      console.log(`Applied ${name}`);
    }
  }
});
await pool.end();
