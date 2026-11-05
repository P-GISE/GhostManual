import { request } from "node:https";
import { z } from "zod";
import { readDocument } from "./documents/read.ts";
import type { DocumentExtraction, DocumentFormat } from "./documents/types.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const reasons = [
  "invalid_document",
  "unsafe_document",
  "limit_exceeded",
  "empty_document",
  "ocr_uncertain",
  "timeout",
  "sandbox_unavailable",
  "parser_failed",
  "gateway_unavailable",
] as const;
const labels = {
  invalid_document: "문서 형식 또는 구조를 확인할 수 없습니다.",
  unsafe_document: "암호·매크로·내장 객체가 있는 문서는 추출할 수 없습니다.",
  limit_exceeded: "안전 추출 한도를 초과했습니다.",
  empty_document: "추출할 본문이 없습니다.",
  ocr_uncertain: "OCR 결과에는 오인식이 있을 수 있어 원본 확인이 필요합니다.",
  timeout: "문서 추출 제한 시간을 초과했습니다.",
  sandbox_unavailable: "안전한 문서 추출 환경을 사용할 수 없습니다.",
  parser_failed: "문서 추출에 실패했습니다.",
  gateway_unavailable: "문서 추출 서비스에 연결할 수 없습니다.",
};
const strings = z
  .array(
    z.enum([
      "본문 텍스트",
      "서식·이미지·표 구조 비교 제외",
      "PDF 읽기 순서 추정",
      "PPT 발표자 노트·숨김 슬라이드 제외",
    ]),
  )
  .max(4);
const block = z
  .object({
    kind: z.enum(["paragraph", "table-row", "slide", "page"]),
    path: z.string().regex(/^(paragraph|slide|page)\/[1-9][0-9]{0,4}$/),
    text: z.string().max(200000),
    cells: z.array(z.string().max(200000)).max(50000).optional(),
  })
  .strict();
const snapshot = z
  .object({
    v: z.literal(1),
    format: z.enum(["hwp", "doc", "ppt", "pdf"]),
    parserVersion: z.literal("tika-4.2.0-gm1"),
    normalizationVersion: z.literal(1),
    extractionMode: z.enum(["native", "ocr"]),
    blocks: z.array(block).max(5000),
    coverage: strings,
    warnings: z.array(z.literal("OCR 결과 원본 대조 필요")).max(1),
  })
  .strict();
const response = z
  .object({
    status: z.enum(["ready", "limited", "failed", "rejected"]),
    reason: z.enum(reasons).nullable(),
    snapshot: snapshot.nullable(),
    coverage: strings,
  })
  .strict();

/** The gateway output is untrusted even after mutual TLS authentication. */
export function validateExtraction(value: unknown, format: DocumentFormat): DocumentExtraction {
  const result = response.parse(value);
  const data = result.snapshot;
  if (
    (result.status === "ready" &&
      (!data || result.reason !== null || !data.blocks.some((b) => b.text.trim()))) ||
    ((result.status === "failed" || result.status === "rejected") && (data || !result.reason)) ||
    (result.status === "limited" &&
      (!data || !result.reason || !["ocr_uncertain", "empty_document"].includes(result.reason))) ||
    (data &&
      (data.format !== format ||
        data.blocks.reduce(
          (n, b) => n + b.text.length + (b.cells?.reduce((sum, cell) => sum + cell.length, 0) ?? 0),
          0,
        ) > 200000 ||
        data.blocks.reduce((n, b) => n + (b.cells?.length ?? 0), 0) > 50000 ||
        data.blocks.filter((b) => b.kind === "page" || b.kind === "slide").length > 20 ||
        (data.extractionMode === "ocr" && result.status !== "limited")))
  ) {
    throw new Error("Invalid extraction response");
  }
  return { ...result, reason: result.reason ? labels[result.reason] : null } as DocumentExtraction;
}
function failure(
  reason: keyof typeof labels,
  status: "failed" | "rejected" = "failed",
): DocumentExtraction {
  return { status, snapshot: null, reason: labels[reason], coverage: [] };
}

export async function extractDocument(
  format: DocumentFormat,
  bytes: Uint8Array,
): Promise<DocumentExtraction> {
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES)
    return failure("limit_exceeded", "rejected");
  if (["docx", "hwpx", "pptx", "csv"].includes(format)) return readDocument(format, bytes);
  if (!["hwp", "doc", "ppt", "pdf"].includes(format))
    return failure("invalid_document", "rejected");
  try {
    const url = new URL(process.env["DOCUMENT_EXTRACTOR_URL"] ?? "");
    const ca = process.env["DOCUMENT_EXTRACTOR_CA"];
    const cert = process.env["DOCUMENT_EXTRACTOR_CERT"];
    const key = process.env["DOCUMENT_EXTRACTOR_KEY"];
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !ca ||
      !cert ||
      !key
    )
      return failure("gateway_unavailable");
    return await new Promise<DocumentExtraction>((resolve) => {
      let finished = false;
      const finish = (value: DocumentExtraction) => {
        if (!finished) {
          finished = true;
          clearTimeout(deadline);
          resolve(value);
        }
      };
      const req = request(
        new URL(`/v1/extract/${format}`, url),
        {
          method: "POST",
          ca,
          cert,
          key,
          minVersion: "TLSv1.3",
          rejectUnauthorized: true,
          agent: false,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": bytes.byteLength,
            Accept: "application/json",
          },
        },
        (res) => {
          if (res.statusCode !== 200 || res.headers["content-type"] !== "application/json") {
            res.destroy();
            finish(failure("gateway_unavailable"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE) {
              res.destroy();
              finish(failure("parser_failed"));
            } else chunks.push(chunk);
          });
          res.on("error", () => finish(failure("gateway_unavailable")));
          res.on("end", () => {
            try {
              finish(
                validateExtraction(JSON.parse(Buffer.concat(chunks).toString("utf8")), format),
              );
            } catch {
              finish(failure("parser_failed"));
            }
          });
        },
      );
      const deadline = setTimeout(() => {
        req.destroy();
        finish(failure("timeout"));
      }, 125000);
      req.on("error", () => finish(failure("gateway_unavailable")));
      req.end(bytes);
    });
  } catch {
    return failure("gateway_unavailable");
  }
}
