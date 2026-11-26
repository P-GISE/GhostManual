import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import { deleteAccount } from "../../src/lib/accounts.ts";
import { pool, transaction } from "../../src/lib/db.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { removeWorkspace } from "../../src/lib/retention.ts";
import { requireSession } from "../../src/lib/session.ts";
import { exchangeShare, getSharing, setSharing } from "../../src/lib/shares.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import { changeRole, createTeam, listWorkspaces, switchWorkspace } from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());
const migration = "db/migrations/013_team_lead_expand.sql";

it("expands a populated 012 database without rewriting personal, team, file, publication or reader rows", async () => {
  const sql = await readFile(migration, "utf8").catch(() => null);
  expect(sql, "013 expand migration must exist").not.toBeNull();
  if (sql === null) return;
  const db = await pool.connect();
  const schema = `lead_expand_${randomUUID().replaceAll("-", "")}`;
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}, public`);
    const files = (await readdir("db/migrations"))
      .filter((name) => /^(00[1-9]|01[0-2])_.*\.sql$/.test(name))
      .sort();
    expect(files).toHaveLength(12);
    for (const file of files) await db.query(await readFile(`db/migrations/${file}`, "utf8"));
    const user = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified_at,terms_agreed_at) VALUES($1,'fixture@example.invalid','합성 담당자','fixture',now(),now())",
      [user],
    );
    for (const team of [false, true]) {
      const workspace = randomUUID(),
        source = randomUUID(),
        revision = randomUUID(),
        manual = randomUUID(),
        share = randomUUID();
      await db.query(
        "INSERT INTO workspaces(id,mode,user_id,team_name,expires_at) VALUES($1,'blank',$2,$3,'infinity')",
        [workspace, team ? null : user, team ? "합성 팀" : null],
      );
      if (team)
        await db.query(
          "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
          [workspace, user],
        );
      await db.query(
        "INSERT INTO sources(id,workspace_id,revision,kind,file_type,created_by) VALUES($1,$2,1,'file','xlsx',$3)",
        [source, workspace, user],
      );
      await db.query(
        "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,1,'합성 원본','보존할 원문')",
        [revision, workspace, source],
      );
      const bytes = Buffer.from("synthetic bytes");
      await db.query(
        `INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status,snapshot) VALUES($1,$2,'fixture.xlsx',$3,$4,$5,'compared','{"v":1,"sheets":[],"names":[]}')`,
        [
          revision,
          workspace,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          bytes,
        ],
      );
      await db.query(
        "INSERT INTO manuals(id,workspace_id,source_id,source_revision_id,draft,provenance) VALUES($1,$2,$3,$4,'{}','human')",
        [manual, workspace, source, revision],
      );
      await db.query(
        "INSERT INTO manual_versions(id,workspace_id,manual_id,version,source_revision_id,content,provenance,acknowledged_unknowns) VALUES($1,$2,$3,1,$4,'{}','human','[]')",
        [randomUUID(), workspace, manual, revision],
      );
      await db.query("UPDATE manuals SET published_version=1 WHERE id=$1", [manual]);
      await db.query(
        "INSERT INTO shares(id,workspace_id,manual_id,token_hash,link_token,expires_at) VALUES($1,$2,$3,$4,$5,'infinity')",
        [share, workspace, manual, randomUUID(), randomUUID()],
      );
      await db.query(
        "INSERT INTO sessions(id,workspace_id,token_hash,role,share_id,user_id,expires_at) VALUES($1,$2,$3,'reader',$4,$5,'infinity')",
        [randomUUID(), workspace, randomUUID(), share, user],
      );
    }
    await db.query("SET CONSTRAINTS ALL IMMEDIATE");
    const snapshot = async () => {
      const rows: Record<string, unknown> = {};
      for (const table of [
        "users",
        "workspaces",
        "workspace_members",
        "sources",
        "source_revisions",
        "source_files",
        "manuals",
        "manual_versions",
        "shares",
        "sessions",
      ])
        rows[table] = (
          await db.query(
            `SELECT to_jsonb(t)-'lead_user_id' AS data FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      return rows;
    };
    const before = await snapshot();
    await db.query(sql);
    expect(await snapshot()).toEqual(before);
    const column = await db.query(
      "SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='workspaces' AND column_name='lead_user_id'",
      [schema],
    );
    expect(column.rows).toEqual([{ data_type: "uuid", is_nullable: "YES", column_default: null }]);
    expect(
      (await db.query("SELECT lead_user_id FROM workspaces")).rows.every(
        (row) => row.lead_user_id === null,
      ),
    ).toBe(true);
    const oldWriter = randomUUID();
    await db.query(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','구버전 생성 팀','infinity')",
      [oldWriter],
    );
    await db.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
      [oldWriter, user],
    );
    expect(
      (await db.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [oldWriter])).rows[0]
        .lead_user_id,
    ).toBeNull();
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

it("keeps legacy create, promotion, account deletion and published sharing behavior while leads are null", async () => {
  const column = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='workspaces' AND column_name='lead_user_id'",
  );
  expect(
    column.rowCount,
    "CI must apply the nullable expansion before legacy compatibility tests",
  ).toBe(1);
  if (!column.rowCount) return;
  const mail = setupFileMail();
  const owner = await signedInUser(mail),
    successor = await signedInUser(mail),
    viewer = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "기존 동작 유지 팀");
  try {
    await pool.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
      [team.id, successor.ctx.userId],
    );
    const actor = await requireSession((await switchWorkspace(owner.token, team.id)).token);
    await changeRole(actor, team.id, successor.ctx.userId ?? "", "admin");
    const next = await requireSession((await switchWorkspace(successor.token, team.id)).token);
    const source = await createSource(actor, exampleSource);
    const manual = await saveDraft(actor, source.revisionId, exampleDraft);
    await publishManual(actor, manual.id, 1, exampleDraft.unknowns);
    const link = await setSharing(actor, manual.id, "link");
    if (link.mode !== "link") throw new Error("Expected link sharing");
    const reader = await requireSession(
      (await exchangeShare(link.url.slice(link.url.indexOf("#") + 1), viewer.ctx)).token,
    );
    await deleteAccount(actor);
    expect((await getSource(next, source.id)).id).toBe(source.id);
    expect((await getManual(reader, manual.id)).id).toBe(manual.id);
    expect(JSON.stringify(await getSharing(next, manual.id)) === JSON.stringify(link)).toBe(true);
    expect(
      (await pool.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [team.id])).rows[0]
        .lead_user_id,
    ).toBeNull();
  } finally {
    await transaction((db) => removeWorkspace(db, team.id));
    for (const account of [owner, successor, viewer]) {
      if ((await pool.query("SELECT id FROM users WHERE id=$1", [account.ctx.userId])).rowCount)
        await deleteAccount(account.ctx);
    }
  }
});

it("keeps workspace lead guidance disabled on 013 even with a valid own lead pointer", async () => {
  expect(
    (await pool.query("SELECT 1 FROM schema_migrations WHERE name='014_team_lead_enforce.sql'"))
      .rowCount,
  ).toBe(0);
  const mail = setupFileMail();
  const owner = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "013 대표 안내 비활성 팀");
  try {
    const expected = [
      { id: owner.ctx.workspaceId, name: null, role: null, lead: false, current: true },
      { id: team.id, name: team.name, role: "admin", lead: false, current: false },
    ];
    expect(await listWorkspaces(owner.ctx)).toEqual(expected);
    await pool.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
      team.id,
      owner.ctx.userId,
    ]);
    expect(
      (await pool.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [team.id])).rows[0]
        .lead_user_id,
    ).toBe(owner.ctx.userId);
    expect(await listWorkspaces(owner.ctx)).toEqual(expected);
  } finally {
    await transaction((db) => removeWorkspace(db, team.id));
    await deleteAccount(owner.ctx);
  }
});
