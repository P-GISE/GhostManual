import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { unsafeFile } from "./archive";

export type XmlNode = Record<string, unknown>;
const record = z.record(z.string(), z.unknown());
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  alwaysCreateTextNode: true,
});

export function node(value: unknown): XmlNode {
  if (value === undefined || value === "") return {};
  const result = record.safeParse(value);
  if (!result.success) throw unsafeFile();
  return result.data;
}

export function nodes(value: unknown): XmlNode[] {
  return value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(node);
}

export function xmlText(value: unknown): string {
  const raw = typeof value === "string" ? value : (node(value)["#text"] ?? "");
  if (typeof raw !== "string") throw unsafeFile();
  return raw.replace(/&([^;]+);/g, (_match, entity: string) => {
    const builtins: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (builtins[entity] !== undefined) return builtins[entity];
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) throw unsafeFile();
    const code = entity.startsWith("#x")
      ? Number.parseInt(entity.slice(2), 16)
      : Number(entity.slice(1));
    if (
      !(
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      )
    )
      throw unsafeFile();
    return String.fromCodePoint(code);
  });
}

export function attribute(value: XmlNode, key: string): string {
  return xmlText(value[`@_${key}`]);
}

export function parseXml(bytes: Uint8Array): XmlNode {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) || XMLValidator.validate(text) !== true)
    throw unsafeFile();
  const result: unknown = parser.parse(text);
  return node(result);
}

export function richText(value: unknown): string {
  const element = node(value);
  return (
    xmlText(element["t"]) +
    nodes(element["r"])
      .map((run) => xmlText(run["t"]))
      .join("")
  );
}
