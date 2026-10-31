import { formatAddress, parseAddress } from "./coordinates.ts";
import { normalizeFormula } from "./formula.ts";
import type { Cell, ChangeGroup, ChangeKind, SheetSnapshot, Snapshot } from "./types.ts";

const priority: Readonly<Record<ChangeKind, number>> = {
  sheet_added: 0,
  sheet_removed: 0,
  formula_added: 1,
  formula_changed: 1,
  formula_removed: 1,
  filter_changed: 2,
  names_changed: 3,
  size_changed: 4,
  values_changed: 5,
};

function addressOrder(a: string, b: string): number {
  const left = parseAddress(a);
  const right = parseAddress(b);
  return left.row - right.row || left.col - right.col;
}

function rangeOf(addresses: readonly string[]): string {
  let minRow = Infinity;
  let maxRow = 0;
  let minCol = Infinity;
  let maxCol = 0;
  for (const address of addresses) {
    const { row, col } = parseAddress(address);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
  }
  const first = formatAddress({ row: minRow, col: minCol });
  const last = formatAddress({ row: maxRow, col: maxCol });
  return first === last ? first : `${first}:${last}`;
}

function scalar(cell: Cell | undefined): string {
  return !cell || cell.t === "z" ? "" : JSON.stringify([cell.t, cell.v]);
}

function rowMultiset(sheet: SheetSnapshot): string {
  const rows = new Map<number, string[]>();
  for (const address of Object.keys(sheet.cells).sort(addressOrder)) {
    const cell = sheet.cells[address];
    if (!cell || (!cell.f && !scalar(cell))) continue;
    const { row, col } = parseAddress(address);
    const contents = rows.get(row) ?? [];
    contents.push(JSON.stringify([col, cell.t, cell.v, cell.f ?? null]));
    rows.set(row, contents);
  }
  return JSON.stringify([...rows.values()].map((row) => JSON.stringify(row)).sort());
}

function filterValue(sheet: SheetSnapshot): string {
  const filter = sheet.autoFilter;
  return filter
    ? JSON.stringify([
        filter.ref,
        [...filter.columns]
          .sort((a, b) => a.col - b.col)
          .map(({ col, filter: condition }) => [col, condition]),
      ])
    : "";
}

function namesValue(snapshot: Snapshot): string {
  return JSON.stringify(snapshot.names.map(({ name, ref }) => JSON.stringify([name, ref])).sort());
}

function cellChanges(before: SheetSnapshot, after: SheetSnapshot): ChangeGroup[] {
  const values: string[] = [];
  const formulas = new Map<
    string,
    { kind: ChangeKind; addresses: string[]; before?: string; after?: string }
  >();
  const addresses = [...new Set([...Object.keys(before.cells), ...Object.keys(after.cells)])].sort(
    addressOrder,
  );
  for (const address of addresses) {
    const previous = before.cells[address];
    const next = after.cells[address];
    if (previous?.f !== undefined || next?.f !== undefined) {
      if (previous?.f === next?.f) continue;
      const kind =
        previous?.f === undefined
          ? "formula_added"
          : next?.f === undefined
            ? "formula_removed"
            : "formula_changed";
      const key = JSON.stringify([
        kind,
        parseAddress(address).col,
        previous?.f === undefined ? null : normalizeFormula(previous.f, address),
        next?.f === undefined ? null : normalizeFormula(next.f, address),
      ]);
      let group = formulas.get(key);
      if (!group) {
        group = {
          kind,
          addresses: [],
          ...(previous?.f === undefined ? {} : { before: previous.f }),
          ...(next?.f === undefined ? {} : { after: next.f }),
        };
        formulas.set(key, group);
      }
      group.addresses.push(address);
    } else if (scalar(previous) !== scalar(next)) values.push(address);
  }
  const changes: ChangeGroup[] = [...formulas.values()].map((group) => ({
    kind: group.kind,
    sheet: after.name,
    range: rangeOf(group.addresses),
    summary: {
      count: group.addresses.length,
      ...(group.before === undefined ? {} : { before: group.before }),
      ...(group.after === undefined ? {} : { after: group.after }),
    },
  }));
  if (values.length) {
    const nonempty = Math.max(
      Object.values(before.cells).filter((cell) => cell.f !== undefined || scalar(cell)).length,
      Object.values(after.cells).filter((cell) => cell.f !== undefined || scalar(cell)).length,
    );
    const reordered = values.length >= nonempty * 0.3 && rowMultiset(before) === rowMultiset(after);
    changes.push({
      kind: "values_changed",
      sheet: after.name,
      range: rangeOf(values),
      summary: { count: values.length, ...(reordered ? { note: "rows_may_be_reordered" } : {}) },
    });
  }
  return changes;
}

export function compareSnapshots(before: Snapshot, after: Snapshot): ChangeGroup[] {
  const previous = new Map(before.sheets.map((sheet) => [sheet.name, sheet]));
  const current = new Map(after.sheets.map((sheet) => [sheet.name, sheet]));
  const changes: ChangeGroup[] = [];
  for (const sheet of after.sheets) {
    const old = previous.get(sheet.name);
    if (!old) {
      changes.push({
        kind: "sheet_added",
        sheet: sheet.name,
        range: null,
        summary: { rows: sheet.rows, cols: sheet.cols },
      });
      continue;
    }
    changes.push(...cellChanges(old, sheet));
    if (filterValue(old) !== filterValue(sheet))
      changes.push({
        kind: "filter_changed",
        sheet: sheet.name,
        range: sheet.autoFilter?.ref ?? old.autoFilter?.ref ?? null,
        summary: {},
      });
    if (old.rows !== sheet.rows || old.cols !== sheet.cols)
      changes.push({
        kind: "size_changed",
        sheet: sheet.name,
        range: null,
        summary: {
          before: { rows: old.rows, cols: old.cols },
          after: { rows: sheet.rows, cols: sheet.cols },
        },
      });
  }
  for (const sheet of before.sheets) {
    if (!current.has(sheet.name))
      changes.push({
        kind: "sheet_removed",
        sheet: sheet.name,
        range: null,
        summary: { rows: sheet.rows, cols: sheet.cols },
      });
  }
  if (namesValue(before) !== namesValue(after))
    changes.push({ kind: "names_changed", sheet: null, range: null, summary: {} });
  const sheetOrder = new Map(
    [...new Set([...after.sheets, ...before.sheets].map((sheet) => sheet.name))].map(
      (name, index) => [name, index],
    ),
  );
  return changes.sort(
    (a, b) =>
      priority[a.kind] - priority[b.kind] ||
      (sheetOrder.get(a.sheet ?? "") ?? -1) - (sheetOrder.get(b.sheet ?? "") ?? -1) ||
      addressOrder(a.range?.split(":")[0] ?? "A1", b.range?.split(":")[0] ?? "A1") ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
}
