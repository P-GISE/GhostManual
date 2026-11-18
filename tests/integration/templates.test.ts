import { afterAll, expect, it } from "vitest";
import { currentUser } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import {
  deleteTemplate,
  getTemplate,
  listTemplates,
  registerTemplate,
  runTemplateJob,
} from "../../src/lib/template-extraction.ts";
import { ManualIdSchema } from "../../src/lib/types.ts";
import { docx, hwpx, pack, wp } from "../fixtures/documents/native/build.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

it("stores originals, counts quota and processes owner-only templates", async () => {
  const mail = setupFileMail();
  const { ctx } = await signedInUser(mail);
  const other = await signedInUser(mail);
  const bytes = pack(docx(wp("완료 기준")));
  const template = await registerTemplate(ctx, "sample.docx", bytes);
  expect(template.status).toBe("reading");
  expect((await currentUser(ctx)).usage.bytes).toBe(bytes.length);
  const original = await pool.query("SELECT content FROM manual_templates WHERE id=$1", [
    template.id,
  ]);
  expect(original.rows[0].content).toEqual(Buffer.from(bytes));
  await expect(getTemplate(other.ctx, template.id)).rejects.toMatchObject({ httpStatus: 404 });
  await expect(
    getTemplate(
      {
        ...ctx,
        role: "reader",
        shareId: crypto.randomUUID(),
        manualId: ManualIdSchema.parse(crypto.randomUUID()),
      },
      template.id,
    ),
  ).rejects.toMatchObject({ httpStatus: 404 });
  expect(await runTemplateJob()).toBe(true);
  expect(await getTemplate(ctx, template.id)).toMatchObject({
    status: "review",
    extraction: {
      candidates: [{ name: "완료 기준", sourceRefs: [{ blockPath: "body/block/1" }] }],
    },
  });
  expect(await runTemplateJob()).toBe(false);
  expect(await listTemplates(ctx)).toEqual([
    {
      id: template.id,
      name: "sample.docx",
      status: "review",
      fileBytes: bytes.length,
      itemCount: 0,
      isDefault: false,
    },
  ]);
  expect(await listTemplates(other.ctx)).toEqual([]);
  await deleteTemplate(ctx, template.id);
  expect((await currentUser(ctx)).usage.bytes).toBe(0);
  const queued = await registerTemplate(ctx, "another.docx", bytes);
  await deleteTemplate(ctx, queued.id);
  expect(await runTemplateJob()).toBe(false);
});

it("accepts HWPX through HTTP and exposes the asynchronous result to its owner", async () => {
  const { ctx, token } = await signedInUser(setupFileMail());
  const { POST } = await import("../../src/app/api/templates/route.ts");
  const { GET } = await import("../../src/app/api/templates/[id]/route.ts");
  const form = new FormData();
  form.set("file", new File([Buffer.from(pack(hwpx("업무 목적", "완료 기준")))], "sample.hwpx"));
  const headers = { origin: "http://localhost:3200", cookie: `gm_owner=${token}` };
  const res = await POST(
    new Request("http://localhost:3200/api/templates", { method: "POST", headers, body: form }),
  );
  expect(res.status).toBe(202);
  const { id } = await res.json();
  expect(await runTemplateJob()).toBe(true);
  const status = await GET(new Request(`http://localhost:3200/api/templates/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({
    status: "review",
    extraction: {
      candidates: [
        { name: "업무 목적", sourceRefs: [{ blockPath: "section/1/block/1" }] },
        { name: "완료 기준" },
      ],
    },
  });
  await deleteTemplate(ctx, id);
});
