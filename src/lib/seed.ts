import { exampleDraft, exampleSource } from "./example.ts";
import { saveDraft } from "./manuals.ts";
import { createSource } from "./sources.ts";
import type { SessionContext } from "./types.ts";
export async function seedExample(ctx: SessionContext) {
  const source = await createSource(ctx, exampleSource);
  return saveDraft(ctx, source.revisionId, exampleDraft, undefined, "example");
}
