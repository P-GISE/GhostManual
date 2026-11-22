import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";

afterAll(() => pool.end());

it("upgrades old rows and enforces one-time judgement without breaking parent edits", async () => {
  const db = await pool.connect();
  const schema = "followup_upgrade_" + randomUUID().replaceAll("-", "");
  const workspace = randomUUID(),
    source = randomUUID(),
    revision = randomUUID(),
    question = randomUUID();
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}, public`);
    for (const file of [
      "001_initial.sql",
      "002_accounts.sql",
      "003_password_resets.sql",
      "004_terms_consent.sql",
      "005_file_versions.sql",
      "006_admin.sql",
      "007_document_formats.sql",
      "008_manual_templates.sql",
      "009_team_library.sql",
      "010_team_source_move.sql",
      "011_authenticated_source_move.sql",
    ])
      await db.query(await readFile("db/migrations/" + file, "utf8"));
    await db.query("INSERT INTO workspaces(id,mode) VALUES($1,'blank')", [workspace]);
    await db.query(
      "INSERT INTO sources(id,workspace_id,revision,kind,file_type) VALUES($1,$2,1,'file','xlsx')",
      [source, workspace],
    );
    await db.query(
      "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,1,'합성 자료',repeat('가',100))",
      [revision, workspace, source],
    );
    await db.query(
      "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,question,answer,answered_at) VALUES($1,$2,$3,0,'purpose','업무 목적은?','기존 답변',now())",
      [question, workspace, revision],
    );
    const before = (
      await db.query("SELECT to_jsonb(q) AS data FROM revision_questions q WHERE id=$1", [question])
    ).rows[0].data;
    await db.query(await readFile("db/migrations/012_author_followup.sql", "utf8"));
    const row = (await db.query("SELECT * FROM revision_questions WHERE id=$1", [question]))
      .rows[0];
    expect(row).toMatchObject({
      followup_checked_at: null,
      followup_question: null,
      followup_answer: null,
      followup_skipped: false,
      followup_answered_at: null,
    });
    const original = (
      await db.query(
        "SELECT to_jsonb(q)-ARRAY['followup_checked_at','followup_question','followup_answer','followup_skipped','followup_answered_at'] AS data FROM revision_questions q WHERE id=$1",
        [question],
      )
    ).rows[0].data;
    expect(original).toEqual(before);
    const reject = async (change: string) => {
      await db.query("SAVEPOINT invalid_followup");
      try {
        await expect(
          db.query("UPDATE revision_questions SET " + change + " WHERE id=$1", [question]),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT invalid_followup");
      }
    };
    await reject("followup_question='추가 질문'");
    await reject("followup_answer='추가 답변',followup_answered_at=now()");
    await reject("followup_skipped=true,followup_answered_at=now()");
    await reject("answer=NULL,skipped=true,followup_checked_at=now()");
    await reject("followup_checked_at=now(),followup_question=repeat('가',501)");
    await db.query(
      "UPDATE revision_questions SET followup_checked_at=now(),followup_question='구체적인 이유는?' WHERE id=$1",
      [question],
    );
    await reject("followup_question='다시 묻기'");
    await reject("followup_checked_at=NULL,followup_question=NULL");
    await reject("followup_checked_at=followup_checked_at+interval '1 second'");
    await reject("followup_answer='답변',followup_skipped=true,followup_answered_at=now()");
    await reject("followup_answer='답변'");
    await reject("followup_answered_at=now()");
    await reject("followup_answer=repeat('가',2001),followup_answered_at=now()");
    await db.query(
      "UPDATE revision_questions SET followup_answer='최초 답변',followup_answered_at=now() WHERE id=$1",
      [question],
    );
    await db.query(
      "UPDATE revision_questions SET answer='원래 답 수정',followup_answer='후속 답 수정',followup_answered_at=now() WHERE id=$1",
      [question],
    );
    await db.query(
      "UPDATE revision_questions SET answer=NULL,skipped=true,followup_answer=NULL,followup_skipped=true,followup_answered_at=now() WHERE id=$1",
      [question],
    );
    expect(
      (
        await db.query(
          "SELECT followup_question,followup_skipped FROM revision_questions WHERE id=$1",
          [question],
        )
      ).rows[0],
    ).toEqual({ followup_question: "구체적인 이유는?", followup_skipped: true });

    const sufficient = randomUUID();
    await db.query(
      "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,question,answer,answered_at,followup_checked_at) VALUES($1,$2,$3,1,'origin','자료 출처는?','충분한 답변',now(),now())",
      [sufficient, workspace, revision],
    );
    await db.query("SAVEPOINT sufficient");
    await expect(
      db.query("UPDATE revision_questions SET followup_question='나중에 다시 질문' WHERE id=$1", [
        sufficient,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query("ROLLBACK TO SAVEPOINT sufficient");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
