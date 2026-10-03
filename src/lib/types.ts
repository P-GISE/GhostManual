import { randomUUID } from "node:crypto";
import { z } from "zod";
export const WorkspaceIdSchema = z.uuid().brand<"WorkspaceId">();
export const SessionIdSchema = z.uuid().brand<"SessionId">();
export const SourceIdSchema = z.uuid().brand<"SourceId">();
export const ManualIdSchema = z.uuid().brand<"ManualId">();
export const RevisionIdSchema = z.uuid().brand<"RevisionId">();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type SourceId = z.infer<typeof SourceIdSchema>;
export type ManualId = z.infer<typeof ManualIdSchema>;
export type RevisionId = z.infer<typeof RevisionIdSchema>;
export function newId() {
  return randomUUID();
}
export type SessionContext = { workspaceId: WorkspaceId; sessionId: SessionId; expiresAt: Date } & (
  | { role: "owner"; shareId: null; manualId: null }
  | { role: "reader"; shareId: string; manualId: ManualId }
);
