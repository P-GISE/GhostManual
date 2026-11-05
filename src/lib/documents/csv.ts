import { unsafeDocument } from "./xml.ts";
export function csvText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unsafeDocument();
  }
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 && ![9, 10, 13].includes(code)) throw unsafeDocument();
  }
  return text.replace(/\r\n?/g, "\n");
}
export function validateCsv(text: string): void {
  parseCsv(text);
}
export function readCsv(text: string, emit: (cells: string[]) => void): void {
  parseCsv(text, emit);
}
function parseCsv(text: string, emit?: (cells: string[]) => void): void {
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false,
    started = false,
    cellStarted = false;
  const pushCell = () => {
    if (emit) row.push(cell);
    cell = "";
    closed = false;
    cellStarted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    started = true;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          if (emit) cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (emit) cell += char;
    } else if (char === ",") pushCell();
    else if (char === "\n") {
      pushCell();
      emit?.(row);
      row = [];
      started = false;
    } else if (char === '"' && !cellStarted && !closed) quoted = true;
    else {
      if (closed || char === '"') throw unsafeDocument();
      cellStarted = true;
      if (emit) cell += char;
    }
  }
  if (quoted) throw unsafeDocument();
  if (started) {
    pushCell();
    emit?.(row);
  }
}
