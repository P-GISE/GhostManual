import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "../src/lib/db.ts";

try {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(782401)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("db/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
      const seen = await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
      if (!seen.rowCount) {
        await db.query(await readFile("db/migrations/" + name, "utf8"));
        await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        console.log("Applied " + name);
      }
    }
  });
  console.log("Migrations ready");
} finally {
  await pool.end();
}
