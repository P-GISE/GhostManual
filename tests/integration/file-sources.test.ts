import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { updateProfile } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { assertFileQuota, createFileSource } from "../../src/lib/file-sources.ts";
import { deleteSource } from "../../src/lib/retention.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  await pool.end();
});
async function count(table: string, workspaceId: string) {
  const result = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`, [
    workspaceId,
  ]);
  return result.rows[0].n as number;
}

it("registers an xlsx as version 1 with the two base questions", async () => {
  const { ctx } = await signedInUser(mail);
  await updateProfile(ctx, { name: "박효민", department: "재무팀" });
  const bytes = fixture("정산_1029.xlsx");
  const view = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes,
  });
  expect(view).toMatchObject({
    kind: "file",
    fileType: "xlsx",
    title: "월간 정산",
    revision: 1,
    compareStatus: "first",
    uploadedByName: "박효민",
    uploadedByDepartment: "재무팀",
    file: { name: "정산_1029.xlsx", sizeBytes: bytes.length },
    aiSummary: null,
    changes: [],
    usage: { bytes: bytes.length, limitBytes: 104857600 },
  });
  expect(view.questions.map((q) => [q.kind, q.source, q.question])).toEqual([
    ["purpose", "rule", "이 파일은 어떤 업무를 위한 것인가요?"],
    ["origin", "rule", "자료는 어디서 가져왔나요?"],
  ]);
  const stored = await pool.query("SELECT sha256 FROM source_files WHERE revision_id=$1", [
    view.revisionId,
  ]);
  expect(stored.rows[0].sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
});
it("stores an over-limit workbook without a snapshot", async () => {
  const { ctx } = await signedInUser(mail);
  const view = await createFileSource(ctx, {
    title: "큰 파일",
    fileName: "huge.xlsx",
    bytes: fixture("huge.xlsx"),
  });
  expect(view.compareStatus).toBe("first");
  const stored = await pool.query(
    "SELECT compare_status,snapshot FROM source_files WHERE revision_id=$1",
    [view.revisionId],
  );
  expect(stored.rows[0]).toEqual({ compare_status: "limit_exceeded", snapshot: null });
});
it.each(["macro.xlsx", "encrypted.xlsx", "not-zip.xlsx"])(
  "rejects %s before storing anything",
  async (name) => {
    const { ctx } = await signedInUser(mail);
    const error = await createFileSource(ctx, {
      title: "위험",
      fileName: `비밀_${name}`,
      bytes: fixture(name),
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "unsafe_file", httpStatus: 422 });
    expect(String((error as Error).message)).not.toContain("비밀_");
    expect(await count("sources", ctx.workspaceId)).toBe(0);
  },
);
it("rejects files over 5 MiB", async () => {
  const { ctx } = await signedInUser(mail);
  await expect(
    createFileSource(ctx, { title: "큼", fileName: "a.xlsx", bytes: new Uint8Array(5242881) }),
  ).rejects.toMatchObject({ code: "file_too_large", httpStatus: 413 });
});
it("enforces the 100 MiB account quota", () => {
  expect(() => assertFileQuota(104857600 - 10, 10)).not.toThrow();
  expect(() => assertFileQuota(104857600 - 10, 11)).toThrow(
    expect.objectContaining({ code: "storage_quota", httpStatus: 429 }),
  );
});
it("deleting the source removes its files and questions", async () => {
  const { ctx } = await signedInUser(mail);
  const view = await createFileSource(ctx, {
    title: "지울 자료",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  await deleteSource(ctx, view.id);
  expect(await count("source_files", ctx.workspaceId)).toBe(0);
  expect(await count("revision_questions", ctx.workspaceId)).toBe(0);
});
it("POST /api/sources accepts an xlsx upload", async () => {
  const { POST } = await import("../../src/app/api/sources/route.ts");
  const { token } = await signedInUser(mail);
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const form = new FormData();
  form.set("title", "월간 정산");
  form.set("file", new File([fixture("정산_1029.xlsx")], "정산_1029.xlsx"));
  const response = await POST(
    new Request(`${origin}/api/sources`, {
      method: "POST",
      headers: { origin, cookie: `gm_owner=${token}` },
      body: form,
    }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ kind: "file", revision: 1 });
});
