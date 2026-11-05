export type DocumentFormat = "docx" | "hwpx" | "pptx" | "csv" | "hwp" | "doc" | "ppt" | "pdf";
export type DocumentBlock = {
  kind: "paragraph" | "table-row" | "slide" | "page";
  path: string;
  text: string;
  cells?: string[];
};
export type DocumentSnapshot = {
  v: 1;
  format: DocumentFormat;
  parserVersion: string;
  normalizationVersion: 1;
  extractionMode: "native" | "ocr";
  blocks: DocumentBlock[];
  coverage: string[];
  warnings: string[];
};
export type DocumentExtraction =
  | { status: "ready"; snapshot: DocumentSnapshot; reason: null; coverage: string[] }
  | { status: "limited"; snapshot: DocumentSnapshot | null; reason: string; coverage: string[] }
  | { status: "failed" | "rejected"; snapshot: null; reason: string; coverage: string[] };
export type DocumentChange = {
  kind: "block_added" | "block_removed" | "block_modified";
  path: string;
  before: string | null;
  after: string | null;
};
export type DocumentComparison = {
  status: "compared" | "no_changes" | "limit_exceeded";
  changes: DocumentChange[];
};
export type DocumentQuestion = {
  kind: "purpose" | "origin" | "change" | "other";
  question: string;
  groupIndexes: number[];
};
export const DOCUMENT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  expandedBytes: 20 * 1024 * 1024,
  characters: 200000,
  blocks: 5000,
  cells: 50000,
  nativeMs: 20000,
  alignmentCells: 1000000,
} as const;
