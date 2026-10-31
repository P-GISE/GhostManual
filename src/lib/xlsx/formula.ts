import { AppError } from "../errors.ts";

type Reference = {
  readonly col: number;
  readonly row: number;
  readonly fixedCol: boolean;
  readonly fixedRow: boolean;
};

function reference(value: string): Reference | null {
  const match = /^(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)$/i.exec(value);
  if (!match?.[2] || !match[4]) return null;
  let col = 0;
  for (const character of match[2].toUpperCase()) col = col * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[4]);
  if (col > 16384 || row > 1048576) return null;
  return { col, row, fixedCol: match[1] === "$", fixedRow: match[3] === "$" };
}

function origin(value: string): Reference {
  const parsed = reference(value);
  if (!parsed) throw new AppError("unsafe_file", 422, "올바르지 않은 엑셀 셀 주소입니다.");
  return parsed;
}

function columnName(value: number): string {
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

type Axis = "cell" | "row" | "col";

function mapReferences(
  formula: string,
  transform: (value: Reference, axis: Axis) => string,
): string {
  let result = "";
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (character === '"' || character === "'") {
      const start = index++;
      while (index < formula.length) {
        if (formula[index++] === character) {
          if (formula[index] === character) index += 1;
          else break;
        }
      }
      result += formula.slice(start, index);
      continue;
    }
    if (character === "[") {
      const start = index++;
      let depth = 1;
      while (index < formula.length && depth > 0) {
        if (formula[index] === "[") depth += 1;
        if (formula[index] === "]") depth -= 1;
        index += 1;
      }
      result += formula.slice(start, index);
      continue;
    }
    const token = /^[\p{L}\p{N}_.$]+/u.exec(formula.slice(index))?.[0];
    if (!token) {
      result += character;
      index += 1;
      continue;
    }
    const end = index + token.length;
    const next = formula[end];
    const rightToken =
      next === ":" ? /^[\p{L}\p{N}_.$]+/u.exec(formula.slice(end + 1))?.[0] : undefined;
    const rangeEnd = end + 1 + (rightToken?.length ?? 0);
    if (next === "!" || (rightToken && formula[rangeEnd] === "!")) {
      const qualifierEnd = next === "!" ? end + 1 : rangeEnd + 1;
      result += formula.slice(index, qualifierEnd);
      index = qualifierEnd;
      continue;
    }
    const axis = /^\$?[A-Z]{1,3}$/i.test(token)
      ? "col"
      : /^\$?[1-9]\d*$/.test(token)
        ? "row"
        : null;
    if (rightToken && axis && formula[rangeEnd] !== "(" && formula[rangeEnd] !== "[") {
      const left = reference(axis === "col" ? `${token}$1` : `$A${token}`);
      const right = reference(axis === "col" ? `${rightToken}$1` : `$A${rightToken}`);
      if (left && right) {
        result += `${transform(left, axis)}:${transform(right, axis)}`;
        index = rangeEnd;
        continue;
      }
    }
    const parsed = reference(token);
    result += parsed && next !== "(" && next !== "[" ? transform(parsed, "cell") : token;
    index = end;
  }
  return result;
}

export function shiftFormula(formula: string, fromCell: string, toCell: string): string {
  const from = origin(fromCell);
  const to = origin(toCell);
  return mapReferences(formula, (value, axis) => {
    const col = value.col + (value.fixedCol ? 0 : to.col - from.col);
    const row = value.row + (value.fixedRow ? 0 : to.row - from.row);
    if (col < 1 || row < 1 || col > 16384 || row > 1048576) return "#REF!";
    const colText = `${value.fixedCol ? "$" : ""}${columnName(col)}`;
    const rowText = `${value.fixedRow ? "$" : ""}${row}`;
    return axis === "row" ? rowText : axis === "col" ? colText : colText + rowText;
  });
}

export function normalizeFormula(formula: string, cell: string): string {
  const from = origin(cell);
  return mapReferences(formula, (value, axis) => {
    const row = value.fixedRow ? `${value.row}` : `[${value.row - from.row}]`;
    const col = value.fixedCol ? `${value.col}` : `[${value.col - from.col}]`;
    return axis === "row" ? `R${row}` : axis === "col" ? `C${col}` : `R${row}C${col}`;
  });
}
