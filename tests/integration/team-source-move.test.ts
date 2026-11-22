import { createHash, randomBytes } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";

afterAll(() => pool.end());

it("moves history and links atomically and removes only related AI questions", async () => {
  const db = await pool.connect();
  const id = () => crypto.randomUUID();
  const user = id();
  const personal = id();
  const team = id();
  const source = id();
  const rev = id();
  const manual = id();
  const published = id();
  const share = id();
  const linkToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(linkToken).digest("hex");
  const ownerSession = id();
  const ownerBearer = randomBytes(32).toString("base64url");
  const readerSession = id();
  const byEvidence = id();
  const byJson = id();
  const reader = id();
  const unrelated = id();
  const history = id();
  const relatedOperation = id();
  const unrelatedOperation = id();
  const q = (sql: string, ...params: unknown[]) => db.query(sql, params);
  const rows = async (sql: string, ...params: unknown[]) => (await q(sql, ...params)).rows;
  try {
    await q("BEGIN");
    expect(
      await rows(
        "SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid='move_personal_source(uuid,uuid,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",
      ),
    ).toEqual([]);
    await q(
      "INSERT INTO users(id,email,name,password_hash,terms_agreed_at) VALUES($1,$2,'Synthetic','fixture',now())",
      user,
      `${user}@example.test`,
    );
    await q("INSERT INTO workspaces(id,mode,user_id) VALUES($1,'blank',$2)", personal, user);
    await q(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','Synthetic team','infinity')",
      team,
    );
    await q(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
      team,
      user,
    );
    await q(
      "INSERT INTO sources(id,workspace_id,revision,kind,file_type,created_by) VALUES($1,$2,1,'file','xlsx',$3)",
      source,
      personal,
      user,
    );
    await q(
      "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,1,'Synthetic','Synthetic text')",
      rev,
      personal,
      source,
    );
    await q(
      "INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status) VALUES($1,$2,'example.xlsx',3,repeat('0',64),decode('0001ff','hex'),'limit_exceeded')",
      rev,
      personal,
    );
    await q(
      "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,question,answer,answered_at) VALUES($1,$2,$3,0,'purpose','Why?','For testing',now())",
      history,
      personal,
      rev,
    );
    await q(
      "INSERT INTO manuals(id,workspace_id,source_id,source_revision_id,draft,published_version,provenance) VALUES($1,$2,$3,$4,'{}',NULL,'human')",
      manual,
      personal,
      source,
      rev,
    );
    await q(
      "INSERT INTO manual_versions(id,workspace_id,manual_id,version,source_revision_id,content,provenance,acknowledged_unknowns) VALUES($1,$2,$3,1,$4,'{}','human','[]')",
      published,
      personal,
      manual,
      rev,
    );
    await q("UPDATE manuals SET published_version=1 WHERE id=$1", manual);
    await q(
      "INSERT INTO shares(id,workspace_id,manual_id,token_hash,link_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')",
      share,
      personal,
      manual,
      tokenHash,
      linkToken,
    );
    await q(
      "INSERT INTO sessions(id,workspace_id,user_id,token_hash,role,share_id,expires_at) VALUES($1,$3,$4,$5,'owner',NULL,now()+interval '1 day'),($2,$3,$4,$6,'reader',$7,now()+interval '1 day')",
      ownerSession,
      readerSession,
      personal,
      user,
      createHash("sha256").update(ownerBearer).digest("hex"),
      readerSession,
      share,
    );
    for (const [question, session, result] of [
      [byEvidence, ownerSession, {}],
      [byJson, ownerSession, { searchResults: [{ sourceId: source }] }],
      [reader, readerSession, {}],
      [unrelated, ownerSession, {}],
    ] as const) {
      await q(
        "INSERT INTO question_runs(id,workspace_id,session_id,question,result) VALUES($1,$2,$3,'Fixture',$4)",
        question,
        personal,
        session,
        result,
      );
    }
    await q(
      "INSERT INTO evidence(id,workspace_id,question_id,manual_id,manual_version_id,source_id,source_revision_id,paragraph_id,quote,kind) VALUES($1,$2,$3,$4,$5,$6,$7,'p1','Fixture','source')",
      id(),
      personal,
      byEvidence,
      manual,
      published,
      source,
      rev,
    );
    for (const [operation, question] of [
      [relatedOperation, byJson],
      [unrelatedOperation, unrelated],
    ]) {
      await q(
        "INSERT INTO operation_requests(id,workspace_id,session_id,key,payload_hash,kind,status,result,lease_until) VALUES($1,$2,$3,$4,'fixture','question','complete',$5,now())",
        operation,
        personal,
        ownerSession,
        operation,
        { id: question },
      );
    }
    const operations = () =>
      rows("SELECT id FROM operation_requests WHERE workspace_id=$1 ORDER BY id", personal);
    const originalOperations = await operations();
    const snapshots = async () =>
      (
        await rows(
          "SELECT to_jsonb(f)-'workspace_id' AS file,to_jsonb(r)-'workspace_id' AS revision,to_jsonb(h)-'workspace_id' AS history,to_jsonb(v)-'workspace_id' AS published,to_jsonb(sh)-'workspace_id' AS share FROM source_files f JOIN source_revisions r ON r.id=f.revision_id JOIN revision_questions h ON h.revision_id=r.id JOIN manual_versions v ON v.source_revision_id=r.id JOIN shares sh ON sh.manual_id=v.manual_id WHERE f.revision_id=$1",
          rev,
        )
      )[0];
    await q(
      "UPDATE revision_questions SET followup_checked_at=now(),followup_question='구체적인 이유는?',followup_answer='합성 후속 답',followup_answered_at=now() WHERE id=$1",
      history,
    );
    const before = await snapshots();
    expect(before).toBeDefined();
    const questions = () =>
      rows("SELECT id FROM question_runs WHERE workspace_id=$1 ORDER BY id", personal);
    const originalQuestions = await questions();
    const move = () =>
      q("SELECT move_personal_source_for_session($1,$2,$3)", ownerBearer, source, team);
    await q("SAVEPOINT unauthorized");
    await expect(
      q("SELECT move_personal_source($1,$2,$3)", id(), source, team),
    ).rejects.toMatchObject({ code: "42501" });
    await q("ROLLBACK TO SAVEPOINT unauthorized");
    expect(await questions()).toEqual(originalQuestions);

    await q("SAVEPOINT pending");
    await q("UPDATE operation_requests SET status='processing' WHERE id=$1", unrelatedOperation);
    await expect(move()).rejects.toMatchObject({ code: "55000" });
    await q("ROLLBACK TO SAVEPOINT pending");
    expect(await operations()).toEqual(originalOperations);

    await q("SAVEPOINT before_failure");
    await q(
      "CREATE FUNCTION pg_temp.reject_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejects move'; END $$",
    );
    await q(
      "CREATE TRIGGER fixture_reject_move BEFORE UPDATE OF workspace_id ON shares FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_move()",
    );
    await expect(move()).rejects.toThrow("fixture rejects move");
    await q("ROLLBACK TO SAVEPOINT before_failure");
    expect(await questions()).toEqual(originalQuestions);
    expect(await operations()).toEqual(originalOperations);
    expect(await snapshots()).toEqual(before);
    expect(await rows("SELECT workspace_id FROM sources WHERE id=$1", source)).toEqual([
      { workspace_id: personal },
    ]);

    await move();
    await q("SET CONSTRAINTS ALL IMMEDIATE");
    expect(await operations()).toEqual([{ id: unrelatedOperation }]);
    expect(await snapshots()).toEqual(before);
    expect(await rows("SELECT workspace_id FROM sources WHERE id=$1", source)).toEqual([
      { workspace_id: team },
    ]);
    expect(
      await rows("SELECT workspace_id FROM shares WHERE id=$1 AND link_token=$2", share, linkToken),
    ).toEqual([{ workspace_id: team }]);
    const reissued = await rows(
      "INSERT INTO sessions(id,workspace_id,user_id,token_hash,role,share_id,expires_at) SELECT $1,sh.workspace_id,$2,$3,'reader',sh.id,LEAST(sh.expires_at,w.expires_at,now()+interval '30 days') FROM shares sh JOIN workspaces w ON w.id=sh.workspace_id JOIN manuals m ON m.id=sh.manual_id WHERE sh.token_hash=$4 AND sh.revoked_at IS NULL AND sh.expires_at>now() AND w.expires_at>now() AND m.published_version IS NOT NULL AND m.needs_review=false RETURNING workspace_id,share_id",
      id(),
      user,
      id(),
      tokenHash,
    );
    expect(reissued).toEqual([{ workspace_id: team, share_id: share }]);
    expect(
      await rows("SELECT id FROM question_runs WHERE id=ANY($1::uuid[])", [
        byEvidence,
        byJson,
        reader,
        unrelated,
      ]),
    ).toEqual([{ id: unrelated }]);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
