import { strToU8, zipSync } from "fflate";

const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function workbookParts(sheetXml?: string): Record<string, string> {
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="원본" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="정산범위">원본!$A$1:$B$2</definedName></definedNames></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml":
      sheetXml ??
      `<worksheet xmlns="${main}"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>거래처</t></is></c><c r="B1" t="inlineStr"><is><t>금액</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>합성상사</t></is></c><c r="B2"><v>100</v></c></row></sheetData></worksheet>`,
  };
}

export function pack(parts: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])),
    {
      level: 6,
      mtime: new Date(2026, 9, 29),
    },
  );
}

export function worksheet(body: string): string {
  return `<worksheet xmlns="${main}">${body}</worksheet>`;
}

export function demoParts(): Record<string, string> {
  const parts = workbookParts(
    worksheet(
      `<dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>거래처</t></is></c><c r="B1" t="inlineStr"><is><t>금액</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>합성상사</t></is></c><c r="B2"><v>150</v></c><c r="C2"><f>SUM(B2:B2)</f><v>150</v></c></row><row r="3"><c r="B3"><v>25</v></c></row></sheetData>`,
    ),
  );
  parts["xl/workbook.xml"] =
    `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="원본" sheetId="1" r:id="rId1"/><sheet name="정산" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="정산범위">원본!$A$1:$C$3</definedName></definedNames></workbook>`;
  parts["xl/_rels/workbook.xml.rels"] =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
  parts["xl/worksheets/sheet2.xml"] = worksheet(
    `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>합계</t></is></c><c r="B1"><f>SUM(원본!B2:B3)</f><v>175</v></c></row></sheetData>`,
  );
  parts["[Content_Types].xml"] =
    parts["[Content_Types].xml"]?.replace(
      "</Types>",
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ) ?? "";
  return parts;
}
