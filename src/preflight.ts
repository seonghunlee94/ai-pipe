// TODO: spec §13.3 — verify required external tools are present before init/run.
//
// Required: node >= 20, npm, git, gh, jq, bash.
// Optional: rclone (cloud sync, v2.0).
//
// Return a structured report so init can warn but not block on optional tools.

import { AiPipeError } from "./errors.js";

export async function runPreflight(_args: string[]): Promise<void> {
  throw new AiPipeError(
    "E_NOT_IMPLEMENTED",
    "preflight is a stub — see TODO in src/preflight.ts and spec §13.3.",
    2,
  );
}
