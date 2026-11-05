import { AppError } from "../errors.ts";
import { readArchive, unsafeFile } from "./archive.ts";
import type { ReadResult, SheetSnapshot } from "./types.ts";
import { readWorksheet, SnapshotLimitReached } from "./worksheet.ts";
import { attribute, node, nodes, parseXml, richText, type XmlNode, xmlText } from "./xml.ts";

const WORKBOOK_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

function readWorkbook(bytes: Uint8Array): ReadResult {
  const archive = readArchive(bytes);
  const documents = new Map<string, XmlNode>();
  for (const [name, content] of archive.parts) {
    if (/\.(xml|rels)$/i.test(name)) {
      const document = parseXml(content);
      if (
        /\.rels$/i.test(name) &&
        nodes(node(document["Relationships"])["Relationship"]).some((relationship) =>
          /\/(vbaproject|oleobject|activexcontrol|control)$/i.test(attribute(relationship, "Type")),
        )
      )
        throw unsafeFile();
      documents.set(name, document);
    }
  }
  const types = documents.get("[Content_Types].xml");
  const workbook = documents.get("xl/workbook.xml");
  const relationships = documents.get("xl/_rels/workbook.xml.rels");
  if (!types || !workbook || !relationships) throw unsafeFile();
  const overrides = nodes(node(types["Types"])["Override"]);
  const defaults = nodes(node(types["Types"])["Default"]);
  if (
    [...overrides, ...defaults].some((type) =>
      /macroenabled|vbaproject|activex|oleobject/i.test(attribute(type, "ContentType")),
    ) ||
    !overrides.some(
      (type) =>
        attribute(type, "PartName") === "/xl/workbook.xml" &&
        attribute(type, "ContentType") === WORKBOOK_TYPE,
    )
  )
    throw unsafeFile();
  const targets = new Map<string, string>();
  for (const relationship of nodes(node(relationships["Relationships"])["Relationship"])) {
    const id = attribute(relationship, "Id");
    if (!id || targets.has(id)) throw unsafeFile();
    const type = attribute(relationship, "Type");
    if (!type.endsWith("/worksheet")) continue;
    const target = attribute(relationship, "Target");
    if (
      attribute(relationship, "TargetMode") === "External" ||
      /[:\\]/.test(target) ||
      [...target].some((character) => character.charCodeAt(0) < 32) ||
      target.split("/").some((part) => part === ".." || part === ".")
    )
      throw unsafeFile();
    const path = target.startsWith("/xl/") ? target.slice(1) : `xl/${target}`;
    if (!path.startsWith("xl/worksheets/") || !archive.names.has(path)) throw unsafeFile();
    targets.set(id, path);
  }
  if (workbook["workbook"] === undefined) throw unsafeFile();
  const book = node(workbook["workbook"]);
  const sheetNodes = nodes(node(book["sheets"])["sheet"]);
  if (sheetNodes.length === 0) throw unsafeFile();
  const sheetNames = new Set<string>();
  for (const sheet of sheetNodes) {
    const name = attribute(sheet, "name");
    if (
      !name ||
      name.length > 31 ||
      sheetNames.has(name.toLowerCase()) ||
      !targets.has(attribute(sheet, "id"))
    )
      throw unsafeFile();
    sheetNames.add(name.toLowerCase());
  }
  // shortcut: oversized parts stay unparsed, only offer their original bytes as an attachment.
  if (archive.limited || sheetNodes.length > 20) return { status: "limit_exceeded" };
  const strings = nodes(node(documents.get("xl/sharedStrings.xml")?.["sst"])["si"]).map(richText);
  const sheets: SheetSnapshot[] = [];
  const budget = { cells: 0, bytes: 20 * 1024 * 1024 };
  for (const sheet of sheetNodes) {
    const path = targets.get(attribute(sheet, "id"));
    const xml = path ? documents.get(path) : undefined;
    if (!xml) throw unsafeFile();
    const data = readWorksheet(xml, strings, budget);
    sheets.push({
      name: attribute(sheet, "name"),
      hidden: ["hidden", "veryHidden"].includes(attribute(sheet, "state")),
      ...data,
    });
  }
  const names = nodes(node(book["definedNames"])["definedName"]).map((entry) => {
    const name = attribute(entry, "name");
    if (!name) throw unsafeFile();
    return { name, ref: xmlText(entry) };
  });
  return { status: "compared", snapshot: { v: 1, sheets, names } };
}

export function readXlsx(bytes: Uint8Array): ReadResult {
  try {
    return readWorkbook(bytes);
  } catch (error) {
    if (error instanceof SnapshotLimitReached) return { status: "limit_exceeded" };
    if (error instanceof AppError) throw error;
    if (error instanceof Error) throw unsafeFile();
    throw error;
  }
}
