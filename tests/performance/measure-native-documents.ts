import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { docx, hwpx, pack, pptx } from "../fixtures/documents/native/build.ts";

assert.equal(process.env["GITHUB_ACTIONS"], "true", "probe runs only on GitHub Actions");
assert.equal(process.platform, "linux");
const image = z
  .string()
  .regex(/^ghostmanual:[a-f0-9]{40}$/)
  .parse(process.argv[2]);
const MiB = 1024 * 1024;
const profiles = [
  { name: "app", mode: "detect", memoryMiB: 384, swapMiB: 768, cpus: "0.75", heapMiB: 256 },
  { name: "worker", mode: "read", memoryMiB: 192, swapMiB: 192, cpus: "0.25", heapMiB: 128 },
] as const;
const scenarios = ["small", "expanded-text", "many-parts", "over-xml-part"] as const;
const formats = ["docx", "hwpx", "pptx"] as const;
const docxDiagnostics = [
  { name: "single-text-512k", textBytes: 512 * 1024 },
  { name: "single-text-1m", textBytes: MiB },
  { name: "single-text-2m", textBytes: 2 * MiB },
  { name: "flat-total-25000", totalTags: 25_000 },
  { name: "flat-total-50000", totalTags: 50_000 },
  { name: "flat-total-100000", totalTags: 100_000 },
  { name: "mixed-xml-512k-tags-25000", totalXmlBytes: 512 * 1024, totalTags: 25_000 },
  { name: "mixed-xml-1m-tags-50000", totalXmlBytes: MiB, totalTags: 50_000 },
] as const;
type Scenario =
  | (typeof scenarios)[number]
  | (typeof docxDiagnostics)[number]["name"]
  | "accepted-package-boundary";
const batches: readonly {
  readonly format: (typeof formats)[number];
  readonly scenarios: readonly Scenario[];
}[] = [
  ...formats.map((format) => ({ format, scenarios })),
  { format: "docx", scenarios: docxDiagnostics.map((sample) => sample.name) },
  ...formats.map((format) => ({ format, scenarios: ["accepted-package-boundary"] as const })),
];
const expectedCases = batches.reduce(
  (sum, batch) => sum + batch.scenarios.length * profiles.length,
  0,
);
assert.equal(expectedCases, 46);
const childResult = z.object({
  status: z.string(),
  blocks: z.number().int().nonnegative(),
  markerFound: z.boolean().nullable(),
  elapsedMs: z.number().nonnegative(),
  maxRssKiB: z.number().int().positive(),
  cgroupMemoryMax: z.string().nullable(),
  cgroupSwapMax: z.string().nullable(),
  cgroupMemoryPeak: z.string().nullable(),
});
const containerState = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  Config: z.object({ Labels: z.record(z.string(), z.string()) }),
  State: z.object({ Running: z.boolean(), OOMKilled: z.boolean(), ExitCode: z.number().int() }),
});
type Row = {
  readonly format: (typeof formats)[number];
  readonly scenario: Scenario;
  readonly profile: (typeof profiles)[number];
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly xmlBytes: number;
  readonly maxXmlPartBytes: number;
  readonly startTags: number;
  readonly maxPartTags: number;
  readonly sha256: string;
  readonly expectedStatus: "accepted" | "rejected";
  readonly rejectionReasons: readonly string[];
  readonly state: unknown;
  readonly measurement: z.infer<typeof childResult> | null;
  readonly watchdog: boolean;
  readonly watchdogLimitMs: number;
  readonly outcome: string;
};
const rows: Row[] = [];
const skipped: string[] = [];
const runId = randomUUID();
const directory = mkdtempSync(join(tmpdir(), "ghostmanual-native-probe-"));
chmodSync(directory, 0o755);
const deadline = Date.now() + 300_000;
function docker(args: readonly string[]) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 });
}
function assertAbsent(filter: string): void {
  const absent = docker(["ps", "--all", "--no-trunc", "--filter", filter, "--format", "{{.ID}}"]);
  assert.equal(absent.status, 0, "probe absence lookup failed");
  assert.equal(absent.stdout.trim(), "", "probe container still present");
}
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
function tagCount(text: string): number {
  let count = 0;
  for (const _tag of text.matchAll(/<(?![!?/])/g)) count++;
  return count;
}
try {
  for (const batch of batches) {
    const format = batch.format;
    for (const scenario of batch.scenarios) {
      if (Date.now() >= deadline) {
        for (const profile of profiles) skipped.push(`${format}/${scenario}/${profile.name}`);
        continue;
      }
      const parts: Record<string, string> = { docx, hwpx, pptx }[format]();
      if (scenario === "expanded-text") {
        const text = `<padding>${"x".repeat(10 * MiB - 4096)}</padding>`;
        parts["customXml/large1.xml"] = text;
        parts["customXml/large2.xml"] = text;
      } else if (scenario === "many-parts") {
        const dense = `<padding>${"<n/>".repeat(99_990)}</padding>`;
        for (let index = 0; index < 40; index++) parts[`customXml/part${index}.xml`] = dense;
      } else if (scenario === "over-xml-part") {
        parts["customXml/oversize.xml"] = `<padding>${"x".repeat(10 * MiB)}</padding>`;
      }
      const diagnostic = docxDiagnostics.find((sample) => sample.name === scenario);
      if (diagnostic) {
        assert.equal(format, "docx");
        const baseXml = Object.entries(parts)
          .filter(([name]) => /\.(xml|rels|hpf)$/i.test(name))
          .map(([, text]) => text);
        const baseXmlBytes = baseXml.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
        const baseTags = baseXml.reduce((sum, text) => sum + tagCount(text), 0);
        const partTags = "textBytes" in diagnostic ? 1 : diagnostic.totalTags - baseTags;
        const markupBytes = Buffer.byteLength("<padding></padding>") + (partTags - 1) * 4;
        const fillBytes =
          "textBytes" in diagnostic
            ? diagnostic.textBytes
            : "totalXmlBytes" in diagnostic
              ? diagnostic.totalXmlBytes - baseXmlBytes - markupBytes
              : 0;
        assert(partTags > 0 && fillBytes >= 0);
        parts["customXml/diagnostic.xml"] =
          `<padding>${"<n/>".repeat(partTags - 1)}${"x".repeat(fillBytes)}</padding>`;
      }
      if (scenario === "accepted-package-boundary") {
        const baseXml = Object.entries(parts)
          .filter(([name]) => /\.(xml|rels|hpf)$/i.test(name))
          .map(([, text]) => text);
        const baseXmlBytes = baseXml.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
        const baseTags = baseXml.reduce((sum, text) => sum + tagCount(text), 0);
        const partTags = 100_000 - baseTags;
        const wrapping = Buffer.byteLength("<padding></padding>") + (partTags - 1) * 4;
        const textBytes = MiB - baseXmlBytes - wrapping;
        assert(partTags > 0 && textBytes >= 0);
        parts["customXml/accepted-boundary.xml"] =
          `<padding>${"<n/>".repeat(partTags - 1)}${"x".repeat(textBytes)}</padding>`;
        const existingBytes = Object.values(parts).reduce(
          (sum, text) => sum + Buffer.byteLength(text),
          0,
        );
        assert(existingBytes < 20 * MiB);
        parts["padding.dat"] = "x".repeat(20 * MiB - existingBytes);
      }
      const lengths = Object.entries(parts).map(([name, text]) => ({
        bytes: Buffer.byteLength(text),
        xml: /\.(xml|rels|hpf)$/i.test(name),
        tags: /\.(xml|rels|hpf)$/i.test(name) ? tagCount(text) : 0,
      }));
      const expandedBytes = lengths.reduce((sum, part) => sum + part.bytes, 0);
      const xmlBytes = lengths
        .filter((part) => part.xml)
        .reduce((sum, part) => sum + part.bytes, 0);
      const maxXmlPartBytes = Math.max(
        ...lengths.filter((part) => part.xml).map((part) => part.bytes),
      );
      const startTags = lengths.reduce((sum, part) => sum + part.tags, 0);
      const maxPartTags = Math.max(...lengths.map((part) => part.tags));
      const bytes = pack(parts);
      assert(bytes.length <= 5 * MiB && expandedBytes <= 20 * MiB);
      assert(maxPartTags <= 100_000);
      assert.equal(maxXmlPartBytes > 10 * MiB, scenario === "over-xml-part");
      if (scenario === "expanded-text") assert(expandedBytes > 19 * MiB);
      if (scenario === "many-parts") assert(startTags > 3_000_000);
      if (diagnostic) {
        if ("textBytes" in diagnostic)
          assert.equal(
            maxXmlPartBytes,
            diagnostic.textBytes + Buffer.byteLength("<padding></padding>"),
          );
        if ("totalTags" in diagnostic) assert.equal(startTags, diagnostic.totalTags);
        if ("totalXmlBytes" in diagnostic) assert.equal(xmlBytes, diagnostic.totalXmlBytes);
      }
      if (scenario === "accepted-package-boundary") {
        assert.equal(xmlBytes, MiB);
        assert.equal(startTags, 100_000);
        assert.equal(expandedBytes, 20 * MiB);
      }
      const rejectionReasons = [
        ...(xmlBytes > MiB ? ["aggregate-xml-bytes"] : []),
        ...(startTags > 100_000 ? ["package-opening-tokens"] : []),
        ...(maxXmlPartBytes > 10 * MiB ? ["xml-part-bytes"] : []),
      ];
      const expectedStatus = rejectionReasons.length > 0 ? "rejected" : "accepted";
      const input = join(directory, `${format}-${scenario}.zip`);
      writeFileSync(input, bytes, { mode: 0o444 });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      for (const profile of profiles) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          skipped.push(`${format}/${scenario}/${profile.name}`);
          continue;
        }
        const watchdogLimitMs = Math.min(45_000, remaining);
        const name = `gm-native-probe-${randomUUID()}`;
        let state: z.infer<typeof containerState> | null = null;
        let measurement: z.infer<typeof childResult> | null = null;
        let watchdog = false;
        let outcome = "runner-error";
        try {
          // Watchdogs protect this diagnostic runner, not a product response-time promise.
          const result = spawnSync(
            "docker",
            [
              "run",
              "--name",
              name,
              "--label",
              `ghostmanual.native-probe=${runId}`,
              "--pull=never",
              "--network=none",
              "--read-only",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges:true",
              "--cgroupns=private",
              "--pids-limit=64",
              "--ulimit=core=0",
              `--memory=${profile.memoryMiB}m`,
              `--memory-swap=${profile.swapMiB}m`,
              `--cpus=${profile.cpus}`,
              "--env",
              `NODE_OPTIONS=--max-old-space-size=${profile.heapMiB}`,
              "--mount",
              `type=bind,src=${input},dst=/run/native-probe/input.zip,readonly`,
              "--mount",
              `type=bind,src=${resolve("scripts/native-document-probe-child.ts")},dst=/app/scripts/native-document-probe-child.ts,readonly`,
              "--entrypoint=node",
              image,
              "/app/scripts/native-document-probe-child.ts",
              format,
              profile.mode,
              "/run/native-probe/input.zip",
            ],
            {
              encoding: "utf8",
              timeout: watchdogLimitMs,
              killSignal: "SIGKILL",
              maxBuffer: 1024 * 1024,
            },
          );
          watchdog =
            result.error !== undefined &&
            "code" in result.error &&
            result.error.code === "ETIMEDOUT";
          const inspected = docker(["inspect", name]);
          if (inspected.status === 0) {
            state = z.array(containerState).parse(JSON.parse(inspected.stdout))[0] ?? null;
            assert(state && state.Config.Labels["ghostmanual.native-probe"] === runId);
            if (watchdog && state.State.Running) {
              const id = state.Id;
              const killed = docker(["kill", id]);
              assert.equal(killed.status, 0, "probe watchdog stop failed");
              const stopped = docker(["inspect", id]);
              assert.equal(stopped.status, 0, "probe stopped-state lookup failed");
              state = z.array(containerState).parse(JSON.parse(stopped.stdout))[0] ?? null;
              assert(
                state && state.Id === id && !state.State.Running,
                "probe watchdog did not stop container",
              );
            }
          }
          const parsed = childResult.safeParse(parseJson(result.stdout.trim()));
          if (parsed.success) measurement = parsed.data;
          const accepted =
            measurement &&
            (profile.mode === "detect"
              ? measurement.status === format
              : measurement.status === "ready" &&
                measurement.blocks > 0 &&
                measurement.markerFound);
          const expected =
            expectedStatus === "rejected" ? measurement?.status === "rejected" : accepted;
          outcome = !state
            ? "runner-error"
            : watchdog
              ? "watchdog"
              : state.State.OOMKilled
                ? "cgroup-oom"
                : /heap out of memory|Reached heap limit/i.test(result.stderr)
                  ? "heap-oom"
                  : result.status === 0 &&
                      !state.State.Running &&
                      state.State.ExitCode === 0 &&
                      expected
                    ? "passed"
                    : "unexpected-result";
        } finally {
          const inspected = docker(["inspect", name]);
          if (inspected.status === 0) {
            const own = z.array(containerState).parse(JSON.parse(inspected.stdout))[0];
            assert(own && own.Config.Labels["ghostmanual.native-probe"] === runId);
            assert(!state || state.Id === own.Id, "probe container identity changed");
            const removed = docker(["rm", "--force", own.Id]);
            assert.equal(removed.status, 0, "probe container cleanup failed");
            assertAbsent(`id=${own.Id}`);
          } else {
            assertAbsent(`name=^/${name}$`);
          }
        }
        const row = {
          format,
          scenario,
          profile,
          compressedBytes: bytes.length,
          expandedBytes,
          xmlBytes,
          maxXmlPartBytes,
          startTags,
          maxPartTags,
          sha256,
          expectedStatus,
          rejectionReasons,
          state: state?.State ?? null,
          measurement,
          watchdog,
          watchdogLimitMs,
          outcome,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
  const report = {
    version: 1,
    image,
    expectedCases,
    nativeXmlPolicy: { aggregateXmlBytes: MiB, openingTokens: 100_000 },
    runnerSwapTotalKiB: Number(
      readFileSync("/proc/meminfo", "utf8").match(/^SwapTotal:\s+(\d+)/m)?.[1] ?? 0,
    ),
    limits: { caseWatchdogMs: 45_000, overallWatchdogMs: 300_000 },
    limitations: [
      "Synthetic bounded samples, not an exhaustive worst-case proof.",
      "Parser process only; excludes the Next.js baseline and concurrent requests.",
      "Container swap limits match production; available runner swap can differ.",
      "Watchdogs are diagnostic protection, not product performance acceptance thresholds.",
      "The overall window bounds new fixture/case starts and child runtime; synchronous fixture generation and exact-container cleanup are not preempted.",
    ],
    rows,
    skipped,
  };
  writeFileSync("native-document-probe.json", JSON.stringify(report, null, 2));
}
assert.equal(rows.length + skipped.length, expectedCases, "probe case accounting mismatch");
assert.equal(skipped.length, 0, "probe watchdog left unmeasured cases");
assert.equal(
  rows.filter((row) => row.outcome !== "passed").length,
  0,
  "native parser safety probe failed",
);
