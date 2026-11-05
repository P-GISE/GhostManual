import { unsafeFile } from "./archive.ts";

export function parseAddress(address: string): { row: number; col: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(address);
  if (!match?.[1] || !match[2]) throw unsafeFile();
  const col = [...match[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  if (col > 16384 || row > 1048576) throw unsafeFile();
  return { row, col };
}

export function formatAddress({ row, col }: { row: number; col: number }): string {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 1 ||
    row > 1048576 ||
    col < 1 ||
    col > 16384
  )
    throw unsafeFile();
  let column = "";
  for (let value = col; value > 0; value = Math.floor((value - 1) / 26)) {
    column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
  }
  return `${column}${row}`;
}
