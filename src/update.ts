// TODO: spec §9.3 — 3-step update flow (SCAN/CONFIRM/APPLY).
//
// SCAN:    diff template vs installed using fileHash() from utils.ts.
//          Classify each file as new / changed / deleted / same.
// CONFIRM: print color-coded summary (+/~/-/✓). Skip when --force.
// APPLY:   copy/delete files, then rewrite .claude/.dev-pipe-version.
//
// Critical: respect LOCAL_FILES protection list (spec §8.3).
// LOCAL_FILES = [
//   'rules/project-settings.md',
//   'shared/github-project-ids.md',
//   'settings.local.json',
//   'worktrees/',
//   '.current-agent',
//   'config/stack/',
//   'config/conventions/',
//   'config/pipeline.local.json',
// ];

import { AiPipeError } from "./errors.js";

export async function runUpdate(_args: string[]): Promise<void> {
  throw new AiPipeError(
    "E_NOT_IMPLEMENTED",
    "update is a stub — see TODO in src/update.ts and spec §9.3.",
    2,
  );
}
