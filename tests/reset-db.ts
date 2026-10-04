import pg from "pg";

export default async function resetTestCounters(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString)
    throw new Error("DATABASE_URL must explicitly identify a dedicated _test database");
  const target = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !/^\/[A-Za-z0-9_-]+_test$/.test(target.pathname)
  )
    throw new Error("Counter reset is restricted to a dedicated _test database");
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await pool.query("TRUNCATE usage_counters, rate_counters");
  } finally {
    await pool.end();
  }
}
