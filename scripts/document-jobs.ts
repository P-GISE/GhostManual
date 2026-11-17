import { setTimeout } from "node:timers/promises";
import { pool } from "../src/lib/db.ts";
import { extractDocument } from "../src/lib/document-extractor.ts";
import { runDocumentJob } from "../src/lib/document-jobs.ts";

import { runTemplateJob } from "../src/lib/template-extraction.ts";

let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});
try {
  do {
    const documentWorked = await runDocumentJob(extractDocument);
    const templateWorked = stopping ? false : await runTemplateJob();
    const worked = documentWorked || templateWorked;
    if (process.argv.includes("--once")) break;
    if (!worked) await setTimeout(1000);
  } while (!stopping);
} finally {
  await pool.end();
}
