// Trailing date/version markers people add to the same working file: _1029, -2026-10-30, v2, (1), 최종, final.
const marker =
  /[\s_.-]*(\(\d+\)|v\d+|\d{4}(?:[-.]\d{2}){1,2}|\d{4,8}|최종|수정본|수정|복사본|final|copy)$/i;

// The name a workbook keeps across versions, used to suggest "new version of an existing source".
export function fileStem(fileName: string): string {
  let stem = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase();
  for (let next = stem.replace(marker, ""); next && next !== stem; next = stem.replace(marker, ""))
    stem = next;
  return stem.replace(/[\s_.-]+$/, "");
}
