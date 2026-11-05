import { posix } from "node:path";
import { readArchive } from "../xlsx/archive.ts";
import type { DocumentFormat } from "./types.ts";
import {
  attr,
  children,
  descendants,
  type Element,
  parseOrderedXml,
  unsafeDocument,
} from "./xml.ts";
export type DocumentPackage = {
  xml: Map<string, Element>;
  parts: Map<string, Uint8Array>;
  main: string;
};
export function resolvePart(base: string, target: string): string {
  if (
    !target ||
    /[\\:%?#]/.test(target) ||
    [...target].some((c) => c.charCodeAt(0) < 32) ||
    target.startsWith("//")
  )
    throw unsafeDocument();
  const path = posix.normalize(
    target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(base), target),
  );
  if (path === ".." || path.startsWith("../") || path.startsWith("/")) throw unsafeDocument();
  return path;
}
export function manifestPart(pkg: DocumentPackage, target: string): string {
  const relative = resolvePart(pkg.main, target);
  return pkg.parts.has(relative) ? relative : resolvePart("", target);
}
export function relationshipPath(part: string): string {
  return posix.join(posix.dirname(part), "_rels", `${posix.basename(part)}.rels`);
}
export function relationships(
  pkg: DocumentPackage,
  part: string,
): Map<string, { path: string; type: string }> {
  const root = pkg.xml.get(part ? relationshipPath(part) : "_rels/.rels");
  const result = new Map<string, { path: string; type: string }>();
  if (!root) return result;
  if (root.name !== "Relationships") throw unsafeDocument();
  for (const node of children(root, "Relationship")) {
    const id = attr(node, "Id"),
      type = attr(node, "Type"),
      target = attr(node, "Target");
    if (
      !id ||
      result.has(id) ||
      attr(node, "TargetMode").toLowerCase() === "external" ||
      /\/(?:vbaproject|oleobject|package|activexcontrol|control|attachedtemplate)$/i.test(type)
    )
      throw unsafeDocument();
    const path = resolvePart(part, target);
    if (!pkg.parts.has(path)) throw unsafeDocument();
    result.set(id, { path, type });
  }
  return result;
}
export function documentPackage(format: DocumentFormat, bytes: Uint8Array): DocumentPackage {
  const archive = readArchive(bytes);
  // Uninspected parts cannot qualify for safe limited publication or download.
  if (archive.limited) throw unsafeDocument();
  const pkg: DocumentPackage = { parts: archive.parts, xml: new Map(), main: "" };
  for (const [name, content] of archive.parts) {
    const signature = Buffer.from(content.subarray(0, 8)).toString("hex");
    if (
      signature.startsWith("4d5a") ||
      signature.startsWith("7f454c46") ||
      signature === "d0cf11e0a1b11ae1" ||
      signature.startsWith("504b0304")
    )
      throw unsafeDocument();
    if (
      /(?:^|\/)(?:embeddings|activex|scripts)(?:\/|$)|\.(?:exe|dll|com|bat|cmd|vbs|js|ps1|bin)$/i.test(
        name,
      )
    )
      throw unsafeDocument();
    if (/\.(?:xml|rels|hpf)$/i.test(name)) pkg.xml.set(name, parseOrderedXml(content));
  }
  for (const [name, root] of pkg.xml) {
    if (
      descendants(root, "altChunk").length ||
      descendants(root, "object").length ||
      descendants(root, "OLEObject").length
    )
      throw unsafeDocument();
    if (/\.rels$/i.test(name)) {
      const match = name.match(/^(?:(.*)\/)?_rels\/(.*)\.rels$/);
      if (!match) throw unsafeDocument();
      const source = name === "_rels/.rels" ? "" : `${match[1] ? `${match[1]}/` : ""}${match[2]}`;
      relationships(pkg, source);
    }
    if (
      descendants(root, "Override")
        .concat(descendants(root, "Default"))
        .some((n) =>
          /macroenabled|vbaproject|activex|oleobject|ms-package/i.test(attr(n, "ContentType")),
        )
    )
      throw unsafeDocument();
  }
  if (format === "hwpx") {
    if (new TextDecoder().decode(pkg.parts.get("mimetype")) !== "application/hwp+zip")
      throw unsafeDocument();
    pkg.main = "Contents/content.hpf";
    const main = pkg.xml.get(pkg.main);
    if (main?.name !== "package") throw unsafeDocument();
    const items = new Map<string, string>();
    for (const item of descendants(main, "item")) {
      const id = attr(item, "id"),
        path = manifestPart(pkg, attr(item, "href"));
      if (
        !id ||
        items.has(id) ||
        !pkg.parts.has(path) ||
        /script|executable|oleobject/i.test(attr(item, "media-type"))
      )
        throw unsafeDocument();
      items.set(id, path);
    }
    const spine = descendants(main, "itemref");
    if (!spine.length) throw unsafeDocument();
    for (const item of spine) if (!items.has(attr(item, "idref"))) throw unsafeDocument();
  } else {
    const mainType =
      format === "docx" ? "wordprocessingml.document" : "presentationml.presentation";
    const mainRels = [...relationships(pkg, "").values()].filter((r) =>
      r.type.endsWith("/officeDocument"),
    );
    if (mainRels.length !== 1 || !mainRels[0]) throw unsafeDocument();
    pkg.main = mainRels[0].path;
    const types = pkg.xml.get("[Content_Types].xml");
    if (
      !types ||
      !children(types, "Override").some(
        (n) =>
          attr(n, "PartName") === `/${pkg.main}` &&
          attr(n, "ContentType") ===
            `application/vnd.openxmlformats-officedocument.${mainType}.main+xml`,
      )
    )
      throw unsafeDocument();
    if (pkg.xml.get(pkg.main)?.name !== (format === "docx" ? "document" : "presentation"))
      throw unsafeDocument();
  }
  return pkg;
}
