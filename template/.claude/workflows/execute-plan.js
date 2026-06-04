// TODO: spec §4.2 패턴 B/C — DAG orchestrator for parallel task execution.
//
// Responsibilities:
//   1. Read .artifacts/plans/{slug}-plan.md → extract task DAG
//   2. Compute topological groups (parallelizable rows)
//   3. For each group: fan-out impl agents into git worktrees (spec §3.3)
//   4. Serial merge in fan-in step
//   5. Stream events to .artifacts/runs/{slug}-events.jsonl (spec §12.1)
//
// Runs under Claude Code's workflow runtime (plain JS, no bundler).
//
// CRITICAL: this orchestrator MUST NOT modify source files itself
// (spec §4.2 — "Orchestrator는 작업하지 않는다").

export default async function executePlan(/* { slug, projectRoot } */) {
  throw new Error("execute-plan.js is a stub — see spec §4.2 and §12.1");
}
