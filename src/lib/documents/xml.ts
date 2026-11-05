import { XMLParser, XMLValidator } from "fast-xml-parser";
import { AppError } from "../errors.ts";
import { xmlText } from "../xlsx/xml.ts";
export type Element = {
  name: string;
  attributes: Record<string, string>;
  children: Element[];
  text: string;
};
export function unsafeDocument(): AppError {
  return new AppError(
    "unsafe_file",
    422,
    "파일 형식이나 안전 검사를 통과하지 못했습니다. 암호·매크로·외부 연결이 없는 파일로 다시 저장하세요.",
  );
}
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  cdataPropName: "#cdata",
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 80,
});
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw unsafeDocument();
  return value as Record<string, unknown>;
}
function convert(value: unknown): Element[] {
  if (!Array.isArray(value)) throw unsafeDocument();
  return value.map((entry: unknown) => {
    const row = record(entry);
    const key = Object.keys(row).find((k) => k !== ":@");
    if (!key) throw unsafeDocument();
    if (key === "#cdata") {
      if (!Array.isArray(row[key])) throw unsafeDocument();
      const text = (row[key] as unknown[])
        .map((value) => {
          const v = record(value)["#text"];
          if (typeof v !== "string") throw unsafeDocument();
          return v;
        })
        .join("");
      return { name: "#text", attributes: {}, children: [], text };
    }
    if (key === "#text")
      return { name: "#text", attributes: {}, children: [], text: xmlText(row[key]) };
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(row[":@"] ? record(row[":@"]) : {}))
      attributes[name.replace(/^@_/, "")] = xmlText(value);
    return {
      name: key.split(":").at(-1) ?? key,
      attributes,
      children: convert(row[key]),
      text: "",
    };
  });
}
export function parseOrderedXml(bytes: Uint8Array): Element {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) || XMLValidator.validate(text) !== true)
    throw unsafeDocument();
  let tags = 0;
  for (const _match of text.matchAll(/<[A-Za-z_]/g)) {
    if (++tags > 100000) throw unsafeDocument();
  }
  const roots = convert(parser.parse(text)).filter((n) => n.name !== "#text");
  if (roots.length !== 1 || !roots[0]) throw unsafeDocument();
  return roots[0];
}
export function attr(node: Element, name: string): string {
  return (
    node.attributes[name] ??
    Object.entries(node.attributes).find(([key]) => key.split(":").at(-1) === name)?.[1] ??
    ""
  );
}
export function children(node: Element, name: string): Element[] {
  return node.children.filter((c) => c.name === name);
}
export function descendants(node: Element, name: string): Element[] {
  return node.children.flatMap((c) => (c.name === name ? [c] : descendants(c, name)));
}
export function textContent(node: Element): string {
  return node.name === "#text" ? node.text : node.children.map(textContent).join("");
}
