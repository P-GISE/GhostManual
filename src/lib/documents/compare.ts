import {
  DOCUMENT_LIMITS,
  type DocumentBlock,
  type DocumentChange,
  type DocumentComparison,
  type DocumentSnapshot,
} from "./types.ts";

const normalize = (value: string) => value.replace(/\r\n?/g, "\n").normalize("NFC");
const key = (b: DocumentBlock) =>
  JSON.stringify([b.kind, normalize(b.text), b.cells?.map(normalize)]);
function withinLimits(s: DocumentSnapshot): boolean {
  let chars = 0,
    cells = 0;
  for (const b of s.blocks) {
    chars += b.text.length;
    cells += b.cells?.length ?? 0;
  }
  return (
    s.blocks.length <= DOCUMENT_LIMITS.blocks &&
    chars <= DOCUMENT_LIMITS.characters &&
    cells <= DOCUMENT_LIMITS.cells
  );
}
export function compareDocuments(
  previous: DocumentSnapshot,
  current: DocumentSnapshot,
): DocumentComparison {
  const limited: DocumentComparison = { status: "limit_exceeded", changes: [] };
  if (
    previous.v !== current.v ||
    previous.format !== current.format ||
    previous.parserVersion !== current.parserVersion ||
    previous.normalizationVersion !== current.normalizationVersion ||
    previous.extractionMode !== current.extractionMode ||
    previous.warnings.length ||
    current.warnings.length ||
    !withinLimits(previous) ||
    !withinLimits(current)
  )
    return limited;
  const a = previous.blocks.map(key),
    b = current.blocks.map(key);
  let start = 0,
    aEnd = a.length,
    bEnd = b.length;
  while (start < aEnd && start < bEnd && a[start] === b[start]) start++;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const n = aEnd - start,
    m = bEnd - start;
  if (n * m > DOCUMENT_LIMITS.alignmentCells) return limited;
  const width = m + 1,
    dp = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * width + j] =
        a[start + i] === b[start + j]
          ? 1 + (dp[(i + 1) * width + j + 1] ?? 0)
          : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
  const changes: DocumentChange[] = [],
    removed: DocumentBlock[] = [],
    added: DocumentBlock[] = [];
  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let k = 0; k < count; k++) {
      const before = removed[k],
        after = added[k];
      if (before && after && before.kind !== after.kind) {
        changes.push(
          { kind: "block_removed", path: before.path, before: before.text, after: null },
          { kind: "block_added", path: after.path, before: null, after: after.text },
        );
      } else
        changes.push({
          kind: before && after ? "block_modified" : before ? "block_removed" : "block_added",
          path: after?.path ?? before?.path ?? "",
          before: before?.text ?? null,
          after: after?.text ?? null,
        });
    }
    removed.length = 0;
    added.length = 0;
  };
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flush();
      i++;
      j++;
    } else if (
      i < n &&
      (j === m || (dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + j + 1] ?? 0))
    ) {
      const block = previous.blocks[start + i++];
      if (!block) return limited;
      removed.push(block);
    } else {
      const block = current.blocks[start + j++];
      if (!block) return limited;
      added.push(block);
    }
  }
  flush();
  return { status: changes.length ? "compared" : "no_changes", changes };
}

export function reviewOcrDocuments(
  previous: DocumentSnapshot,
  current: DocumentSnapshot,
): { status: "review_required"; changes: DocumentChange[] } | null {
  for (const snapshot of [previous, current]) {
    if (
      snapshot?.v !== 1 ||
      snapshot.normalizationVersion !== 1 ||
      snapshot.format !== "pdf" ||
      snapshot.extractionMode !== "ocr" ||
      typeof snapshot.parserVersion !== "string" ||
      !snapshot.parserVersion ||
      !Array.isArray(snapshot.warnings) ||
      snapshot.warnings.length !== 1 ||
      snapshot.warnings[0] !== "OCR 결과 원본 대조 필요" ||
      !Array.isArray(snapshot.coverage) ||
      !snapshot.coverage.every((item) => typeof item === "string") ||
      !Array.isArray(snapshot.blocks) ||
      !snapshot.blocks.length ||
      snapshot.blocks.length > DOCUMENT_LIMITS.blocks
    )
      return null;
    let characters = 0,
      cells = 0;
    for (const block of snapshot.blocks) {
      if (
        !block ||
        !["paragraph", "table-row", "slide", "page"].includes(block.kind) ||
        typeof block.path !== "string" ||
        !block.path ||
        typeof block.text !== "string"
      )
        return null;
      let cellCharacters = 0;
      if (block.cells !== undefined) {
        if (!Array.isArray(block.cells)) return null;
        cells += block.cells.length;
        if (cells > DOCUMENT_LIMITS.cells) return null;
        for (const cell of block.cells) {
          if (typeof cell !== "string") return null;
          cellCharacters += cell.length;
          if (cellCharacters > DOCUMENT_LIMITS.characters) return null;
        }
      }
      characters += Math.max(block.text.length, cellCharacters);
      if (characters > DOCUMENT_LIMITS.characters) return null;
    }
  }
  const result = compareDocuments({ ...previous, warnings: [] }, { ...current, warnings: [] });
  return result.status === "limit_exceeded"
    ? null
    : { status: "review_required", changes: result.changes };
}
