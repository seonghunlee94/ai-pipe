// TODO: spec v2.0 — convention file migration. When the template's convention
// files evolve (e.g., from commit-message-rules v1 → v2), migrate user-edited
// files in docs/conventions/ without losing customizations.

import { AiPipeError } from "../errors.js";

export async function runMigrate(_args: string[]): Promise<void> {
  throw new AiPipeError(
    "E_NOT_IMPLEMENTED",
    "conventions/migrate is a stub — see TODO and spec §14 v2.0.",
    2,
  );
}
