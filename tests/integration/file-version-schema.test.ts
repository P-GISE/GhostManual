import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const db = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
const workspace = randomUUID();
const source = randomUUID();
const revision = randomUUID();
const group = randomUUID();
const question = randomUUID();
const snapshot = { v: 1, sheets: [], names: [] };

beforeAll(async () => {
  await db.connect();
  await db.query("BEGIN");
  const schema = `xlsx_schema_${randomUUID().replaceAll("-", "")}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}, public`);
  for (const name of [
    "001_initial.sql",
    "002_accounts.sql",
    "003_password_resets.sql",
    "004_terms_consent.sql",
  ]) {
    await db.query(await readFile(`db/migrations/${name}`, "utf8"));
  }
  await db.query("INSERT INTO workspaces(id,mode) VALUES($1,'empty')", [workspace]);
  await db.query("INSERT INTO sources(id,workspace_id,revision) VALUES($1,$2,1)", [
    source,
    workspace,
  ]);
  await db.query(
    "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,1,'합성 자료',repeat('가',100))",
    [revision, workspace, source],
  );
  await db.query(await readFile("db/migrations/005_file_versions.sql", "utf8"));
});
beforeEach(async () => {
  await db.query("SAVEPOINT test_case");
});
afterEach(async () => {
  await db.query("ROLLBACK TO SAVEPOINT test_case");
});
afterAll(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

async function rejectsSql(sql: string, values: unknown[], code: string) {
  await db.query("SAVEPOINT expected_rejection");
  try {
    await expect(db.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT expected_rejection");
  }
}

async function seedFile() {
  await db.query("UPDATE sources SET kind='file',file_type='xlsx' WHERE id=$1", [source]);
  await db.query(
    "INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status,snapshot) VALUES($1,$2,'synthetic.xlsx',3,repeat('a',64),$3,'compared',$4)",
    [revision, workspace, Buffer.from([1, 2, 3]), snapshot],
  );
  await db.query(
    "INSERT INTO change_groups(id,workspace_id,revision_id,position,kind,summary) VALUES($1,$2,$3,0,'values_changed','{}')",
    [group, workspace, revision],
  );
}

it("preserves existing text data and defaults while allowing a short file summary", async () => {
  const old = await db.query<{ kind: string; text: string }>(
    "SELECT s.kind,r.text FROM sources s JOIN source_revisions r ON r.source_id=s.id WHERE s.id=$1",
    [source],
  );
  expect(old.rows).toEqual([{ kind: "text", text: "가".repeat(100) }]);
  await db.query(
    "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,2,'합성 자료','짧은 요약')",
    [randomUUID(), workspace, source],
  );
  await rejectsSql(
    "INSERT INTO sources(id,workspace_id,revision,kind) VALUES($1,$2,1,'file')",
    [randomUUID(), workspace],
    "23514",
  );
  await rejectsSql(
    "INSERT INTO users(id,email,name,password_hash,department) VALUES($1,'schema@example.invalid','합성 사용자','test-only',repeat('가',41))",
    [randomUUID()],
    "23514",
  );
});

it("rejects falsified byte counts and files over 5 MiB", async () => {
  const sql =
    "INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status) VALUES($1,$2,'synthetic.xlsx',$3,repeat('a',64),$4,'limit_exceeded')";
  await rejectsSql(sql, [revision, workspace, 1, Buffer.from([1, 2])], "23514");
  await rejectsSql(sql, [revision, workspace, 5242881, Buffer.alloc(5242881)], "23514");
  await db.query(sql, [revision, workspace, 5242880, Buffer.alloc(5242880)]);
  const result = await db.query<{ size_bytes: number; bytes: number }>(
    "SELECT size_bytes,octet_length(content) AS bytes FROM source_files",
  );
  expect(result.rows).toEqual([{ size_bytes: 5242880, bytes: 5242880 }]);
});

it("rejects another workspace's revision and malformed snapshot envelopes", async () => {
  const otherWorkspace = randomUUID();
  await db.query("INSERT INTO workspaces(id,mode) VALUES($1,'empty')", [otherWorkspace]);
  const sql =
    "INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status,snapshot) VALUES($1,$2,'synthetic.xlsx',1,repeat('a',64),$3,'compared',$4)";
  await rejectsSql(sql, [revision, otherWorkspace, Buffer.from([1]), snapshot], "23503");
  for (const invalid of [null, [], {}, { v: 1, sheets: {}, names: [] }]) {
    await rejectsSql(
      sql,
      [revision, workspace, Buffer.from([1]), JSON.stringify(invalid)],
      "23514",
    );
  }
});

it("keeps file bytes and change groups immutable", async () => {
  await seedFile();
  await rejectsSql("UPDATE source_files SET file_name='changed.xlsx'", [], "P0001");
  await rejectsSql("UPDATE change_groups SET summary='{}'", [], "P0001");
});

it("requires question positions to belong to the same revision", async () => {
  await seedFile();
  const sql =
    "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,group_positions,question) VALUES($1,$2,$3,0,'change',$4,'어떤 변경인가요?')";
  await rejectsSql(sql, [question, workspace, revision, [1]], "23514");
  await rejectsSql(sql, [question, workspace, revision, [null]], "23514");
  const secondRevision = randomUUID();
  await db.query(
    "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,2,'합성 자료','요약')",
    [secondRevision, workspace, source],
  );
  await rejectsSql(sql, [question, workspace, secondRevision, [0]], "23514");
  await db.query(sql, [question, workspace, revision, [0]]);
});

it("allows answer correction and skipping without allowing question identity changes", async () => {
  await seedFile();
  await db.query(
    "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,group_positions,question) VALUES($1,$2,$3,0,'change','{0}','어떤 변경인가요?')",
    [question, workspace, revision],
  );
  await db.query("UPDATE revision_questions SET answer='합성 답변',answered_at=now()");
  await db.query("UPDATE revision_questions SET answer='고친 답변'");
  await rejectsSql("UPDATE revision_questions SET skipped=true", [], "23514");
  await db.query("UPDATE revision_questions SET answer=NULL,skipped=true,answered_at=now()");
  const result = await db.query<{ answer: string | null; skipped: boolean }>(
    "SELECT answer,skipped FROM revision_questions",
  );
  expect(result.rows).toEqual([{ answer: null, skipped: true }]);
  await rejectsSql("UPDATE revision_questions SET question='바뀐 질문'", [], "23514");
  await rejectsSql("UPDATE revision_questions SET group_positions='{}'", [], "23514");
});

it("validates and freezes the published history envelope", async () => {
  const manual = randomUUID();
  await db.query(
    "INSERT INTO manuals(id,workspace_id,source_id,source_revision_id,draft,provenance) VALUES($1,$2,$3,$4,'{}','human')",
    [manual, workspace, source, revision],
  );
  const sql =
    "INSERT INTO manual_versions(id,workspace_id,manual_id,version,source_revision_id,content,provenance,acknowledged_unknowns,history) VALUES($1,$2,$3,1,$4,'{}','human','[]',$5)";
  await rejectsSql(sql, [randomUUID(), workspace, manual, revision, JSON.stringify([])], "23514");
  await db.query(sql, [randomUUID(), workspace, manual, revision, { v: 1, revisions: [] }]);
  await rejectsSql("UPDATE manual_versions SET history=NULL", [], "P0001");
});

it("deletes files, changes and questions with their source", async () => {
  await seedFile();
  await db.query(
    "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,group_positions,question) VALUES($1,$2,$3,0,'change','{0}','어떤 변경인가요?')",
    [question, workspace, revision],
  );
  await db.query("DELETE FROM sources WHERE id=$1", [source]);
  const result = await db.query<{ files: string; groups: string; questions: string }>(
    "SELECT (SELECT count(*) FROM source_files) AS files,(SELECT count(*) FROM change_groups) AS groups,(SELECT count(*) FROM revision_questions) AS questions",
  );
  expect(result.rows).toEqual([{ files: "0", groups: "0", questions: "0" }]);
});
