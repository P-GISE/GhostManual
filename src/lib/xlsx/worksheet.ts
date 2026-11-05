import { unsafeFile } from "./archive.ts";
import { parseAddress } from "./coordinates.ts";
import { shiftFormula } from "./formula.ts";
import type { Cell, SheetSnapshot } from "./types.ts";
import { attribute, node, nodes, richText, type XmlNode, xmlText } from "./xml.ts";

type SharedFormula = { address: string; formula: string; range: string };

export class SnapshotLimitReached extends Error {}

// Workbook-scoped counters are consumed before each cell is materialized.
export type SnapshotBudget = { cells: number; bytes: number };

function cellBytes(address: string, cell: Cell): number {
  return Buffer.byteLength(JSON.stringify({ [address]: cell }));
}

function cellValue(cell: XmlNode, strings: readonly string[]): Cell {
  const raw = xmlText(cell["v"]);
  switch (attribute(cell, "t")) {
    case "s": {
      if (!/^[0-9]+$/.test(raw)) throw unsafeFile();
      const value = strings[Number(raw)];
      if (value === undefined) throw unsafeFile();
      return { t: "s", v: value };
    }
    case "inlineStr":
      return { t: "s", v: richText(cell["is"]) };
    case "str":
    case "d":
      return { t: "s", v: raw };
    case "b":
      if (raw !== "0" && raw !== "1") throw unsafeFile();
      return { t: "b", v: raw === "1" };
    case "e":
      return { t: "e", v: raw };
    case "n":
    case "": {
      if (raw === "") return { t: "z", v: null };
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))
        throw unsafeFile();
      return { t: "n", v: Number(raw) };
    }
    default:
      throw unsafeFile();
  }
}

function rangeEnds(range: string): { row: number; col: number }[] {
  const pieces = range.split(":");
  if (pieces.length > 2 || pieces.length === 0) throw unsafeFile();
  return pieces.map(parseAddress);
}

function inRange(address: string, range: string): boolean {
  const point = parseAddress(address);
  const ends = rangeEnds(range);
  const start = ends[0];
  const end = ends[1] ?? start;
  return (
    !!start &&
    !!end &&
    point.row >= start.row &&
    point.row <= end.row &&
    point.col >= start.col &&
    point.col <= end.col
  );
}

function filterValue(column: XmlNode): string {
  const filters = nodes(node(column["filters"])["filter"]);
  if (
    filters.length === 1 &&
    Object.keys(column).every((key) => key === "@_colId" || key === "filters" || key === "#text")
  ) {
    const first = filters[0];
    if (
      first &&
      Object.keys(node(column["filters"])).every((key) => key === "filter" || key === "#text")
    )
      return attribute(first, "val");
  }
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (typeof value === "string") return xmlText(value);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(node(value))
        .filter(([key, item]) => key !== "@_colId" && !(key === "#text" && item === ""))
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, ordered(item)]),
    );
  };
  return JSON.stringify(ordered(column));
}

export function readWorksheet(
  xml: XmlNode,
  strings: readonly string[],
  budget: SnapshotBudget,
): Omit<SheetSnapshot, "name" | "hidden"> {
  const sheet = node(xml["worksheet"]);
  if (xml["worksheet"] === undefined) throw unsafeFile();
  const sourceCells = nodes(node(sheet["sheetData"])["row"]).flatMap((row) => nodes(row["c"]));
  const shared = new Map<string, SharedFormula>();
  const addresses = new Set<string>();
  for (const cell of sourceCells) {
    const address = attribute(cell, "r");
    parseAddress(address);
    if (addresses.has(address)) throw unsafeFile();
    addresses.add(address);
    const formula = node(cell["f"]);
    if (attribute(formula, "t") === "shared" && xmlText(formula)) {
      const id = attribute(formula, "si");
      const range = attribute(formula, "ref");
      if (!/^[0-9]+$/.test(id) || shared.has(id) || !inRange(address, range)) throw unsafeFile();
      shared.set(id, { address, formula: xmlText(formula), range });
    }
  }
  const cells: Record<string, Cell> = {};
  let rows = 0;
  let cols = 0;
  const dimension = attribute(node(sheet["dimension"]), "ref");
  if (dimension) {
    for (const end of rangeEnds(dimension)) {
      rows = Math.max(rows, end.row);
      cols = Math.max(cols, end.col);
    }
  }
  for (const raw of sourceCells) {
    const address = attribute(raw, "r");
    const point = parseAddress(address);
    const value = cellValue(raw, strings);
    const formula = node(raw["f"]);
    let f = xmlText(formula);
    let sharedSource: SharedFormula | undefined;
    if (attribute(formula, "t") === "shared") {
      const source = shared.get(attribute(formula, "si"));
      if (!source || !inRange(address, source.range)) throw unsafeFile();
      sharedSource = source;
      f = source.formula;
    }
    if (raw["f"] !== undefined && !f) throw unsafeFile();
    if (value.v === null && !f) continue;
    if (budget.cells >= 50000) throw new SnapshotLimitReached();
    let cell = f ? { ...value, f } : value;
    if (cellBytes(address, cell) > budget.bytes) throw new SnapshotLimitReached();
    if (sharedSource) {
      f = shiftFormula(sharedSource.formula, sharedSource.address, address);
      cell = { ...value, f };
    }
    const size = cellBytes(address, cell);
    if (size > budget.bytes) throw new SnapshotLimitReached();
    budget.cells++;
    budget.bytes -= size;
    cells[address] = cell;
    rows = Math.max(rows, point.row);
    cols = Math.max(cols, point.col);
  }
  const autoFilter = node(sheet["autoFilter"]);
  const ref = attribute(autoFilter, "ref");
  if (!ref) return { rows, cols, cells };
  rangeEnds(ref);
  const columns = nodes(autoFilter["filterColumn"])
    .map((column) => {
      const id = attribute(column, "colId");
      if (!/^[0-9]+$/.test(id) || Number(id) >= 16384) throw unsafeFile();
      return { col: Number(id), filter: filterValue(column) };
    })
    .sort((a, b) => a.col - b.col);
  if (new Set(columns.map((column) => column.col)).size !== columns.length) throw unsafeFile();
  return { rows, cols, cells, autoFilter: { ref, columns } };
}
