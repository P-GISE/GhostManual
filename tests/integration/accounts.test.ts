import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";

afterAll(async () => {
  await pool.end();
});
it("schema has account tables", async () => {
  const tables = await pool.query<Record<string, unknown>>(
    "SELECT to_regclass('users') AS users, to_regclass('email_verifications') AS verifications, to_regclass('oauth_states') AS states",
  );
  expect(Object.values(tables.rows[0] ?? {})).not.toContain(null);
  const columns = await pool.query<{ name: string }>(
    "SELECT table_name||'.'||column_name AS name FROM information_schema.columns WHERE (table_name,column_name) IN (('workspaces','user_id'),('sessions','user_id'),('shares','link_token'))",
  );
  expect(columns.rows.map((r) => r.name).sort()).toEqual([
    "sessions.user_id",
    "shares.link_token",
    "workspaces.user_id",
  ]);
});
