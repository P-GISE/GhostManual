import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { getOverview } from "../../src/lib/overview.ts";
import { createTeam } from "../../src/lib/teams.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

it("keeps 013 overview role labels unprepared for every admin and member", async () => {
  const mail = setupFileMail();
  const owner = await signedInUser(mail),
    admin = await signedInUser(mail),
    member = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "013 개요 역할");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [team.id, admin.ctx.userId, member.ctx.userId],
  );
  for (const [actor, role] of [
    [owner, "admin"],
    [admin, "admin"],
    [member, "member"],
  ] as const) {
    const view = await getOverview(actor.ctx);
    expect(view.teams).toEqual([
      expect.objectContaining({ id: team.id, role, leadReady: false, lead: false }),
    ]);
    expect(view.personal).toBeNull();
  }
});
