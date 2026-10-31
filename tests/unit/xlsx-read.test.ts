import { describe, expect, it } from "vitest";
import { readXlsx } from "../../src/lib/xlsx/read";
import { demoParts, pack, workbookParts, worksheet } from "../fixtures/xlsx/build";

describe("readXlsx", () => {
  it("bounds shared formula expansion across sheets before materializing the full snapshot", () => {
    const formula = `SUM(B1)+N(&quot;${"x".repeat(30000)}&quot;)`;
    const rows = Array.from(
      { length: 400 },
      (_, index) =>
        `<row r="${index + 1}"><c r="A${index + 1}">${index === 0 ? `<f t="shared" si="0" ref="A1:A400">${formula}</f>` : '<f t="shared" si="0"/>'}<v>1</v></c></row>`,
    ).join("");
    const parts = demoParts();
    parts["xl/worksheets/sheet1.xml"] = worksheet(`<sheetData>${rows}</sheetData>`);
    parts["xl/worksheets/sheet2.xml"] = worksheet(`<sheetData>${rows}</sheetData>`);
    expect(readXlsx(pack(parts))).toEqual({ status: "limit_exceeded" });
  });

  it("bounds repeated shared strings in the expanded snapshot", () => {
    const rows = Array.from(
      { length: 750 },
      (_, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="s"><v>0</v></c></row>`,
    ).join("");
    const parts = workbookParts(worksheet(`<sheetData>${rows}</sheetData>`));
    parts["xl/sharedStrings.xml"] = `<sst><si><t>${"가".repeat(10000)}</t></si></sst>`;
    expect(readXlsx(pack(parts))).toEqual({ status: "limit_exceeded" });
  });
  it("rejects renamed macro parts identified by a relationship", () => {
    const parts = workbookParts();
    parts["xl/custom.bin"] = "synthetic macro marker";
    parts["xl/_rels/workbook.xml.rels"] =
      parts["xl/_rels/workbook.xml.rels"]?.replace(
        "</Relationships>",
        '<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="custom.bin"/></Relationships>',
      ) ?? "";
    expect(() => readXlsx(pack(parts))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });

  it("rejects excessive XML nesting without overflowing the call stack", () => {
    const parts = workbookParts();
    parts["customXml/item.xml"] = "<a>".repeat(150) + "x" + "</a>".repeat(150);
    expect(() => readXlsx(pack(parts))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });
  it("reads Korean inline text, numeric values, dimensions and names", () => {
    const result = readXlsx(pack(workbookParts()));
    expect(result.status).toBe("compared");
    expect((result.status === "compared" ? result.snapshot : undefined)?.sheets[0]).toEqual({
      name: "원본",
      hidden: false,
      rows: 2,
      cols: 2,
      cells: {
        A1: { t: "s", v: "거래처" },
        B1: { t: "s", v: "금액" },
        A2: { t: "s", v: "합성상사" },
        B2: { t: "n", v: 100 },
      },
    });
    expect((result.status === "compared" ? result.snapshot : undefined)?.names).toEqual([
      { name: "정산범위", ref: "원본!$A$1:$B$2" },
    ]);
  });

  it("preserves rich shared strings, XML escapes, booleans and cached formula values", () => {
    const parts = workbookParts(
      worksheet(
        `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="b"><v>1</v></c><c r="C1"><f>IF(B1,1,0)</f><v>1</v></c></row></sheetData>`,
      ),
    );
    parts["xl/sharedStrings.xml"] =
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>A &amp; </t></r><r><t>B</t></r></si></sst>`;
    const result = readXlsx(pack(parts));
    expect((result.status === "compared" ? result.snapshot : undefined)?.sheets[0]?.cells).toEqual({
      A1: { t: "s", v: "A & B" },
      B1: { t: "b", v: true },
      C1: { t: "n", v: 1, f: "IF(B1,1,0)" },
    });
  });

  it("expands shared formulas while respecting absolute references and string literals", () => {
    const result = readXlsx(
      pack(
        workbookParts(
          worksheet(
            `<sheetData><row r="2"><c r="B2"><f t="shared" si="0" ref="B2:B3">A2+$C$1+LEN("A2")</f><v>5</v></c></row><row r="3"><c r="B3"><f t="shared" si="0"/><v>6</v></c></row></sheetData>`,
          ),
        ),
      ),
    );
    expect(
      (result.status === "compared" ? result.snapshot : undefined)?.sheets[0]?.cells["B3"]?.f,
    ).toBe('A3+$C$1+LEN("A2")');
  });

  it("captures filters and ignores style-only blank cells", () => {
    const result = readXlsx(
      pack(
        workbookParts(
          worksheet(
            `<sheetData><row r="1"><c r="A1" s="1"/><c r="B1" t="inlineStr"><is><t>금액</t></is></c></row></sheetData><autoFilter ref="B1:B9"><filterColumn colId="0"><filters><filter val="100"/></filters></filterColumn></autoFilter>`,
          ),
        ),
      ),
    );
    expect(
      (result.status === "compared" ? result.snapshot : undefined)?.sheets[0]?.cells["A1"],
    ).toBeUndefined();
    expect(
      (result.status === "compared" ? result.snapshot : undefined)?.sheets[0]?.autoFilter?.ref,
    ).toBe("B1:B9");
    expect(
      (result.status === "compared" ? result.snapshot : undefined)?.sheets[0]?.autoFilter
        ?.columns[0]?.filter,
    ).toContain("100");
  });

  it.each([
    "../escape.xml",
    "/absolute.xml",
    "C:/absolute.xml",
    "xl/vbaProject.bin",
    "EncryptionInfo",
  ])("rejects unsafe ZIP part %s", (name) => {
    const parts = workbookParts();
    parts[name] = "unsafe";
    expect(() => readXlsx(pack(parts))).toThrowError(
      expect.objectContaining({ code: "unsafe_file", httpStatus: 422 }),
    );
  });

  it.each([
    `<!DOCTYPE worksheet [<!ENTITY secret SYSTEM "file:///etc/passwd">]>`,
    `<!DOCTYPE worksheet>`,
    `<!ENTITY secret "value">`,
  ])("rejects XML declarations even in unused parts", (declaration) => {
    const parts = workbookParts();
    parts["customXml/item1.xml"] = `${declaration}<data/>`;
    expect(() => readXlsx(pack(parts))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });

  it("rejects malformed XML and out-of-bounds shared strings", () => {
    expect(() => readXlsx(pack(workbookParts("<worksheet><broken></worksheet>")))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
    expect(() =>
      readXlsx(
        pack(
          workbookParts(
            worksheet(`<sheetData><row><c r="A1" t="s"><v>99</v></c></row></sheetData>`),
          ),
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: "unsafe_file" }));
  });

  it("rejects external worksheet targets without opening the network", () => {
    const parts = workbookParts();
    parts["xl/_rels/workbook.xml.rels"] =
      `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://example.invalid/data" TargetMode="External"/></Relationships>`;
    expect(() => readXlsx(pack(parts))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });

  it("returns limit_exceeded for 21 sheets without returning a partial snapshot", () => {
    const parts = workbookParts();
    parts["xl/workbook.xml"] =
      `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${Array.from({ length: 21 }, (_, index) => `<sheet name="S${index}" sheetId="${index + 1}" r:id="rId1"/>`).join("")}</sheets></workbook>`;
    expect(readXlsx(pack(parts))).toEqual({ status: "limit_exceeded" });
  });

  it("returns limit_exceeded for over 50000 populated cells", () => {
    const rows = Array.from(
      { length: 50001 },
      (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>1</v></c></row>`,
    ).join("");
    expect(readXlsx(pack(workbookParts(worksheet(`<sheetData>${rows}</sheetData>`))))).toEqual({
      status: "limit_exceeded",
    });
  });

  it("returns limit_exceeded for oversized XML without inflating it", () => {
    const parts = workbookParts();
    parts["customXml/large.xml"] = `<data>${"x".repeat(10 * 1024 * 1024)}</data>`;
    expect(readXlsx(pack(parts))).toEqual({ status: "limit_exceeded" });
  });

  it("rejects unsafe names even when another part exceeds expansion limits", () => {
    const parts = workbookParts();
    parts["customXml/large.xml"] = `<data>${"x".repeat(10 * 1024 * 1024)}</data>`;
    parts["xl/vbaProject.bin"] = "macro";
    expect(() => readXlsx(pack(parts))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });

  it("rejects oversized uploads and non-ZIP input with stable errors", () => {
    expect(() => readXlsx(new Uint8Array(5 * 1024 * 1024 + 1))).toThrowError(
      expect.objectContaining({ code: "file_too_large", httpStatus: 413 }),
    );
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });

  it("rejects forged expanded sizes instead of allocating the advertised stream", () => {
    const parts = workbookParts();
    parts["customXml/bomb.xml"] = `<data>${"x".repeat(1024 * 1024)}</data>`;
    const bytes = Buffer.from(pack(parts));
    for (let offset = 0; offset + 46 < bytes.length; offset++) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
      const name = bytes
        .subarray(offset + 46, offset + 46 + bytes.readUInt16LE(offset + 28))
        .toString();
      if (name !== "customXml/bomb.xml") continue;
      const local = bytes.readUInt32LE(offset + 42);
      bytes.writeUInt32LE(1, offset + 24);
      bytes.writeUInt32LE(1, local + 22);
    }
    expect(() => readXlsx(bytes)).toThrowError(expect.objectContaining({ code: "unsafe_file" }));
  });

  it("rejects corrupted CRC and duplicate ZIP names", () => {
    const bytes = Buffer.from(pack(workbookParts()));
    bytes.writeUInt32LE(bytes.readUInt32LE(14) ^ 1, 14);
    expect(() => readXlsx(bytes)).toThrowError(expect.objectContaining({ code: "unsafe_file" }));
    const parts = workbookParts();
    parts["customXml/a.xml"] = "<a/>";
    parts["customXml/b.xml"] = "<b/>";
    const duplicate = Buffer.from(pack(parts));
    const oldName = Buffer.from("customXml/b.xml");
    for (
      let offset = duplicate.indexOf(oldName);
      offset !== -1;
      offset = duplicate.indexOf(oldName)
    ) {
      duplicate.write("customXml/a.xml", offset);
    }
    expect(() => readXlsx(duplicate)).toThrowError(
      expect.objectContaining({ code: "unsafe_file" }),
    );
  });
});
