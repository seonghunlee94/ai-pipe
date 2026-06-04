// TODO: spec §8.1 — `ai-pipe pipeline <subcommand>` for reading/writing
// .claude/config/pipeline.json (and pipeline.local.json overrides).
//
// Subcommands:
//   pipeline get <key>          — read a value (dot-path)
//   pipeline set <key> <value>  — write to pipeline.local.json (not base)
//   pipeline show               — merged view of base + local

export async function runPipeline(_args: string[]): Promise<void> {
  throw new Error("pipeline is a stub — see TODO in src/pipeline/commands.ts and spec §8.1");
}
