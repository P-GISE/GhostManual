import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource, getSource, updateSource } from "../../src/lib/sources.ts";

beforeAll(async () => {
  expect((await pool.query("select 1 as ready")).rows[0]).toEqual({ ready: 1 });
});
afterAll(async () => {
  await pool.end();
});
const input = { title: "계정 발급", text: "승인 후 업무 계정을 발급합니다. ".repeat(12) };
it("persists immutable source revisions across session lookup", async () => {
  const session = await createWorkspace();
  const owner = await requireSession(session.token);
  const source = await createSource(owner, input);
  expect((await getSource(await requireSession(session.token), source.id)).revision).toBe(1);
  const changed = await updateSource(
    owner,
    source.id,
    { ...input, text: "새 절차입니다. ".repeat(20) },
    1,
  );
  expect(changed.revision).toBe(2);
  expect((await getSource(owner, source.id, 1)).text).toBe(input.text.trim());
  await expect(
    pool.query("update source_revisions set text='changed' where source_id=$1", [source.id]),
  ).rejects.toThrow();
});
it("rejects other workspace and stale revisions", async () => {
  const owner = await requireSession((await createWorkspace()).token),
    other = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, input);
  await expect(getSource(other, source.id)).rejects.toMatchObject({ httpStatus: 404 });
  await expect(updateSource(owner, source.id, input, 0)).rejects.toMatchObject({ httpStatus: 409 });
  await expect(
    pool.query(
      "insert into source_revisions(id,workspace_id,source_id,revision,title,text) values(gen_random_uuid(),$1,$2,2,'x',$3)",
      [other.workspaceId, source.id, input.text],
    ),
  ).rejects.toThrow();
});
it("stores hashes only and rejects expired sessions", async () => {
  const session = await createWorkspace();
  const owner = await requireSession(session.token);
  const row = (await pool.query("select token_hash from sessions where id=$1", [owner.sessionId]))
    .rows[0];
  expect(row.token_hash).not.toBe(session.token);
  await pool.query("update workspaces set expires_at=now()-interval '1 second' where id=$1", [
    owner.workspaceId,
  ]);
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
});
