import { pool } from "../src/lib/db.ts";
import { seedExample } from "../src/lib/seed.ts";
import { createWorkspace, requireSession } from "../src/lib/session.ts";

try {
  const session = await createWorkspace("example");
  const manual = await seedExample(await requireSession(session.token));
  console.log(
    "사전 작성 예시 저장: " + manual.id + " (브라우저에서는 예시 시작 버튼을 사용하세요)",
  );
} finally {
  await pool.end();
}
