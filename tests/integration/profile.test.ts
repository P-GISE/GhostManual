import { afterAll, beforeAll, expect, it } from "vitest";
import { currentUser, updateProfile } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  await pool.end();
});

it("returns department, login methods and file usage", async () => {
  const { ctx } = await signedInUser(mail);
  expect(await currentUser(ctx)).toMatchObject({
    name: "사용자",
    department: null,
    loginMethods: ["password"],
    usage: { bytes: 0, limitBytes: 104857600 },
  });
});
it("saves and clears the department", async () => {
  const { ctx } = await signedInUser(mail);
  expect(await updateProfile(ctx, { name: "박효민", department: "재무팀" })).toMatchObject({
    name: "박효민",
    department: "재무팀",
  });
  expect((await currentUser(ctx)).department).toBe("재무팀");
  expect((await updateProfile(ctx, { name: "박효민", department: null })).department).toBeNull();
});
it("rejects names and departments over 40 characters", async () => {
  const { ctx } = await signedInUser(mail);
  await expect(
    updateProfile(ctx, { name: "가".repeat(41), department: null }),
  ).rejects.toMatchObject({ httpStatus: 422 });
  await expect(
    updateProfile(ctx, { name: "이름", department: "가".repeat(41) }),
  ).rejects.toMatchObject({ httpStatus: 422 });
});
