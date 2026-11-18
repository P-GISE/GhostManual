import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { deleteAccount } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { runDocumentJob } from "../../src/lib/document-jobs.ts";
import { readDocument } from "../../src/lib/documents/read.ts";
import { addFileRevision, createFileSource } from "../../src/lib/file-sources.ts";
import { getManual, saveDraft } from "../../src/lib/manuals.ts";
import type { TemplateDraft } from "../../src/lib/schemas.ts";
import { registerTemplate, runTemplateJob } from "../../src/lib/template-extraction.ts";
import { updateTemplate } from "../../src/lib/templates.ts";
import { docx, hwpx, pack, wp } from "../fixtures/documents/native/build.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

it.each(["xlsx", "docx", "hwpx"] as const)(
  "preserves template sections when a %s source revision resaves its manual",
  async (format) => {
    const { ctx } = await signedInUser(setupFileMail());
    try {
      const registered = await registerTemplate(ctx, "synthetic.docx", pack(docx(wp("완료 기준"))));
      while (await runTemplateJob());
      const confirmed = await updateTemplate(ctx, registered.id, {
        items: [{ name: "완료 기준", guide: "검증용", kind: "text" }],
      });
      const items = confirmed["items"] as {
        id: string;
        name: string;
        guide: string;
        kind: "text";
      }[];
      const bytes = (revision: number) => {
        if (format === "xlsx")
          return new Uint8Array(
            readFileSync(
              "tests/fixtures/xlsx/정산_" + (revision === 1 ? "1029" : "1030") + ".xlsx",
            ),
          );
        return pack(
          format === "docx"
            ? docx(wp("완료 기준 " + revision))
            : hwpx("업무 목적", "완료 기준 " + revision),
        );
      };
      const source = await createFileSource(ctx, {
        title: "합성 파일 업무",
        fileName: "synthetic." + format,
        bytes: bytes(1),
      });
      if (format !== "xlsx")
        while (await runDocumentJob(async (type, data) => readDocument(type, data)));
      const draft: TemplateDraft = {
        title: "합성 양식 매뉴얼",
        template: { id: registered.id, name: "synthetic.docx" },
        sections: items.map((item) => ({
          ...item,
          text: "원본 대조 후 완료",
          items: [],
          state: "filled",
          by: "human",
        })),
        unknowns: [],
        references: [],
      };
      const saved = await saveDraft(ctx, source.revisionId, draft);
      const revision = await addFileRevision(ctx, source.id, {
        fileName: "synthetic." + format,
        bytes: bytes(2),
        expectedRevision: 1,
      });
      if (format !== "xlsx")
        while (await runDocumentJob(async (type, data) => readDocument(type, data)));
      const current = await getManual(ctx, saved.id);
      expect(current.sourceRevisionId).toBe(revision.revisionId);
      expect(current.needsReview).toBe(true);
      expect("sections" in current.draft).toBe(true);
      if (!("sections" in current.draft) || !("sections" in saved.draft))
        throw new Error("Template draft was replaced by the default draft");
      expect(current.draft.sections).toEqual(saved.draft.sections);
      expect(current.draft.template).toEqual(saved.draft.template);
    } finally {
      await deleteAccount(ctx);
    }
  },
);
