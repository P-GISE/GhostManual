export type Cell = {
  t: "s" | "n" | "b" | "e" | "z";
  v: string | number | boolean | null;
  f?: string;
};

export type SheetSnapshot = {
  name: string;
  hidden: boolean;
  rows: number;
  cols: number;
  cells: Record<string, Cell>;
  autoFilter?: {
    ref: string;
    columns: { col: number; filter: string }[];
  };
};

export type Snapshot = {
  v: 1;
  sheets: SheetSnapshot[];
  names: { name: string; ref: string }[];
};

export type ReadResult = { status: "compared"; snapshot: Snapshot } | { status: "limit_exceeded" };

export type ChangeKind =
  | "sheet_added"
  | "sheet_removed"
  | "formula_added"
  | "formula_changed"
  | "formula_removed"
  | "filter_changed"
  | "names_changed"
  | "size_changed"
  | "values_changed";

export type ChangeGroup = {
  kind: ChangeKind;
  sheet: string | null;
  range: string | null;
  summary: Record<string, unknown>;
};

export type RuleQuestion = {
  kind: "purpose" | "origin" | "change" | "other";
  groupIndexes: number[];
  question: string;
};
