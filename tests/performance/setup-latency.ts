import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { assertLatencyTarget } from "./latency-metrics.ts";

export default async function setup(): Promise<void> {
  assertLatencyTarget(process.env);
  const db = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    const names = (await readdir("db/migrations"))
      .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) <= 13)
      .sort();
    if (names.length !== 13) throw new Error("Expected isolated migrations001-013");
    for (const name of names) {
      await db.query(await readFile("db/migrations/" + name, "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}
