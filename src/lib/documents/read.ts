import { AppError } from "../errors.ts";
import { type DocumentPackage, documentPackage, manifestPart, relationships } from "./archive.ts";
import { csvText, readCsv, validateCsv } from "./csv.ts";
import {
  DOCUMENT_LIMITS,
  type DocumentBlock,
  type DocumentExtraction,
  type DocumentFormat,
  type DocumentSnapshot,
} from "./types.ts";
import { attr, children, descendants, type Element, unsafeDocument } from "./xml.ts";

class ExtractionLimit extends Error {}
function checkSize(bytes: Uint8Array): void {
  if (bytes.length > DOCUMENT_LIMITS.fileBytes)
    throw new AppError("file_too_large", 413, "파일은 5 MB까지 올릴 수 있습니다.");
  if (!bytes.length) throw unsafeDocument();
}
function staticCheck(format: DocumentFormat, bytes: Uint8Array): DocumentPackage | null {
  checkSize(bytes);
  if (format === "docx" || format === "hwpx" || format === "pptx")
    return documentPackage(format, bytes);
  if (format === "csv") {
    csvText(bytes);
    return null;
  }
  if (format === "pdf") {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
    const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
    if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(head) || !tail.includes("%%EOF"))
      throw unsafeDocument();
    return null;
  }
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    b.length < 512 ||
    b.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1" ||
    b.readUInt16LE(28) !== 0xfffe ||
    ![9, 12].includes(b.readUInt16LE(30)) ||
    b.readUInt16LE(32) !== 6
  )
    throw unsafeDocument();
  return null;
}
export function detectDocumentFormat(fileName: string, bytes: Uint8Array): DocumentFormat {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (
    !extension ||
    !["docx", "hwpx", "pptx", "csv", "hwp", "doc", "ppt", "pdf"].includes(extension)
  )
    throw new AppError("unsupported_file_type", 422, "지원하는 문서 형식으로 올려주세요.");
  const format = extension as DocumentFormat;
  try {
    staticCheck(format, bytes);
    return format;
  } catch (error) {
    if (error instanceof AppError && error.code === "file_too_large") throw error;
    throw unsafeDocument();
  }
}
const omitted = new Set([
  "del",
  "moveFrom",
  "delText",
  "instrText",
  "footnoteReference",
  "endnoteReference",
  "commentReference",
  "drawing",
  "pict",
  "txbxContent",
  "header",
  "footer",
  "footNote",
  "endNote",
  "memo",
]);
function hidden(node: Element): boolean {
  const properties = children(node, "rPr");
  return properties.some((p) =>
    [...children(p, "vanish"), ...children(p, "webHidden")].some(
      (n) => !["0", "false", "off"].includes(attr(n, "val")),
    ),
  );
}
function excluded(node: Element): boolean {
  return omitted.has(node.name) || (node.name === "r" && hidden(node));
}
function removeHiddenStyles(body: Element, pkg: DocumentPackage): void {
  const ref = [...relationships(pkg, pkg.main).values()].find((r) => r.type.endsWith("/styles"));
  const styles = ref ? pkg.xml.get(ref.path) : undefined;
  if (!styles) return;
  const byId = new Map(children(styles, "style").map((style) => [attr(style, "styleId"), style]));
  type Visibility = { vanish: boolean; webHidden: boolean };
  const value = (props: Element | undefined, key: keyof Visibility): boolean | undefined => {
    const flag = props && children(props, key)[0];
    return flag ? !["0", "false", "off"].includes(attr(flag, "val")) : undefined;
  };
  function styleState(id: string, inherited: Visibility, seen = new Set<string>()): Visibility {
    if (!id) return inherited;
    if (seen.has(id)) throw unsafeDocument();
    seen.add(id);
    const style = byId.get(id);
    if (!style) return inherited;
    const base = styleState(attr(children(style, "basedOn")[0] ?? style, "val"), inherited, seen);
    const props = children(style, "rPr")[0];
    // Word's vanish toggles within styles; direct formatting below is absolute.
    return {
      vanish: value(props, "vanish") ? !base.vanish : base.vanish,
      webHidden: value(props, "webHidden") ?? base.webHidden,
    };
  }
  const defaults = descendants(styles, "rPrDefault")[0]?.children.find((n) => n.name === "rPr");
  const initial = {
    vanish: value(defaults, "vanish") ?? false,
    webHidden: value(defaults, "webHidden") ?? false,
  };
  const defaultParagraph = children(styles, "style").find(
    (s) => attr(s, "type") === "paragraph" && ["1", "true"].includes(attr(s, "default")),
  );
  function visit(node: Element, inherited: Visibility): void {
    let state = inherited;
    if (node.name === "p") {
      const props = children(node, "pPr")[0];
      const style = props && children(props, "pStyle")[0];
      state = styleState(
        style ? attr(style, "val") : defaultParagraph ? attr(defaultParagraph, "styleId") : "",
        initial,
      );
    }
    node.children = node.children.filter((child) => {
      if (child.name === "r") {
        const props = children(child, "rPr")[0];
        const style = props && children(props, "rStyle")[0];
        const styled = styleState(style ? attr(style, "val") : "", state);
        if (
          (value(props, "vanish") ?? styled.vanish) ||
          (value(props, "webHidden") ?? styled.webHidden)
        )
          return false;
      }
      visit(child, state);
      return true;
    });
  }
  visit(body, initial);
}
function inline(node: Element): string {
  if (excluded(node)) return "";
  if (node.name === "t")
    return node.children.map((c) => (c.name === "#text" ? c.text : inline(c))).join("");
  if (node.name === "tab") return "\t";
  if (node.name === "br" || node.name === "cr" || node.name === "lineBreak") return "\n";
  if (node.name === "noBreakHyphen") return "\u2011";
  if (node.name === "softHyphen") return "\u00ad";
  return node.children.map(inline).join("");
}
function currentRows(table: Element): Element[] {
  return descendants(table, "tr").filter(
    (row) => !children(row, "trPr").some((props) => children(props, "del").length > 0),
  );
}
function cellText(cell: Element): string {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current) pieces.push(current);
    current = "";
  };
  function visit(node: Element): void {
    if (excluded(node)) return;
    if (node.name === "tbl") {
      flush();
      for (const row of currentRows(node))
        pieces.push(descendants(row, "tc").map(cellText).join("\t"));
      return;
    }
    if (node.name === "p") {
      flush();
      const start = pieces.length;
      node.children.forEach(visit);
      if (current || pieces.length === start) pieces.push(current);
      current = "";
      return;
    }
    if (["t", "tab", "br", "cr", "lineBreak", "noBreakHyphen", "softHyphen"].includes(node.name)) {
      current += inline(node);
      return;
    }
    node.children.forEach(visit);
  }
  cell.children.forEach(visit);
  flush();
  return pieces.join("\n");
}
function extractBody(
  root: Element,
  prefix: string,
  paragraphKind: DocumentBlock["kind"],
  emit: (b: DocumentBlock) => void,
): void {
  let index = 0;
  const block = (text: string, cells?: string[]) =>
    emit({
      kind: cells ? "table-row" : paragraphKind,
      path: `${prefix}/block/${++index}`,
      text,
      ...(cells ? { cells } : {}),
    });
  function table(node: Element): void {
    for (const row of currentRows(node)) {
      const cells = descendants(row, "tc").map(cellText);
      block(cells.join("\t"), cells);
    }
  }
  function paragraph(node: Element): void {
    let current = "",
      hasTable = false;
    const flush = () => {
      if (current) block(current);
      current = "";
    };
    function visit(n: Element): void {
      if (excluded(n)) return;
      if (n.name === "tbl") {
        hasTable = true;
        flush();
        table(n);
        return;
      }
      if (["t", "tab", "br", "cr", "lineBreak", "noBreakHyphen", "softHyphen"].includes(n.name)) {
        current += inline(n);
        return;
      }
      n.children.forEach(visit);
    }
    node.children.forEach(visit);
    if (current || !hasTable) block(current);
  }
  function visit(node: Element): void {
    if (excluded(node)) return;
    if (node.name === "tbl") table(node);
    else if (node.name === "p") paragraph(node);
    else node.children.forEach(visit);
  }
  visit(root);
}
function extractNative(format: DocumentFormat, bytes: Uint8Array): DocumentExtraction {
  const started = Date.now();
  const pkg = staticCheck(format, bytes);
  if (!["docx", "hwpx", "pptx", "csv"].includes(format))
    throw new AppError(
      "external_extractor_required",
      422,
      "이 형식은 격리된 문서 추출 서비스에서 처리해야 합니다.",
    );
  const coverage = ["텍스트와 표의 문자열 내용 비교; 서식·이미지·레이아웃 비교 제외"];
  const blocks: DocumentBlock[] = [];
  let chars = 0,
    cells = 0;
  const emit = (block: DocumentBlock) => {
    const text = block.text.replace(/\r\n?/g, "\n").normalize("NFC");
    chars += text.length;
    cells += block.cells?.length ?? 0;
    if (
      blocks.length >= DOCUMENT_LIMITS.blocks ||
      chars > DOCUMENT_LIMITS.characters ||
      cells > DOCUMENT_LIMITS.cells ||
      Date.now() - started > DOCUMENT_LIMITS.nativeMs
    )
      throw new ExtractionLimit();
    blocks.push({
      ...block,
      text,
      ...(block.cells
        ? { cells: block.cells.map((c) => c.replace(/\r\n?/g, "\n").normalize("NFC")) }
        : {}),
    });
  };
  try {
    if (format === "csv") {
      coverage.push("행·열 순서 유지; 첫 행의 헤더 추정 및 수식 실행 없음");
      let row = 0;
      const text = csvText(bytes);
      validateCsv(text);
      if (text.length > DOCUMENT_LIMITS.characters + DOCUMENT_LIMITS.cells * 3)
        throw new ExtractionLimit();
      readCsv(text, (cells) =>
        emit({ kind: "table-row", path: `row/${++row}`, text: cells.join("\t"), cells }),
      );
    } else if (pkg) {
      const main = pkg.xml.get(pkg.main);
      if (!main) throw unsafeDocument();
      if (format === "docx") {
        coverage.push(
          "현재 표시 본문 포함; 삭제 추적·각주·미주·댓글·숨김 텍스트·머리말·꼬리말·텍스트 상자 제외",
        );
        const body = children(main, "body");
        if (body.length !== 1 || !body[0]) throw unsafeDocument();
        removeHiddenStyles(body[0], pkg);
        extractBody(body[0], "body", "paragraph", emit);
      } else if (format === "hwpx") {
        coverage.push("spine 순서 본문·중첩 표 포함; 머리말·꼬리말·각주·미주·댓글·그림 제외");
        const items = new Map(
          descendants(main, "item").map((item) => [
            attr(item, "id"),
            manifestPart(pkg, attr(item, "href")),
          ]),
        );
        let section = 0;
        for (const ref of descendants(main, "itemref")) {
          const path = items.get(attr(ref, "idref"));
          const root = path ? pkg.xml.get(path) : undefined;
          if (root?.name === "head") continue;
          if (root?.name !== "sec") throw unsafeDocument();
          extractBody(root, `section/${++section}`, "paragraph", emit);
        }
        if (!section) throw unsafeDocument();
      } else {
        coverage.push(
          "presentation 순서의 슬라이드 텍스트·표 포함; 숨김 슬라이드·발표자 노트·도형 배치·애니메이션 제외",
        );
        const rels = relationships(pkg, pkg.main);
        let slide = 0;
        const seen = new Set<string>();
        for (const entry of descendants(main, "sldId")) {
          const id = entry.attributes["r:id"] ?? attr(entry, "id");
          const ref = rels.get(id);
          if (!ref?.type.endsWith("/slide") || seen.has(ref.path)) throw unsafeDocument();
          seen.add(ref.path);
          const root = pkg.xml.get(ref.path);
          if (root?.name !== "sld") throw unsafeDocument();
          slide++;
          if (["0", "false"].includes(attr(root, "show"))) continue;
          const trees = descendants(root, "spTree");
          if (trees.length !== 1 || !trees[0]) throw unsafeDocument();
          extractBody(trees[0], `slide/${slide}`, "slide", emit);
        }
        if (!slide) throw unsafeDocument();
      }
    }
  } catch (error) {
    if (error instanceof ExtractionLimit)
      return {
        status: "limited",
        snapshot: null,
        reason:
          "추출 내용이 문자·블록·셀 또는 처리 시간 한도를 초과했습니다. 전체 내용 비교를 완료하지 못했습니다.",
        coverage: [...coverage, "한도 초과로 전체 추출 미완료"],
      };
    throw error;
  }
  const snapshot: DocumentSnapshot = {
    v: 1,
    format,
    parserVersion: "native-1",
    normalizationVersion: 1,
    extractionMode: "native",
    blocks,
    coverage,
    warnings: [],
  };
  return { status: "ready", snapshot, reason: null, coverage };
}
export function readDocument(format: DocumentFormat, bytes: Uint8Array): DocumentExtraction {
  try {
    return extractNative(format, bytes);
  } catch (error) {
    return {
      status: "rejected",
      snapshot: null,
      reason:
        error instanceof AppError &&
        ["file_too_large", "external_extractor_required"].includes(error.code)
          ? error.message
          : unsafeDocument().message,
      coverage: [],
    };
  }
}
