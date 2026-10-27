import { tmpdir } from "node:os";
import { join } from "node:path";

export const e2eMailDir = join(tmpdir(), "ghostmanual-e2e-mail");
