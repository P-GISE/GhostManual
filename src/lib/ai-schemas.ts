import { z } from "zod";
export const EvidenceCandidateSchema = z.strictObject({
  id: z.uuid(),
  manualId: z.uuid(),
  manualVersionId: z.uuid(),
  sourceId: z.uuid(),
  sourceRevisionId: z.uuid(),
  paragraphId: z.string().regex(/^p[1-9]\d*$/),
  quote: z.string().min(1).max(12000),
  title: z.string().min(1).max(120),
  kind: z.enum(["source", "manual"]),
  version: z.number().int().positive(),
});
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;
