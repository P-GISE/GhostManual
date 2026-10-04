import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createShare, exchangeShare, revokeShare } from "../../src/lib/shares.ts";
import { createSource, getSource, updateSource } from "../../src/lib/sources.ts";

afterAll(async () => {
  await pool.end();
});
it("rejects sharing a source without reviewed manual", async () => {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, {
    title: "업무",
    text: "승인 후 발급합니다. ".repeat(20),
  });
  await expect(createShare(owner, source.id)).rejects.toMatchObject({ httpStatus: 404 });
});
it("rejects malformed share tokens", async () => {
  await expect(exchangeShare("invalid")).rejects.toMatchObject({ httpStatus: 401 });
});
it("hides nonexistent shares from owners", async () => {
  const owner = await requireSession((await createWorkspace()).token);
  await expect(revokeShare(owner, crypto.randomUUID())).rejects.toMatchObject({ httpStatus: 404 });
});

import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";

async function reviewed() {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  return { owner, source, manual };
}
it("exchanges hashed token for a scoped reader and forbids writes", async () => {
  const { owner, manual } = await reviewed();
  const share = await createShare(owner, manual.id);
  const session = await exchangeShare(share.token);
  const reader = await requireSession(session.token);
  expect(reader.role).toBe("reader");
  expect(reader.manualId).toBe(manual.id);
  expect(
    (await pool.query("SELECT token_hash FROM shares WHERE id=$1", [share.id])).rows[0]?.[
      "token_hash"
    ],
  ).not.toBe(share.token);
  expect(share.expiresAt.getTime()).toBeLessThanOrEqual(owner.expiresAt.getTime());
  await expect(createShare(reader, manual.id)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(getManual(reader, crypto.randomUUID())).rejects.toMatchObject({ httpStatus: 404 });
});
it("rejects existing reader session after owner revokes share", async () => {
  const { owner, manual } = await reviewed();
  const share = await createShare(owner, manual.id);
  const session = await exchangeShare(share.token);
  const reader = await requireSession(session.token);
  await revokeShare(owner, share.id);
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(getManual(reader, manual.id)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(exchangeShare(share.token)).rejects.toMatchObject({ httpStatus: 401 });
});
it("rejects an expired share without cleanup", async () => {
  const { owner, manual } = await reviewed();
  const share = await createShare(owner, manual.id);
  const session = await exchangeShare(share.token);
  await pool.query("UPDATE shares SET expires_at=now()-interval '1 second' WHERE id=$1", [
    share.id,
  ]);
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
});

import { POST as exchangeRoute } from "../../src/app/api/share/route.ts";

it("exchanges fragment token via JSON and returns only reader cookie", async () => {
  const { owner, manual } = await reviewed();
  const share = await createShare(owner, manual.id);
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  process.env["APP_ORIGIN"] = origin;
  const response = await exchangeRoute(
    new Request(origin + "/api/share", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ token: share.token }),
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
  const share = await createShare(owner, manual.id);
  const session = await exchangeShare(share.token);
  const reader = await requireSession(session.token);
  await updateSource(
    owner,
    source.id,
    { ...exampleSource, text: exampleSource.text + "\n\n변경된 승인 절차입니다." },
    1,
  );
  await expect(getSource(reader, source.id, 2)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(exchangeShare(share.token)).rejects.toMatchObject({ httpStatus: 401 });
});

import { GET as listSharesRoute } from "../../src/app/api/shares/route.ts";

it("lists only active owner shares without redisclosing tokens after a new request", async () => {
  const { owner, manual } = await reviewed();
  const share = await createShare(owner, manual.id);
  const foreign = await reviewed();
  await createShare(foreign.owner, foreign.manual.id);
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const ownerToken = (await createWorkspace()).token;
  const request = new Request(`${origin}/api/shares?manualId=${manual.id}`, {
    headers: { cookie: `gm_owner=${ownerToken}` },
  });
  expect(await (await listSharesRoute(request)).json()).toEqual([]);
  const { listShares } = await import("../../src/lib/shares.ts");
  expect(await listShares(owner, manual.id)).toEqual([
    { id: share.id, manualId: manual.id, expiresAt: share.expiresAt },
  ]);
  const reader = await requireSession((await exchangeShare(share.token)).token);
  await expect(listShares(reader, manual.id)).rejects.toMatchObject({ httpStatus: 403 });
  await revokeShare(owner, share.id);
  expect(await listShares(owner, manual.id)).toEqual([]);
});
