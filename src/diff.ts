// TODO: spec §9.3 — show template-vs-installed diff without applying.
//
// This is the SCAN step of update.ts, but printed instead of applied:
//   + agents/new-agent.md          (new)
//   ~ shared/workflow-guide.md     (changed)
//   - hooks/old-hook.sh            (deleted)
//   ✓ agents/backend-eng.md        (same)
//
// Reuse fileHash() from utils.ts.

import { AiPipeError } from "./errors.js";

export async function runDiff(_args: string[]): Promise<void> {
  throw new AiPipeError(
    "E_NOT_IMPLEMENTED",
    "diff is a stub — see TODO in src/diff.ts and spec §9.3.",
    2,
  );
}
