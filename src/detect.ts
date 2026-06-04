// TODO: spec §3.2 — auto-detect GitHub Projects V2 board for the current repo.
//
// Uses `gh project list --owner <org>` (REST) and `gh api graphql` for board
// columns/statuses. Writes the result to .claude/shared/github-project-ids.md
// which is a LOCAL_FILES protected path (spec §8.3).

export async function runDetect(_args: string[]): Promise<void> {
  throw new Error("detect is a stub — see TODO in src/detect.ts and spec §3.2");
}
