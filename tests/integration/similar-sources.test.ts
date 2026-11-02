import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { createFileSource, similarSources } from "../../src/lib/file-sources.ts";
import { createSource } from "../../src/lib/sources.ts";
import { exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  await pool.end();
});

it("suggests an existing workbook whose file name differs only by date or version", async () => {
  const { ctx } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  await createFileSource(ctx, {
    title: "다른 자료",
    fileName: "구매.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  await createSource(ctx, { ...exampleSource, title: "정산" });
  const found = await similarSources(ctx, {
    fileName: "정산_1030.xlsx",
    title: "10월 정산",
    sha256: sha(fixture("정산_1030.xlsx")),
  });
  expect(found).toEqual([
    { id: v1.id, title: "월간 정산", revision: 1, fileName: "정산_1029.xlsx", sameAsLatest: false },
  ]);
});
it("matches an identical title or identical content and lists identical content first", async () => {
  const { ctx } = await signedInUser(mail);
  const byTitle = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "a.xlsx",
    bytes: fixture("정산_1030.xlsx"),
  });
  const byContent = await createFileSource(ctx, {
    title: "보관본",
    fileName: "b.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  const found = await similarSources(ctx, {
    fileName: "새파일.xlsx",
    title: " 월간 정산 ",
    sha256: sha(fixture("정산_1029.xlsx")),
  });
  expect(found.map((s) => [s.id, s.sameAsLatest])).toEqual([
    [byContent.id, true],
    [byTitle.id, false],
  ]);
});
it("returns nothing for an unrelated workbook", async () => {
  const { ctx } = await signedInUser(mail);
  await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  expect(
    await similarSources(ctx, {
      fileName: "구매요청.xlsx",
      title: "구매 요청",
      sha256: "0".repeat(64),
    }),
  ).toEqual([]);
});
