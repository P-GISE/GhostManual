import { strToU8, zipSync } from "fflate";
export const enc = (text: string) => new TextEncoder().encode(text);
export const pack = (parts: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export function docx(body = "<w:p><w:r><w:t>한글</w:t></w:r></w:p>") {
  return {
    "[Content_Types].xml":
      '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": `<Relationships><Relationship Id="r1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
  };
}
export const wp = (s: string) => `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`;
export function hwpx(first = "첫째", second = "둘째") {
  return {
    mimetype: "application/hwp+zip",
    "Contents/content.hpf":
      '<opf:package xmlns:opf="opf"><opf:manifest><opf:item id="s1" href="section1.xml" media-type="application/xml"/><opf:item id="s0" href="section0.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="s1"/><opf:itemref idref="s0"/></opf:spine></opf:package>',
    "Contents/section0.xml": `<hs:sec xmlns:hs="hs" xmlns:hp="hp"><hp:p><hp:run><hp:t>${second}</hp:t></hp:run></hp:p></hs:sec>`,
    "Contents/section1.xml": `<hs:sec xmlns:hs="hs" xmlns:hp="hp"><hp:p><hp:run><hp:t>${first}</hp:t></hp:run></hp:p></hs:sec>`,
  };
}
export function pptx(first = "첫 슬라이드", second = "두 슬라이드") {
  return {
    "[Content_Types].xml":
      '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    "_rels/.rels": `<Relationships><Relationship Id="r1" Type="${rel}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    "ppt/presentation.xml":
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="2" r:id="r2"/><p:sldId id="1" r:id="r1"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="r1" Type="${rel}/slide" Target="slides/slide1.xml"/><Relationship Id="r2" Type="${rel}/slide" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${second}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${first}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  };
}
