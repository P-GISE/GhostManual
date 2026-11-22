import { afterAll, expect, it } from "vitest";
import { logout } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { requireSession } from "../../src/lib/session.ts";
import { createTeam, switchWorkspace } from "../../src/lib/teams.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

it("consumes the old switch token once while preserving its session row and questions", async () => {
  const { token, ctx } = await signedInUser(setupFileMail());
  const team = await createTeam(ctx, "전환 테스트");
  const questionId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO question_runs(id,workspace_id,session_id,question,result) VALUES($1,$2,$3,'질문','{}')",
    [questionId, ctx.workspaceId, ctx.sessionId],
  );

  const attempts = await Promise.allSettled([
    switchWorkspace(token, team.id),
    switchWorkspace(token, team.id),
  ]);
  const switched = attempts.filter((attempt) => attempt.status === "fulfilled");
  expect(switched).toHaveLength(1);
  expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
    reason: { httpStatus: 401 },
  });
  const next = switched[0]?.value.token ?? "";
  await expect(requireSession(token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(requireSession(next)).resolves.toMatchObject({ workspaceId: team.id });

  await logout([next]);
  await expect(requireSession(next)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(requireSession(token)).rejects.toMatchObject({ httpStatus: 401 });
  expect(
    (await pool.query("SELECT session_id FROM question_runs WHERE id=$1", [questionId])).rows,
  ).toEqual([{ session_id: ctx.sessionId }]);
});
