import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

export async function isolatedDatabase(
  version: number,
  connectionString = process.env["DATABASE_URL"],
  name = `gm_lead_${randomUUID().replaceAll("-", "")}_test`,
) {
  if (!connectionString) throw new Error("A dedicated _test database is required");
  const base = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(base.protocol) ||
    !/^\/[A-Za-z0-9_]+_test$/.test(base.pathname) ||
    !/^gm_lead_[a-f0-9]{32}_test$/.test(name) ||
    base.pathname === "/" + name
  )
    throw new Error("Isolated database creation is restricted to dedicated test targets");
  const admin = new pg.Pool({ connectionString, max: 1 });
  const target = new URL(base);
  target.pathname = "/" + name;
  let created = false;
  async function close() {
    try {
      const current = await admin.query<{ name: string }>("SELECT current_database() AS name");
      if (current.rows[0]?.name !== base.pathname.slice(1))
        throw new Error("Refusing cleanup from an unexpected database");
      if (created) {
        await admin.query(`DROP DATABASE ${name}`);
        created = false;
      }
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    const db = new pg.Pool({ connectionString: target.toString(), max: 1 });
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s'");
      await db.query(
        "CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const files = (await readdir("db/migrations"))
        .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= version)
        .sort();
      if (files.length !== version) throw new Error("Incomplete isolated migration chain");
      for (const file of files) {
        await db.query(await readFile("db/migrations/" + file, "utf8"));
        await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
      }
      await db.query("COMMIT");
    } finally {
      await db.end();
    }
    return { connectionString: target.toString(), close };
  } catch (error) {
    await close();
    throw error;
  }
}
