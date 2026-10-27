import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource, updateSource } from "../../src/lib/sources.ts";
import { newId } from "../../src/lib/types.ts";

afterAll(async () => pool.end());
const input = { title: "합성 자료", text: "가".repeat(100) };
async function seed(workspace: string, count: number, text = "x".repeat(100)) {
  await pool.query(
    "WITH added AS (INSERT INTO sources(id,workspace_id,revision) SELECT gen_random_uuid(),$1,1 FROM generate_series(1,$2) RETURNING id) INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,created_at) SELECT gen_random_uuid(),$1,id,1,'fixture',$3,now()-interval '2 minutes' FROM added",
    [workspace, count, text],
  );
}
it("serializes concurrent creates at the workspace source ceiling", async () => {
  const ctx = await requireSession((await createWorkspace()).token);
  await seed(ctx.workspaceId, 49);
  const results = await Promise.allSettled([createSource(ctx, input), createSource(ctx, input)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    Number(
      (await pool.query("SELECT count(*) FROM sources WHERE workspace_id=$1", [ctx.workspaceId]))
        .rows[0].count,
    ),
  ).toBe(50);
});
it("counts UTF-8 bytes of all immutable revisions, not just current characters", async () => {
  const ctx = await requireSession((await createWorkspace()).token);
  await seed(ctx.workspaceId, 35, "가".repeat(20000));
  await expect(createSource(ctx, input)).rejects.toMatchObject({
    code: "storage_quota",
    httpStatus: 429,
  });
});
it("limits cumulative revisions without replacing historical snapshots", async () => {
  const ctx = await requireSession((await createWorkspace()).token),
    id = newId();
  await pool.query("INSERT INTO sources(id,workspace_id,revision) VALUES($1,$2,200)", [
    id,
    ctx.workspaceId,
  ]);
  await pool.query(
    "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,created_at) SELECT gen_random_uuid(),$1,$2,n,'fixture',repeat('x',100),now()-interval '2 minutes' FROM generate_series(1,200) n",
    [ctx.workspaceId, id],
  );
  await expect(updateSource(ctx, id, input, 200)).rejects.toMatchObject({
    code: "storage_quota",
    httpStatus: 429,
  });
  expect(
    Number(
      (await pool.query("SELECT count(*) FROM source_revisions WHERE source_id=$1", [id])).rows[0]
        .count,
    ),
  ).toBe(200);
});
it("applies one write window across create and update, preserving the last revision", async () => {
  const ctx = await requireSession((await createWorkspace()).token);
  const source = await createSource(ctx, input);
  for (let revision = 1; revision < 20; revision++)
    await updateSource(ctx, source.id, input, revision);
  await expect(createSource(ctx, input)).rejects.toMatchObject({
    code: "source_write_limit",
    httpStatus: 429,
  });
  await expect(updateSource(ctx, source.id, input, 20)).rejects.toMatchObject({
    code: "source_write_limit",
    httpStatus: 429,
  });
});
