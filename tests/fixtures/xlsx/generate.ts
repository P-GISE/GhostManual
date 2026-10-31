import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoParts, pack, workbookParts, worksheet } from "./build.ts";

function settlement(after: boolean): Record<string, string> {
  const rows = Array.from({ length: 40 }, (_, index) => {
    const row = index + 1;
    if (row === 1)
      return `<row r="1">${["거래처", "공급가", "세금", "배송", "할인", "합계"].map((label, col) => `<c r="${String.fromCharCode(65 + col)}1" t="inlineStr"><is><t>${label}</t></is></c>`).join("")}</row>`;
    const changed = after && row <= 34;
    const cells =
      `<c r="A${row}" t="inlineStr"><is><t>합성상사-${row}${changed ? "-수정" : ""}</t></is></c>` +
      ["B", "C", "D", "E"]
        .map(
          (col) => `<c r="${col}${row}"><v>${row * 10 + (changed && col !== "E" ? 1 : 0)}</v></c>`,
        )
        .join("") +
      `<c r="F${row}"><f>${after ? `SUMIF(B${row}:E${row},&quot;&gt;0&quot;,B${row}:E${row})` : `SUM(B${row}:E${row})`}</f><v>${row * 40 + (changed ? 3 : 0)}</v></c>`;
    return `<row r="${row}">${cells}</row>`;
  }).join("");
  const parts = after ? demoParts() : workbookParts();
  parts["xl/worksheets/sheet1.xml"] = worksheet(
    `<dimension ref="A1:F40"/><sheetData>${rows}</sheetData>`,
  );
  const workbook = parts["xl/workbook.xml"];
  if (workbook)
    parts["xl/workbook.xml"] = workbook.replace(/원본!\$A\$1:\$[A-Z]\$[0-9]+/g, "원본!$A$1:$F$40");
  return parts;
}

const output = (name: string, bytes: Uint8Array) =>
  writeFileSync(fileURLToPath(new URL(name, import.meta.url)), bytes);
output("정산_1029.xlsx", pack(settlement(false)));
output("정산_1030.xlsx", pack(settlement(true)));
const macro = workbookParts();
macro["xl/vbaProject.bin"] = "SYNTHETIC MACRO MARKER - NOT EXECUTABLE";
output("macro.xlsx", pack(macro));
output("encrypted.xlsx", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
output("not-zip.xlsx", new TextEncoder().encode("Synthetic text fixture, not an Excel document."));
const rows = Array.from(
  { length: 50001 },
  (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>1</v></c></row>`,
).join("");
output("huge.xlsx", pack(workbookParts(worksheet(`<sheetData>${rows}</sheetData>`))));
