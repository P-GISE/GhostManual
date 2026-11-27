import { afterEach, expect, it, vi } from "vitest";
import { documentStatusSchema, waitForDocument } from "../../src/lib/document-progress.ts";

const revisionId = "00000000-0000-4000-8000-000000000001";
const status = (value: "queued" | "ready") => ({ revisionId, status: value });
afterEach(() => {
  vi.useRealTimers();
});
it("uses 250,500,1000,2000ms capped delays and stops at terminal", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue(status("queued"));
  const task = waitForDocument(read, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(249);
  expect(read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(1);
  for (const [index, delay] of [500, 1000, 2000, 2000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(read).toHaveBeenCalledTimes(index + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(index + 2);
  }
  read.mockResolvedValue(status("ready"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(await task).toEqual(status("ready"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(6);
});
it("does not overlap a slow status request", async () => {
  vi.useFakeTimers();
  let resolve = (_value: ReturnType<typeof status>) => {};
  const read = vi.fn(
    () =>
      new Promise<ReturnType<typeof status>>((done) => {
        resolve = done;
      }),
  );
  const task = waitForDocument(read, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(1);
  resolve(status("ready"));
  expect(await task).toEqual(status("ready"));
});
it("clears a waiting timer when aborted", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = vi.fn();
  const task = waitForDocument(read, controller.signal).catch((error) => error);
  controller.abort();
  expect((await task).name).toBe("AbortError");
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("ignores a request completing after abort", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let resolve = (_value: ReturnType<typeof status>) => {};
  const read = vi.fn(
    () =>
      new Promise<ReturnType<typeof status>>((done) => {
        resolve = done;
      }),
  );
  const task = waitForDocument(read, controller.signal).catch((error) => error);
  await vi.advanceTimersByTimeAsync(250);
  controller.abort();
  resolve(status("ready"));
  expect((await task).name).toBe("AbortError");
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(1);
});
it("stops on error instead of automatically retrying", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValue(new Error("unavailable"));
  const task = waitForDocument(read, new AbortController().signal).catch((error) => error);
  await vi.advanceTimersByTimeAsync(250);
  expect((await task).message).toBe("unavailable");
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(1);
});
it("rejects unknown status and malformed identity", () => {
  expect(() => documentStatusSchema.parse({ revisionId, status: "unknown" })).toThrow();
  expect(() => documentStatusSchema.parse({ revisionId: "invalid", status: "ready" })).toThrow();
});
