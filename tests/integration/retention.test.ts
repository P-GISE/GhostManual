import { afterAll, expect, it } from "vitest";
import { ask, getQuestion } from "../../src/lib/answers.ts";
import { pool } from "../../src/lib/db.ts";
import { cleanupExpired, deleteSource, deleteWorkspace } from "../../src/lib/retention.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";

afterAll(async () => {
  await pool.end();
});
it("removes workspace content and operations while retaining usage", async () => {
  const session = await createWorkspace();
  const owner = await requireSession(session.token);
  await createSource(owner, { title: "업무", text: "승인 후 발급합니다. ".repeat(20) });
  await pool.query(
    "INSERT INTO usage_counters(day,scope,kind,attempts) VALUES(current_date,$1,'question',3)",
    [owner.workspaceId],
  );
  await pool.query(
    "INSERT INTO operation_requests(id,workspace_id,session_id,key,payload_hash,kind,status,lease_until,result) VALUES(gen_random_uuid(),$1,$2,'retention','hash','question','complete',now(),'{\"personal\":true}')",
    [owner.workspaceId, owner.sessionId],
  );
  await deleteWorkspace(owner);
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM operation_requests WHERE workspace_id=$1",
        [owner.workspaceId],
      )
    ).rows[0],
  ).toEqual({ count: 0 });
  expect(
    (await pool.query("SELECT attempts FROM usage_counters WHERE scope=$1", [owner.workspaceId]))
      .rows[0],
  ).toEqual({ attempts: 3 });
});
it("deletes owned source and rejects foreign deletion", async () => {
  const owner = await requireSession((await createWorkspace()).token);
  const other = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, {
    title: "업무",
    text: "승인 후 발급합니다. ".repeat(20),
  });
  await expect(deleteSource(other, source.id)).rejects.toMatchObject({ httpStatus: 404 });
  await deleteSource(owner, source.id);
  await expect(getSource(owner, source.id)).rejects.toMatchObject({ httpStatus: 404 });
});
it("cleans expired workspace once", async () => {
  const session = await createWorkspace();
  await pool.query("UPDATE workspaces SET expires_at=now()-interval '1 second' WHERE id=$1", [
    session.workspaceId,
  ]);
  await cleanupExpired(new Date());
  expect(
    (
      await pool.query("SELECT count(*)::int AS count FROM workspaces WHERE id=$1", [
        session.workspaceId,
      ])
    ).rows[0],
  ).toEqual({ count: 0 });
  expect((await cleanupExpired(new Date())).workspaces).toBe(0);
});

import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { shareWithNewReader } from "./mail-helper.ts";

it("deletes published source with evidence and reader questions without FK failures", async () => {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  const version = await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  const session = await shareWithNewReader(owner, manual.id);
  const questionId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO question_runs(id,workspace_id,session_id,question,result) VALUES($1,$2,$3,'합성 질문','{}')",
    [questionId, owner.workspaceId, session.sessionId],
  );
  await pool.query(
    "INSERT INTO evidence(id,workspace_id,question_id,manual_id,manual_version_id,source_id,source_revision_id,paragraph_id,quote,kind) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'p1','합성 근거','source')",
    [owner.workspaceId, questionId, manual.id, version.id, source.id, source.revisionId],
  );
  await deleteSource(owner, source.id);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM question_runs WHERE id=$1", [questionId]))
      .rows[0],
  ).toEqual({ count: 0 });
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
});
it("deletes workspace containing reviewed snapshots", async () => {
  const session = await createWorkspace();
  const owner = await requireSession(session.token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  const reader = await shareWithNewReader(owner, manual.id);
  await deleteWorkspace(owner);
  await expect(requireSession(reader.token)).rejects.toMatchObject({ httpStatus: 401 });
  expect(
    (
      await pool.query("SELECT count(*)::int AS count FROM manual_versions WHERE workspace_id=$1", [
        owner.workspaceId,
      ])
    ).rows[0],
  ).toEqual({ count: 0 });
});

it("removes unavailable search snapshots for deleted source while preserving unrelated answers", async () => {
  // Given: two reviewed sources and saved search-only responses, without evidence rows.
  process.env["AI_ENABLED"] = "false";
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  const unrelated = await createSource(owner, exampleSource);
  const otherManual = await saveDraft(owner, unrelated.revisionId, exampleDraft);
  await publishManual(owner, otherManual.id, 1, exampleDraft.unknowns);
  const answer = await ask(
    owner,
    { question: "업무 계정 발급", manualId: manual.id },
    "deleted-source-search",
  );
  const otherAnswer = await ask(
    owner,
    { question: "업무 계정 발급", manualId: otherManual.id },
    "retained-source-search",
  );
  expect(answer.status).toBe("unavailable");
  expect(answer.evidence).toEqual([]);
  expect(answer.searchResults.some((item) => item.sourceId === source.id)).toBe(true);
  // When: the owner deletes the source.
  await deleteSource(owner, source.id);
  // Then: the old result cannot expose removed text; unrelated source results remain readable.
  await expect(getQuestion(owner, answer.id)).rejects.toMatchObject({ code: "not_found" });
  expect((await getQuestion(owner, otherAnswer.id)).id).toBe(otherAnswer.id);
});
