import { afterAll, beforeAll, expect, it } from "vitest";
import { POST as exchangeRoute } from "../../src/app/api/share/route.ts";
import { GET as sharingRoute } from "../../src/app/api/shares/route.ts";
import { pool } from "../../src/lib/db.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { exchangeShare, getSharing, setSharing } from "../../src/lib/shares.ts";
import { createSource, getSource, updateSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { signedInUser, setupFileMail } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  await pool.end();
});
async function reviewed() {
  const { ctx: owner } = await signedInUser(mail);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  return { owner, source, manual };
}
function tokenOf(url: string) {
  return url.slice(url.indexOf("#") + 1);
}
async function linkToken(owner: Awaited<ReturnType<typeof reviewed>>["owner"], manualId: string) {
  const sharing = await setSharing(owner, manualId, "link");
  if (sharing.mode !== "link") throw new Error("expected link sharing");
  return tokenOf(sharing.url);
}

it("sharing is private by default", async () => {
  const { owner, manual } = await reviewed();
  expect(await getSharing(owner, manual.id)).toEqual({ mode: "private" });
});
it("rejects link sharing for a manual without a reviewed version", async () => {
  const { ctx: owner } = await signedInUser(mail);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await expect(setSharing(owner, manual.id, "link")).rejects.toMatchObject({ httpStatus: 404 });
});
it("link stays the same while on", async () => {
  const { owner, manual } = await reviewed();
  const first = await setSharing(owner, manual.id, "link");
  expect(first).toMatchObject({ mode: "link", url: expect.stringMatching(/^\/share#[\w-]{43}$/) });
  expect(await setSharing(owner, manual.id, "link")).toEqual(first);
  expect(await getSharing(owner, manual.id)).toEqual(first);
  const stored = await pool.query("SELECT token_hash FROM shares WHERE manual_id=$1", [manual.id]);
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0]?.["token_hash"]).not.toBe(tokenOf(first.mode === "link" ? first.url : ""));
});
it("link mode lets another signed-in user read only the published version", async () => {
  const { owner, manual } = await reviewed();
  const token = await linkToken(owner, manual.id);
  const { ctx: viewer } = await signedInUser(mail);
  const reader = await requireSession((await exchangeShare(token, viewer)).token);
  expect(reader.role).toBe("reader");
  expect(reader.manualId).toBe(manual.id);
  expect((await getManual(reader, manual.id)).id).toBe(manual.id);
  await expect(saveDraft(reader, manual.sourceRevisionId, exampleDraft)).rejects.toMatchObject({
    httpStatus: 403,
  });
  await expect(setSharing(reader, manual.id, "private")).rejects.toMatchObject({ httpStatus: 403 });
  await expect(getManual(reader, crypto.randomUUID())).rejects.toMatchObject({ httpStatus: 404 });
});
it("switching to private blocks existing readers and the old link", async () => {
  const { owner, manual } = await reviewed();
  const token = await linkToken(owner, manual.id);
  const { ctx: viewer } = await signedInUser(mail);
  const session = await exchangeShare(token, viewer);
  expect(await setSharing(owner, manual.id, "private")).toEqual({ mode: "private" });
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(exchangeShare(token, viewer)).rejects.toMatchObject({ httpStatus: 401 });
  const again = await setSharing(owner, manual.id, "link");
  expect(again.mode === "link" && tokenOf(again.url)).not.toBe(token);
});
it("exchange requires a signed-in account", async () => {
  const { owner, manual } = await reviewed();
  const token = await linkToken(owner, manual.id);
  const anonymous = await requireSession((await createWorkspace()).token);
  await expect(exchangeShare(token, anonymous)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(exchangeShare("invalid", owner)).rejects.toMatchObject({ httpStatus: 401 });
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const response = await exchangeRoute(
    new Request(`${origin}/api/share`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  );
  expect(response.status).toBe(401);
});
it("exchange route returns only a reader cookie for a signed-in viewer", async () => {
  const { owner, manual } = await reviewed();
  const token = await linkToken(owner, manual.id);
  const viewer = await signedInUser(mail);
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const response = await exchangeRoute(
    new Request(`${origin}/api/share`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `gm_owner=${viewer.token}`,
      },
      body: JSON.stringify({ token }),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toMatch(/^gm_reader=/);
  expect(response.headers.get("set-cookie")).not.toContain("gm_owner=");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toMatchObject({ manualId: manual.id });
});
it("rejects reader source access after source changes", async () => {
  const { owner, source, manual } = await reviewed();
  const token = await linkToken(owner, manual.id);
  const { ctx: viewer } = await signedInUser(mail);
  const reader = await requireSession((await exchangeShare(token, viewer)).token);
  await updateSource(
    owner,
    source.id,
    { ...exampleSource, text: `${exampleSource.text}\n\n변경된 승인 절차입니다.` },
    1,
  );
  await expect(getSource(reader, source.id, 2)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(exchangeShare(token, viewer)).rejects.toMatchObject({ httpStatus: 401 });
});
it("sharing state is visible only to the owner", async () => {
  const { owner, manual } = await reviewed();
  await setSharing(owner, manual.id, "link");
  const stranger = await signedInUser(mail);
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const response = await sharingRoute(
    new Request(`${origin}/api/shares?manualId=${manual.id}`, {
      headers: { cookie: `gm_owner=${stranger.token}` },
    }),
  );
  expect(response.status).toBe(404);
});
