import { parseAddress } from "./xlsx/coordinates.ts";
import type { Cell, Snapshot } from "./xlsx/index.ts";

export type CellChange = {
  sheet: string;
  address: string;
  before: Cell | null;
  after: Cell | null;
};

// A formula cell is unchanged while its formula is; a new cached result alone is not an edit.
function same(a: Cell | undefined, b: Cell | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.f !== undefined || b.f !== undefined) return a.f === b.f;
  return a.t === b.t && a.v === b.v;
}
function readingOrder(a: string, b: string): number {
  const x = parseAddress(a);
  const y = parseAddress(b);
  return x.row - y.row || x.col - y.col;
}
// Every cell that differs between two versions, kept on our server only (never sent to AI).
export function diffCells(before: Snapshot, after: Snapshot): CellChange[] {
  const names = [
    ...before.sheets.map((s) => s.name),
    ...after.sheets.map((s) => s.name).filter((n) => !before.sheets.some((s) => s.name === n)),
  ];
  return names.flatMap((name) => {
    const old = before.sheets.find((s) => s.name === name)?.cells ?? {};
    const now = after.sheets.find((s) => s.name === name)?.cells ?? {};
    return [...new Set([...Object.keys(old), ...Object.keys(now)])]
      .filter((address) => !same(old[address], now[address]))
      .sort(readingOrder)
      .map((address) => ({
        sheet: name,
        address,
        before: old[address] ?? null,
        after: now[address] ?? null,
      }));
  });
}
