import { z } from "zod";

export const documentStatusSchema = z.object({
  revisionId: z.uuid(),
  status: z.enum(["queued", "processing", "ready", "limited", "failed", "rejected"]),
});
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export const documentPending = (status: string) => status === "queued" || status === "processing";

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function waitForDocument(
  readStatus: (signal: AbortSignal) => Promise<DocumentStatus>,
  signal: AbortSignal,
) {
  let delay = 250;
  while (true) {
    await pause(delay, signal);
    signal.throwIfAborted();
    const result = await readStatus(signal);
    signal.throwIfAborted();
    if (!documentPending(result.status)) return result;
    delay = Math.min(delay * 2, 2000);
  }
}
