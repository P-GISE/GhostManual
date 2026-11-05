import type { Manual, Source } from "../../src/lib/client";
import { exampleDraft, exampleSource } from "../fixtures/manual-example";

export const source: Source = {
  ...exampleSource,
  id: "10000000-0000-4000-8000-000000000001",
  revisionId: "10000000-0000-4000-8000-000000000002",
  revision: 1,
  createdAt: "2026-10-18T00:00:00.000Z",
  kind: "text",
  fileType: null,
  openQuestions: 0,
};
export const manual: Manual = {
  id: "10000000-0000-4000-8000-000000000003",
  sourceId: source.id,
  sourceRevisionId: source.revisionId,
  draft: exampleDraft,
  draftRevision: 1,
  publishedVersion: 1,
  published: {
    id: "10000000-0000-4000-8000-000000000004",
    manualId: "10000000-0000-4000-8000-000000000003",
    version: 1,
    sourceRevisionId: source.revisionId,
    content: exampleDraft,
    provenance: "example",
    acknowledgedUnknowns: exampleDraft.unknowns,
    history: null,
    createdAt: source.createdAt,
  },
  needsReview: false,
  provenance: "example",
  createdAt: source.createdAt,
};
