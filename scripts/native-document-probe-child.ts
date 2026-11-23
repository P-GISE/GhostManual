import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { detectDocumentFormat, readDocument } from "../src/lib/documents/read.ts";
import { AppError } from "../src/lib/errors.ts";

const [format, mode, input] = z
  .tuple([
    z.enum(["docx", "hwpx", "pptx"]),
    z.enum(["detect", "read"]),
    z.literal("/run/native-probe/input.zip"),
  ])
  .parse(process.argv.slice(2));
const bytes = readFileSync(input);
const started = performance.now();
let status: string;
let blocks = 0;
let markerFound: boolean | null = null;
try {
  if (mode === "detect") status = detectDocumentFormat(`synthetic.${format}`, bytes);
  else {
    const result = readDocument(format, bytes);
    status = result.status;
    blocks = result.snapshot?.blocks.length ?? 0;
    const marker = { docx: "한글", hwpx: "첫째", pptx: "첫 슬라이드" }[format];
    markerFound = result.snapshot?.blocks.some((block) => block.text.includes(marker)) ?? false;
  }
} catch (error) {
  if (!(error instanceof AppError)) throw error;
  status = "rejected";
}
function cgroup(name: string): string | null {
  try {
    return readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "EACCES")
    )
      return null;
    throw error;
  }
}
console.log(
  JSON.stringify({
    status,
    blocks,
    markerFound,
    elapsedMs: performance.now() - started,
    maxRssKiB: process.resourceUsage().maxRSS,
    cgroupMemoryMax: cgroup("memory.max"),
    cgroupSwapMax: cgroup("memory.swap.max"),
    cgroupMemoryPeak: cgroup("memory.peak"),
  }),
);
