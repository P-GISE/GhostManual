import { pool } from "../src/lib/db.ts";
import { cleanupExpired } from "../src/lib/retention.ts";

try {
  console.log(JSON.stringify(await cleanupExpired(new Date())));
} finally {
  await pool.end();
}
