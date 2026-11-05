import { describe, expect, it } from "vitest";
import { compareDocuments } from "../../src/lib/documents/compare";
import { detectDocumentFormat, readDocument } from "../../src/lib/documents/read";
import { docx, enc, hwpx, pack, pptx, wp } from "../fixtures/documents/native/build";

describe("native document extraction", () => {
  it.each(["docx", "hwpx", "pptx"] as const)("validates and reads two %s versions", (format) => {
    const build = { docx, hwpx, pptx }[format];
    const a = pack(build());
    const b = pack(build(format === "docx" ? wp("새 값") : "새 값"));
    expect(detectDocumentFormat(`test.${format}`, a)).toBe(format);
    const old = readDocument(format, a);
    const next = readDocument(format, b);
    expect(old.status).toBe("ready");
    expect(next.status).toBe("ready");
    expect(old.snapshot).not.toBeNull();
    expect(next.snapshot).not.toBeNull();
    if (old.snapshot && next.snapshot)
      expect(compareDocuments(old.snapshot, next.snapshot).status).toBe("compared");
  });
  it("preserves DOCX paragraph/table/run order and excludes deleted/hidden/footnote text", () => {
    const body =
      wp("앞") +
      "<w:tbl><w:tr><w:tc>" +
      wp("셀") +
      "</w:tc><w:tc>" +
      wp("") +
      "</w:tc></w:tr></w:tbl>" +
      "<w:p><w:r><w:t>A</w:t></w:r><w:del><w:r><w:delText>OLD_SECRET</w:delText></w:r></w:del><w:ins><w:r><w:t>B</w:t></w:r></w:ins><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN</w:t></w:r><w:r><w:t>C &amp; D</w:t></w:r></w:p>";
    const parts = docx(body);
    Object.assign(parts, { "word/footnotes.xml": "<footnotes><p>FOOTNOTE</p></footnotes>" });
    const r = readDocument("docx", pack(parts));
    expect(r.snapshot?.blocks.map((b) => b.text)).toEqual(["앞", "셀\t", "ABC & D"]);
    expect(r.snapshot?.blocks[1]?.cells).toEqual(["셀", ""]);
    expect(r.coverage.join(" ")).toMatch(/삭제|deleted/);
  });
  it("uses HWPX spine order with mixed and nested table runs", () => {
    const parts = hwpx();
    parts["Contents/section1.xml"] =
      "<sec><p><run><t>앞</t><tbl><tr><tc><subList><p><run><t>셀</t><tbl><tr><tc><subList><p><run><t>중첩</t></run></p></subList></tc></tr></tbl><t>뒤셀</t></run></p></subList></tc><tc><subList><p/></subList></tc></tr></tbl><t>뒤</t></run></p></sec>";
    const r = readDocument("hwpx", pack(parts));
    expect(r.snapshot?.blocks.map((b) => b.text)).toEqual(["앞", "셀\n중첩\n뒤셀\t", "뒤", "둘째"]);
  });
  it("uses PPTX relationship order, extracts tables, excludes hidden slides and notes", () => {
    const parts = pptx();
    parts["ppt/slides/slide2.xml"] =
      "<sld><cSld><spTree><sp><txBody><p><r><t>앞</t></r></p></txBody></sp><graphicFrame><graphic><graphicData><tbl><tr><tc><txBody><p><r><t>셀</t></r></p></txBody></tc><tc><txBody><p/></txBody></tc></tr></tbl></graphicData></graphic></graphicFrame><sp><txBody><p><r><t>뒤</t></r></p></txBody></sp></spTree></cSld></sld>";
    parts["ppt/slides/slide1.xml"] = parts["ppt/slides/slide1.xml"].replace(
      "<p:sld ",
      '<p:sld show="0" ',
    );
    Object.assign(parts, { "ppt/notesSlides/notesSlide1.xml": "<notes>SECRET_NOTE</notes>" });
    const r = readDocument("pptx", pack(parts));
    expect(r.snapshot?.blocks.map((b) => b.text)).toEqual(["앞", "셀\t", "뒤"]);
  });
  it("reads UTF8 BOM CRLF quoted multiline/escaped CSV without numeric or formula conversion", () => {
    const r = readDocument("csv", enc('\ufeff한글,"a,b",001\r\n"line1\r\nline2","a""b",=1+1\r\n'));
    expect(r.status).toBe("ready");
    expect(r.snapshot?.blocks.map((b) => b.cells)).toEqual([
      ["한글", "a,b", "001"],
      ["line1\nline2", 'a"b', "=1+1"],
    ]);
  });
  it.each(['a,"unclosed', '"a"x,b', 'a"b,c'])("rejects malformed CSV %s", (input) =>
    expect(readDocument("csv", enc(input)).status).toBe("rejected"),
  );
  it("rejects invalid UTF8 and binary disguised as CSV", () => {
    expect(() => detectDocumentFormat("x.csv", new Uint8Array([0xff, 0xfe]))).toThrow();
    expect(() => detectDocumentFormat("x.csv", enc("a\0b"))).toThrow();
  });
  it.each([
    "../escape.xml",
    "/escape.xml",
    "word/vbaProject.bin",
    "EncryptionInfo",
    "word/embeddings/object.bin",
  ])("rejects unsafe part %s", (name) => {
    const parts = docx();
    Object.assign(parts, { [name]: "unsafe" });
    expect(() => detectDocumentFormat("x.docx", pack(parts))).toThrow();
    expect(readDocument("docx", pack(parts)).status).toBe("rejected");
  });
  it.each([
    '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>',
    "<a>".repeat(110) + "</a>".repeat(110),
    "<x><bad></x>",
  ])("rejects unsafe XML in unused parts", (xml) => {
    const parts = docx();
    Object.assign(parts, { "customXml/item.xml": xml });
    expect(readDocument("docx", pack(parts)).status).toBe("rejected");
  });
  it.each([
    '<Relationship Id="r1" Type="x/hyperlink" Target="https://example.invalid" TargetMode="External"/>',
    '<Relationship Id="r1" Type="x/vbaProject" Target="renamed.dat"/>',
    '<Relationship Id="r1" Type="x/oleObject" Target="renamed.dat"/>',
    '<Relationship Id="r1" Type="x/image" Target="../../escape"/>',
  ])("rejects malicious relationships in every part", (rel) => {
    const parts = docx();
    Object.assign(parts, {
      "word/_rels/document.xml.rels": `<Relationships>${rel}</Relationships>`,
    });
    expect(readDocument("docx", pack(parts)).status).toBe("rejected");
  });
  it("rejects signature mismatch and unsupported native dispatch", () => {
    expect(() => detectDocumentFormat("x.pptx", pack(docx()))).toThrow();
    expect(() => detectDocumentFormat("x.docx", enc("text"))).toThrow();
    expect(readDocument("pdf", enc("%PDF-1.7\n%%EOF")).status).toBe("rejected");
  });
  it("rejects oversized upload and unsafe uninspected expansion", () => {
    expect(() => detectDocumentFormat("x.csv", new Uint8Array(5 * 1024 * 1024 + 1))).toThrow();
    const parts = docx();
    Object.assign(parts, { "unused.xml": `<x>${"x".repeat(11 * 1024 * 1024)}</x>` });
    expect(readDocument("docx", pack(parts)).status).toBe("rejected");
  });
  it("reports extraction limits without pretending content is unchanged", () => {
    const r = readDocument("csv", enc("x\n".repeat(5001)));
    expect(r.status).toBe("limited");
    expect(r.snapshot).toBeNull();
    expect(r.reason).toBeTruthy();
    expect(readDocument("csv", enc("x".repeat(200001))).status).toBe("limited");
    expect(readDocument("csv", enc(",".repeat(50000))).status).toBe("limited");
  });
});

it("excludes inherited hidden DOCX character and paragraph styles", () => {
  const parts = docx(
    '<w:p><w:pPr><w:pStyle w:val="HiddenParagraph"/></w:pPr><w:r><w:t>PARAGRAPH_SECRET</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rStyle w:val="Derived"/></w:rPr><w:t>STYLE_SECRET</w:t></w:r><w:r><w:t>Visible</w:t></w:r></w:p>',
  );
  Object.assign(parts, {
    "word/styles.xml":
      '<w:styles xmlns:w="w"><w:style w:type="character" w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="character" w:styleId="Derived"><w:basedOn w:val="Hidden"/></w:style><w:style w:type="paragraph" w:styleId="HiddenParagraph"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>',
    "word/_rels/document.xml.rels":
      '<Relationships><Relationship Id="style" Type="x/styles" Target="styles.xml"/></Relationships>',
  });
  const r = readDocument("docx", pack(parts));
  expect(JSON.stringify(r.snapshot)).not.toMatch(/SECRET/);
  expect(r.snapshot?.blocks.at(-1)?.text).toBe("Visible");
});
it("preserves CDATA literal ampersands and decodes XML entities exactly once", () => {
  const r = readDocument(
    "docx",
    pack(
      docx(
        "<w:p><w:r><w:t><![CDATA[A &amp; B]]></w:t></w:r><w:r><w:t>&amp;lt; &#xAC00;</w:t></w:r></w:p>",
      ),
    ),
  );
  expect(r.snapshot?.blocks[0]?.text).toBe("A &amp; B&lt; 가");
});
it("rejects unsupported alternate imported content instead of silently losing it", () => {
  const parts = docx(`${wp("Visible")}<w:altChunk r:id="alt"/>`);
  expect(readDocument("docx", pack(parts)).status).toBe("rejected");
});
it("never includes HWPX headers and footnotes in body coverage", () => {
  const parts = hwpx();
  parts["Contents/section1.xml"] =
    "<sec><p><run><t>Visible</t><ctrl><header><subList><p><run><t>HEADER_SECRET</t></run></p></subList></header><footNote><subList><p><run><t>NOTE_SECRET</t></run></p></subList></footNote></ctrl></run></p></sec>";
  expect(JSON.stringify(readDocument("hwpx", pack(parts)).snapshot)).not.toMatch(/SECRET/);
});
it.each(["docx", "hwpx", "pptx", "csv"] as const)(
  "one front insertion in real %s versions stays one added block",
  (format) => {
    let a: Uint8Array, b: Uint8Array;
    if (format === "docx") {
      a = pack(docx(wp("same") + wp("same") + wp("tail")));
      b = pack(docx(wp("new") + wp("same") + wp("same") + wp("tail")));
    } else if (format === "hwpx") {
      const first = hwpx();
      const second = hwpx();
      second["Contents/section1.xml"] = second["Contents/section1.xml"].replace(
        "<hp:p>",
        "<hp:p><hp:run><hp:t>new</hp:t></hp:run></hp:p><hp:p>",
      );
      a = pack(first);
      b = pack(second);
    } else if (format === "pptx") {
      const first = pptx();
      const second = pptx();
      second["ppt/slides/slide2.xml"] = second["ppt/slides/slide2.xml"].replace(
        "<a:p>",
        "<a:p><a:r><a:t>new</a:t></a:r></a:p><a:p>",
      );
      a = pack(first);
      b = pack(second);
    } else {
      a = enc("a,b\nsame,row\nsame,row");
      b = enc("new,row\na,b\nsame,row\nsame,row");
    }
    const before = readDocument(format, a).snapshot,
      after = readDocument(format, b).snapshot;
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (before && after)
      expect(compareDocuments(before, after).changes).toEqual([
        expect.objectContaining({ kind: "block_added", before: null }),
      ]);
  },
);
it("rejects encrypted ZIP flags, duplicate names and corrupt CRC", () => {
  const bytes = Buffer.from(pack(docx()));
  const encrypted = Buffer.from(bytes);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  for (let i = 0; i + 46 < encrypted.length; i++)
    if (encrypted.readUInt32LE(i) === 0x02014b50) {
      encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 8) | 1, i + 8);
      break;
    }
  expect(readDocument("docx", encrypted).status).toBe("rejected");
  const corrupt = Buffer.from(bytes);
  corrupt.writeUInt32LE((corrupt.readUInt32LE(14) ^ 1) >>> 0, 14);
  expect(readDocument("docx", corrupt).status).toBe("rejected");
  const parts = docx();
  Object.assign(parts, { "a.xml": "<a/>", "b.xml": "<b/>" });
  const duplicate = Buffer.from(pack(parts));
  for (let offset = duplicate.indexOf("b.xml"); offset !== -1; offset = duplicate.indexOf("b.xml"))
    duplicate.write("a.xml", offset);
  expect(readDocument("docx", duplicate).status).toBe("rejected");
});
it("rejects embedded executable magic despite a harmless extension", () => {
  const parts = docx();
  Object.assign(parts, { "word/media/image.dat": `MZ${"0".repeat(100)}` });
  expect(readDocument("docx", pack(parts)).status).toBe("rejected");
});

it("resolves HWPX root-style manifest hrefs and ignores header spine entries", () => {
  const parts = hwpx();
  parts["Contents/content.hpf"] = parts["Contents/content.hpf"]
    .replaceAll('href="section', 'href="Contents/section')
    .replace(
      "<opf:manifest>",
      '<opf:manifest><opf:item id="head" href="Contents/header.xml" media-type="application/xml"/>',
    )
    .replace("<opf:spine>", '<opf:spine><opf:itemref idref="head"/>');
  Object.assign(parts, { "Contents/header.xml": "<head><metadata>PRIVATE</metadata></head>" });
  const r = readDocument("hwpx", pack(parts));
  expect(r.status).toBe("ready");
  expect(r.snapshot?.blocks.map((b) => b.text)).toEqual(["첫째", "둘째"]);
});
it("preserves DOCX table rows inside content controls", () => {
  const parts = docx(
    `<w:tbl><w:sdt><w:sdtContent><w:tr><w:tc>${wp("셀")}</w:tc></w:tr></w:sdtContent></w:sdt></w:tbl>`,
  );
  expect(readDocument("docx", pack(parts)).snapshot?.blocks.map((b) => b.cells)).toEqual([["셀"]]);
});

it("applies DOCX hidden-style toggles while direct false restores visibility", () => {
  const parts = docx(
    '<w:p><w:r><w:rPr><w:rStyle w:val="StillHidden"/></w:rPr><w:t>SECRET</w:t></w:r><w:r><w:rPr><w:rStyle w:val="VisibleAgain"/></w:rPr><w:t>Visible</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Hidden"/><w:vanish w:val="false"/></w:rPr><w:t>Direct</w:t></w:r></w:p>',
  );
  Object.assign(parts, {
    "word/styles.xml":
      '<styles><style styleId="Hidden"><rPr><vanish/></rPr></style><style styleId="StillHidden"><basedOn val="Hidden"/><rPr><vanish val="false"/></rPr></style><style styleId="VisibleAgain"><basedOn val="Hidden"/><rPr><vanish/></rPr></style></styles>',
    "word/_rels/document.xml.rels":
      '<Relationships><Relationship Id="style" Type="x/styles" Target="styles.xml"/></Relationships>',
  });
  const r = readDocument("docx", pack(parts));
  expect(r.status).toBe("ready");
  expect(r.snapshot?.blocks[0]?.text).toBe("VisibleDirect");
});

describe("review round 1 regressions", () => {
  it("excludes tracked-deleted DOCX rows but retains inserted rows in the current-version diff", () => {
    const row = (text: string, properties = "") =>
      `<w:tr>${properties}<w:tc>${wp(text)}</w:tc></w:tr>`;
    const before = readDocument(
      "docx",
      pack(
        docx(
          `<w:tbl>${row("DELETED_ROW_SENTINEL")}${row("keep")}${row("inserted", "<w:trPr><w:ins/></w:trPr>")}</w:tbl>`,
        ),
      ),
    );
    const after = readDocument(
      "docx",
      pack(
        docx(
          `<w:tbl>${row("DELETED_ROW_SENTINEL", '<w:trPr><w:del w:id="1"/></w:trPr>')}${row("keep")}${row("inserted", "<w:trPr><w:ins/></w:trPr>")}</w:tbl>`,
        ),
      ),
    );
    expect(before.status).toBe("ready");
    expect(after.status).toBe("ready");
    expect(after.snapshot?.blocks.map((b) => b.text)).toEqual(["keep", "inserted"]);
    if (!before.snapshot || !after.snapshot) throw Error("expected snapshots");
    expect(compareDocuments(before.snapshot, after.snapshot).changes).toEqual([
      { kind: "block_removed", path: "body/block/1", before: "DELETED_ROW_SENTINEL", after: null },
    ]);
  });
  it("excludes tracked-deleted nested DOCX rows from current cell text and comparison", () => {
    const body = (deleted: boolean) =>
      `<w:tbl><w:tr><w:tc>${wp("Before")}<w:tbl><w:tr>${deleted ? "<w:trPr><w:del/></w:trPr>" : ""}<w:tc>${wp("NESTED_DELETED_SENTINEL")}</w:tc></w:tr><w:tr><w:tc>${wp("Nested keep")}</w:tc></w:tr></w:tbl>${wp("After")}</w:tc></w:tr></w:tbl>`;
    const before = readDocument("docx", pack(docx(body(false))));
    const after = readDocument("docx", pack(docx(body(true))));
    expect(after.status).toBe("ready");
    expect(after.snapshot?.blocks[0]?.cells).toEqual(["Before\nNested keep\nAfter"]);
    if (!before.snapshot || !after.snapshot) throw Error("expected snapshots");
    expect(compareDocuments(before.snapshot, after.snapshot).changes).toEqual([
      expect.objectContaining({
        kind: "block_modified",
        before: "Before\nNESTED_DELETED_SENTINEL\nNested keep\nAfter",
        after: "Before\nNested keep\nAfter",
      }),
    ]);
  });
  it.each([
    ["", "A", "B"],
    ["A", "", "B"],
    ["A", "B", ""],
  ])("preserves empty cell paragraph boundaries %j", (...paragraphs) => {
    const body = (texts: string[]) =>
      `<w:tbl><w:tr><w:tc>${texts.map(wp).join("")}</w:tc></w:tr></w:tbl>`;
    const before = readDocument("docx", pack(docx(body(paragraphs))));
    const after = readDocument("docx", pack(docx(body(["A", "B"]))));
    expect(before.status).toBe("ready");
    expect(after.status).toBe("ready");
    expect(before.snapshot?.blocks[0]?.cells).toEqual([paragraphs.join("\n")]);
    if (!before.snapshot || !after.snapshot) throw Error("expected snapshots");
    expect(compareDocuments(before.snapshot, after.snapshot).changes).toEqual([
      expect.objectContaining({
        kind: "block_modified",
        before: paragraphs.join("\n"),
        after: "A\nB",
      }),
    ]);
  });
  it.each(["x\n".repeat(5001), "x".repeat(350001) + "\n", ",".repeat(50000) + "\n"])(
    "validates CSV tails after overflow %#",
    (prefix) => {
      expect(readDocument("csv", enc(prefix + '"unterminated')).status).toBe("rejected");
      expect(readDocument("csv", enc(prefix + '"valid",tail\n')).status).toBe("limited");
    },
  );
});
