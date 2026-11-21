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
// userId: 로그인한 계정(계정 없는 예전 임시 문서함은 null). teamRole: 팀 문서함에서의 역할(개인 문서함과 공유 독자는 null).
export type SessionContext = {
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  expiresAt: Date;
  userId: string | null;
  teamRole: "admin" | "member" | null;
} & (
  | { role: "owner"; shareId: null; manualId: null }
  | { role: "reader"; shareId: string; manualId: ManualId }
);
