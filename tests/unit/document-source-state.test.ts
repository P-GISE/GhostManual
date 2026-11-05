import { type ComponentProps, useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { FileVersions } from "../../src/components/FileVersions";
import { SourceDetail } from "../../src/components/SourceDetail";
import { fileRevisionSchema, http, read, sourceSchema } from "../../src/lib/client";

const state = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  versions: null as ComponentProps<typeof FileVersions> | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.slots)) state.slots[index] = initial;
    return [
      state.slots[index],
      (value: unknown) => {
        state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value;
      },
    ];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../src/components/useUnsavedChanges", () => ({ useUnsavedChanges: vi.fn() }));
vi.mock("../../src/components/FileVersions", () => ({
  FileVersions: (props: ComponentProps<typeof FileVersions>) => {
    state.versions = props;
    return null;
  },
}));

vi.mock("../../src/lib/client", async (original) => ({
  ...(await original<typeof import("../../src/lib/client")>()),
  read: vi.fn(),
  http: { get: vi.fn() },
}));

const sourceId = "00000000-0000-4000-8000-000000000001";
const revisionId = (revision: number) =>
  `00000000-0000-4000-8000-${String(revision).padStart(12, "0")}`;
const extraction = (status: "queued" | "ready") => ({
  status,
  reason: null,
  coverage: [],
  resultId: null,
});
const detail = (revision: number, status: "queued" | "ready") =>
  fileRevisionSchema.parse({
    id: sourceId,
    title: "합성 자료",
    revision,
    revisionId: revisionId(revision),
    fileType: "docx",
    extraction: extraction(status),
    createdAt: "2026-11-04T00:00:00Z",
    uploadedByName: "합성 사용자",
    uploadedByDepartment: null,
    file: { name: "합성.docx", sizeBytes: 1024 },
    compareStatus: status === "queued" ? "pending" : "compared",
    aiSummary: null,
    changes: [],
    questions: [],
    usage: { bytes: 1024, limitBytes: 104857600 },
    preview: [],
  });
const render = () => {
  state.cursor = 0;
  return renderToStaticMarkup(SourceDetail({ id: sourceId }));
};
const finish = (revision: number, status: "queued" | "ready") => {
  state.versions?.onUploaded(detail(revision, status));
  return render();
};
const expectDisabled = (html: string, disabled: boolean) => {
  for (const label of ["직접 작성하기", "AI 초안 요청"]) {
    const tag = new RegExp(`<button([^>]*)>${label}</button>`).exec(html)?.[1];
    expect(tag).toBeDefined();
    expect(tag?.includes("disabled")).toBe(disabled);
  }
};
beforeEach(() => {
  const current = sourceSchema.parse({
    id: sourceId,
    revisionId: revisionId(3),
    revision: 3,
    title: "합성 자료",
    text: "확인 대기",
    createdAt: "2026-11-04T00:00:00Z",
    kind: "file",
    fileType: "docx",
    extraction: extraction("queued"),
  });
  state.slots = [false, current, "", "", false, "", false, false];
  state.versions = null;
  render();
});
it("keeps latest v3 pending when a selected historical v2 completes", () => {
  const html = finish(2, "ready");
  expect(state.slots[1]).toMatchObject({
    revision: 3,
    revisionId: revisionId(3),
    extraction: extraction("queued"),
  });
  expectDisabled(html, true);
});
it("refreshes extraction for the same latest revision", () => {
  const html = finish(3, "ready");
  expect(state.slots[1]).toMatchObject({
    revision: 3,
    revisionId: revisionId(3),
    extraction: extraction("ready"),
  });
  expectDisabled(html, false);
});
it("advances to a newly uploaded revision and keeps its pending guards", () => {
  const html = finish(4, "queued");
  expect(state.slots[1]).toMatchObject({
    revision: 4,
    revisionId: revisionId(4),
    extraction: extraction("queued"),
  });
  expectDisabled(html, true);
});

it("refreshes parent extraction when opening the latest selected version", async () => {
  const effects: Array<() => unknown> = [];
  vi.mocked(useEffect).mockImplementation((effect) => {
    effects.push(effect);
  });
  state.slots = [];
  state.cursor = 0;
  const saved = detail(4, "ready");
  vi.mocked(read).mockResolvedValue([
    { ...saved, changeCount: 0, questionCount: 0, answeredCount: 0 },
  ]);
  vi.mocked(http.get).mockImplementation(vi.fn().mockReturnValue({ json: async () => saved }));
  const { FileVersions: ActualVersions } = await vi.importActual<
    typeof import("../../src/components/FileVersions")
  >("../../src/components/FileVersions");
  const onUploaded = vi.fn();
  ActualVersions({
    id: sourceId,
    reader: false,
    startUploading: false,
    busy: false,
    onBusyChange: vi.fn(),
    onUploaded,
  });
  effects[0]?.();
  await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledWith(saved));
  vi.mocked(useEffect).mockReset();
});
