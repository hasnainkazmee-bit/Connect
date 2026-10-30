import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
dotenv.config({ path: path.join(root, ".env"), quiet: true });
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://sunhub:sunhub_local@localhost:5438/sunhub_community",
  max: 12,
});
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function lockPair(db: pg.PoolClient, a: string, b: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    [a, b].sort().join(":"),
  ]);
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
