import { readFile } from "node:fs/promises";
import { z } from "zod";
import { pool } from "../src/lib/db.ts";
import { publishManual, saveDraft } from "../src/lib/manuals.ts";
import { deleteWorkspace } from "../src/lib/retention.ts";
import { retrieve } from "../src/lib/retrieval.ts";
import { createWorkspace, requireSession } from "../src/lib/session.ts";
import { createSource } from "../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../tests/fixtures/manual-example.ts";

const data = z
  .object({
    cases: z.array(z.object({ question: z.string(), expected: z.string() })),
    absent: z.array(z.string()),
    injection: z.array(z.string()),
  })
  .parse(
    JSON.parse(
      await readFile(new URL("../tests/fixtures/evaluation.json", import.meta.url), "utf8"),
    ),
  );
try {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  let recalled = 0;
  for (const item of data.cases)
    if (
      (await retrieve(owner, item.question)).some((candidate) =>
        candidate.quote.includes(item.expected),
      )
    )
      recalled++;
  let absent = 0;
  for (const question of data.absent) if (!(await retrieve(owner, question)).length) absent++;
  console.log(
    JSON.stringify({
      mode: "deterministic-retrieval-fixture",
      recallAt6: `${recalled}/${data.cases.length}`,
      absent: `${absent}/${data.absent.length}`,
      injectionFixtures: data.injection.length,
      liveModelEvaluated: false,
    }),
  );
  if (recalled < 11 || absent !== 6) process.exitCode = 1;
  await deleteWorkspace(owner);
} finally {
  await pool.end();
}
