import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, it } from "vitest";
import { removeWorkspace } from "../../src/lib/retention.ts";
import { isolatedDatabase } from "../isolated-database.ts";

const migration = "014_team_lead_enforce.sql";
const sql = await readFile("db/migrations/" + migration, "utf8").catch(() => null);
async function fixture() {
  const isolated = await isolatedDatabase(13);
  const db = new pg.Pool({ connectionString: isolated.connectionString, max: 5 });
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort();
  const ids = {
    team: randomUUID(),
    preserved: randomUUID(),
    other: randomUUID(),
    personal: randomUUID(),
    source: randomUUID(),
    revision: randomUUID(),
    manual: randomUUID(),
    version: randomUUID(),
    share: randomUUID(),
    reader: randomUUID(),
  };
  const setup = await db.connect();
  try {
    await setup.query("BEGIN");
    for (const user of users)
      await setup.query(
        "INSERT INTO users(id,email,name,password_hash,terms_agreed_at) VALUES($1,$2,'합성','fixture',now())",
        [user, user + "@example.invalid"],
      );
    await setup.query(
      "INSERT INTO workspaces(id,mode,user_id,expires_at) VALUES($1,'blank',$2,'infinity')",
      [ids.personal, users[0]],
    );
    for (const id of [ids.team, ids.preserved, ids.other]) {
      await setup.query(
        "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','합성 팀','infinity')",
        [id],
      );
      await setup.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES($1,$2,'admin','2026-01-01'),($1,$3,'admin','2026-01-01'),($1,$4,'member','2025-01-01')",
        [id, users[0], users[1], users[2]],
      );
    }
    await setup.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
      ids.preserved,
      users[1],
    ]);
    await setup.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [
      ids.other,
      users[0],
    ]);
    await setup.query(
      "INSERT INTO sources(id,workspace_id,revision,kind,file_type,created_by) VALUES($1,$2,1,'file','xlsx',$3)",
      [ids.source, ids.team, users[0]],
    );
    await setup.query(
      "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,1,'합성 원본',repeat('가',100))",
      [ids.revision, ids.team, ids.source],
    );
    await setup.query(
      "INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status) VALUES($1,$2,'synthetic.xlsx',3,repeat('0',64),decode('0001ff','hex'),'limit_exceeded')",
      [ids.revision, ids.team],
    );
    await setup.query(
      "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,question,answer,answered_at) VALUES($1,$2,$3,0,'purpose','목적?','합성 답',now())",
      [randomUUID(), ids.team, ids.revision],
    );
    await setup.query(
      "INSERT INTO manuals(id,workspace_id,source_id,source_revision_id,draft,provenance) VALUES($1,$2,$3,$4,'{}','human')",
      [ids.manual, ids.team, ids.source, ids.revision],
    );
    await setup.query(
      "INSERT INTO manual_versions(id,workspace_id,manual_id,version,source_revision_id,content,provenance,acknowledged_unknowns) VALUES($1,$2,$3,1,$4,'{}','human','[]')",
      [ids.version, ids.team, ids.manual, ids.revision],
    );
    await setup.query("UPDATE manuals SET published_version=1 WHERE id=$1", [ids.manual]);
    await setup.query(
      "INSERT INTO shares(id,workspace_id,manual_id,token_hash,link_token,expires_at) VALUES($1,$2,$3,$4,$5,'infinity')",
      [ids.share, ids.team, ids.manual, randomUUID(), randomUUID()],
    );
    await setup.query(
      "INSERT INTO sessions(id,workspace_id,token_hash,role,share_id,user_id,expires_at) VALUES($1,$2,$3,'reader',$4,$5,'infinity')",
      [ids.reader, ids.team, randomUUID(), ids.share, users[2]],
    );
    await setup.query("COMMIT");
  } catch (error) {
    await setup.query("ROLLBACK");
    setup.release();
    await db.end();
    await isolated.close();
    throw error;
  }
  setup.release();
  return {
    db,
    ids,
    users,
    close: async () => {
      await db.end();
      await isolated.close();
    },
  };
}
async function snapshot(db: pg.Pool) {
  const tables = [
    "users",
    "workspaces",
    "workspace_members",
    "sources",
    "source_revisions",
    "source_files",
    "revision_questions",
    "manuals",
    "manual_versions",
    "shares",
    "sessions",
  ];
  return Promise.all(
    tables.map(
      async (table) =>
        (
          await db.query(
            `SELECT to_jsonb(t)-'lead_user_id' AS row FROM ${table} t ORDER BY (to_jsonb(t)-'lead_user_id')::text`,
          )
        ).rows,
    ),
  );
}
async function enforce(db: pg.Pool) {
  expect(sql, "actual 014 migration must exist").not.toBeNull();
  if (!sql) throw new Error("missing actual 014 migration");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [migration]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

it("backfills NULL leads deterministically while preserving valid non-NULL leads and every business row", async () => {
  expect(sql).not.toBeNull();
  if (!sql) return;
  const f = await fixture();
  try {
    const before = await snapshot(f.db);
    await enforce(f.db);
    expect(await snapshot(f.db)).toEqual(before);
    expect(
      (await f.db.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [f.ids.team])).rows[0]
        ?.lead_user_id,
    ).toBe(f.users[0]);
    expect(
      (await f.db.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [f.ids.preserved]))
        .rows[0]?.lead_user_id,
    ).toBe(f.users[1]);
    expect(
      (await f.db.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [f.ids.personal]))
        .rows[0]?.lead_user_id,
    ).toBeNull();
    const fk = await f.db.query(
      "SELECT condeferrable,condeferred,confdeltype,confupdtype FROM pg_constraint WHERE conname='team_lead_membership_fk'",
    );
    expect(fk.rows).toEqual([
      { condeferrable: true, condeferred: true, confdeltype: "a", confupdtype: "a" },
    ]);
  } finally {
    await f.close();
  }
});

for (const invalid of ["no-admin", "foreign-lead", "member-lead", "personal-lead"] as const)
  it(
    "aborts the entire upgrade for " + invalid + " without silently fixing identities",
    async () => {
      expect(sql).not.toBeNull();
      if (!sql) return;
      const f = await fixture();
      try {
        if (invalid === "no-admin")
          await f.db.query("UPDATE workspace_members SET role='member' WHERE workspace_id=$1", [
            f.ids.other,
          ]);
        else
          await f.db.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
            invalid === "personal-lead" ? f.ids.personal : f.ids.team,
            invalid === "foreign-lead" ? f.users[3] : f.users[2],
          ]);
        const before = await snapshot(f.db);
        await expect(enforce(f.db)).rejects.toMatchObject({ code: "23514" });
        await f.db.query("ROLLBACK");
        expect(await snapshot(f.db)).toEqual(before);
        expect(
          (await f.db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [migration])).rowCount,
        ).toBe(0);
        expect(
          (await f.db.query("SELECT 1 FROM pg_trigger WHERE tgname='team_lead_membership_valid'"))
            .rowCount,
        ).toBe(0);
      } finally {
        await f.db.query("ROLLBACK");
        await f.close();
      }
    },
  );

it("checks final COMMIT state for NULL, foreign/member leads, demotion, removal, member moves and direct user deletion", async () => {
  expect(sql).not.toBeNull();
  if (!sql) return;
  const f = await fixture();
  try {
    await enforce(f.db);
    const before = await snapshot(f.db);
    for (const [query, values] of [
      ["UPDATE workspaces SET lead_user_id=NULL WHERE id=$1", [f.ids.team]],
      ["UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [f.ids.team, randomUUID()]],
      ["UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [f.ids.team, f.users[2]]],
      ["UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [f.ids.personal, f.users[0]]],
      [
        "UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",
        [f.ids.team, f.users[0]],
      ],
      [
        "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
        [f.ids.team, f.users[0]],
      ],
      [
        "UPDATE workspace_members SET workspace_id=$3 WHERE workspace_id=$1 AND user_id=$2",
        [f.ids.team, f.users[0], f.ids.other],
      ],
      ["DELETE FROM users WHERE id=$1", [f.users[0]]],
    ] as const) {
      const client = await f.db.connect();
      try {
        await client.query("BEGIN");
        if (values[0] === f.ids.personal)
          await expect(client.query(query, [...values])).rejects.toMatchObject({ code: "23514" });
        else {
          await client.query(query, [...values]);
          await expect(client.query("COMMIT")).rejects.toMatchObject({
            code: expect.stringMatching(/^235(03|14)$/),
          });
        }
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      expect(await snapshot(f.db)).toEqual(before);
    }
    // A deferred check must inspect the final row, not an earlier NULL event.
    await f.db.query("BEGIN");
    await f.db.query("UPDATE workspaces SET lead_user_id=NULL WHERE id=$1", [f.ids.team]);
    await f.db.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [f.ids.team, f.users[1]]);
    await f.db.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [
      f.ids.team,
      f.users[0],
    ]);
    await f.db.query("COMMIT");
    await f.db.query("DELETE FROM users WHERE id=$1", [f.users[0]]);
    expect(
      (await f.db.query("SELECT content FROM source_files WHERE revision_id=$1", [f.ids.revision]))
        .rows[0]?.content,
    ).toEqual(Buffer.from([0, 1, 255]));
    expect((await f.db.query("SELECT id FROM shares WHERE id=$1", [f.ids.share])).rowCount).toBe(1);
    expect((await f.db.query("SELECT id FROM sessions WHERE id=$1", [f.ids.reader])).rowCount).toBe(
      1,
    );
    const deletion = await f.db.connect();
    try {
      await deletion.query("BEGIN");
      await removeWorkspace(deletion, f.ids.team);
      await deletion.query("COMMIT");
    } finally {
      deletion.release();
    }
    expect(
      (
        await f.db.query("SELECT revision_id FROM source_files WHERE revision_id=$1", [
          f.ids.revision,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await f.db.query("SELECT id FROM workspaces WHERE id=$1", [f.ids.preserved])).rowCount,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

for (const mutation of ["demote", "remove", "delete-user"] as const)
  it("rejects an invalid final state when direct lead transfer races " + mutation, async () => {
    expect(sql).not.toBeNull();
    if (!sql) return;
    const f = await fixture();
    try {
      await enforce(f.db);
      if (mutation === "delete-user") {
        await f.db.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
          f.ids.preserved,
          f.users[0],
        ]);
        await f.db.query(
          "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
          [f.ids.other, f.users[0]],
        );
        await f.db.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
          f.ids.other,
          f.users[0],
        ]);
      }
      const run = async (query: string, values: string[]) => {
        const client = await f.db.connect();
        try {
          await client.query(
            "BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s'",
          );
          await client.query(query, values);
          await new Promise((resolve) => setTimeout(resolve, 20));
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      };
      const outcomes = await Promise.allSettled([
        run("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
          f.ids.team,
          f.users[1] as string,
        ]),
        run(
          mutation === "demote"
            ? "UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2"
            : mutation === "remove"
              ? "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2"
              : "DELETE FROM users WHERE id=$2 AND $1::uuid IS NOT NULL",
          [f.ids.team, f.users[1] as string],
        ),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = outcomes.find((r) => r.status === "rejected");
      expect(failed).toBeDefined();
      if (failed?.status === "rejected")
        expect(["23503", "23514", "40P01", "40001", "55P03"]).toContain(failed.reason.code);
      expect(
        (
          await f.db.query(
            "SELECT m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.lead_user_id WHERE w.id=$1",
            [f.ids.team],
          )
        ).rows[0]?.role,
      ).toBe("admin");
    } finally {
      await f.close();
    }
  });

it("aborts a stale repeatable-read membership change instead of accepting an obsolete lead snapshot", async () => {
  expect(sql).not.toBeNull();
  if (!sql) return;
  const f = await fixture();
  const stale = await f.db.connect();
  try {
    await enforce(f.db);
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await stale.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [f.ids.team]);
    await f.db.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [f.ids.team, f.users[1]]);
    await expect(
      stale.query(
        "UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",
        [f.ids.team, f.users[0]],
      ),
    ).rejects.toMatchObject({ code: "40001" });
    await stale.query("ROLLBACK");
    expect(
      (
        await f.db.query(
          "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
          [f.ids.team, f.users[0]],
        )
      ).rows[0]?.role,
    ).toBe("admin");
  } finally {
    await stale.query("ROLLBACK");
    stale.release();
    await f.close();
  }
});

it("rejects a stale repeatable-read pointer when a target was demoted after its snapshot", async () => {
  expect(sql).not.toBeNull();
  if (!sql) return;
  const f = await fixture();
  const stale = await f.db.connect();
  try {
    await enforce(f.db);
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await stale.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [f.ids.team]);
    await f.db.query(
      "UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",
      [f.ids.team, f.users[1]],
    );
    const attempt = async () => {
      await stale.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
        f.ids.team,
        f.users[1],
      ]);
      await stale.query("COMMIT");
      return (
        await f.db.query(
          "SELECT m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.lead_user_id WHERE w.id=$1",
          [f.ids.team],
        )
      ).rows[0]?.role;
    };
    await expect(attempt()).rejects.toMatchObject({ code: "40001" });
  } finally {
    await stale.query("ROLLBACK");
    stale.release();
    await f.close();
  }
});

it("finishes a thirty-member batch and whole-team cascade without trigger recursion or logical workspace changes", async () => {
  expect(sql).not.toBeNull();
  if (!sql) return;
  const f = await fixture();
  const client = await f.db.connect();
  try {
    await enforce(f.db);
    const before = (
      await f.db.query("SELECT to_jsonb(w) AS row FROM workspaces w WHERE id=$1", [f.ids.team])
    ).rows;
    await client.query("BEGIN; SET LOCAL statement_timeout='5s'");
    for (let index = 0; index < 27; index++) {
      const user = randomUUID();
      await client.query(
        "INSERT INTO users(id,email,name,password_hash,terms_agreed_at) VALUES($1,$2,'합성 팀원','fixture',now())",
        [user, user + "@example.invalid"],
      );
      await client.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
        [f.ids.team, user],
      );
    }
    await client.query("UPDATE workspace_members SET role=role WHERE workspace_id=$1", [
      f.ids.team,
    ]);
    await client.query("COMMIT");
    expect(
      (await f.db.query("SELECT to_jsonb(w) AS row FROM workspaces w WHERE id=$1", [f.ids.team]))
        .rows,
    ).toEqual(before);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id=$1",
          [f.ids.team],
        )
      ).rows[0]?.count,
    ).toBe(30);
    await client.query("BEGIN; SET LOCAL statement_timeout='5s'");
    await removeWorkspace(client, f.ids.team);
    await client.query("COMMIT");
    expect(
      (
        await f.db.query("SELECT user_id FROM workspace_members WHERE workspace_id=$1", [
          f.ids.team,
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await f.close();
  }
});
