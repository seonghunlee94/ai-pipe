#!/usr/bin/env node
// Entry point. Custom mini-parser per spec §2 — no external CLI libraries.

import { runMigrate } from "./conventions/migrate.js";
import { runDetect } from "./detect.js";
import { runDiff } from "./diff.js";
import { AiPipeError } from "./errors.js";
import { runEval } from "./eval.js";
import { runInit } from "./init.js";
import { runPipeline } from "./pipeline/commands.js";
import { runPreflight } from "./preflight.js";
import { runUpdate } from "./update.js";
import { runUpgrade } from "./upgrade.js";
import { readPackageInfo } from "./utils.js";
import { runValidate } from "./validate.js";
import { runVersion } from "./version.js";
import { runVersions } from "./versions.js";

const HELP = `\
ai-pipe — multi-agent automation pipeline (scaffolding stage)

Usage:
  ai-pipe <command> [options]

Commands:
  init [<dir>] [--force]        Install .claude/ tree into <dir> (default: cwd)
  version [--project <dir>]     Show CLI/project version and sync status
  validate [<dir>] [--strict] [--quiet]
                                Check a tree: JSON parses, hooks pass bash -n,
                                agent/skill frontmatter, filled placeholders
  eval <evalsDir> [--outputs <dir>] [--verbose]
                                Validate *.eval.json cases; with --outputs,
                                score recorded agent outputs against metrics
  --version, -v                 Print CLI version
  --help, -h                    Show this help

Not yet implemented (stubs — see src/ and spec §):
  update     §9.3   upgrade    §9.4   diff       §9.3
  preflight  §13.3  detect     §3.2   versions   §9.1
  pipeline   §8.1   migrate    §14
`;

// Single source of truth for command routing. Stub commands dispatch to their
// own files, which throw AiPipeError(E_NOT_IMPLEMENTED, ..., 2). This keeps
// the "not implemented" message in one place per command and lets future PRs
// flesh out the stub by editing only its own file.
const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  init: runInit,
  version: runVersion,
  update: runUpdate,
  upgrade: runUpgrade,
  diff: runDiff,
  preflight: runPreflight,
  detect: runDetect,
  validate: runValidate,
  eval: runEval,
  versions: runVersions,
  pipeline: runPipeline,
  migrate: runMigrate,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return;
  }

  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(readPackageInfo().version + "\n");
    return;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    throw new AiPipeError("E_BAD_USAGE", `Unknown command: ${cmd}\n\n${HELP}`, 2);
  }
  await handler(rest);
}

main().catch((err: unknown) => {
  if (err instanceof AiPipeError) {
    process.stderr.write(`${err.code}: ${err.message}\n`);
    process.exit(err.exitCode);
  }
  process.stderr.write(`Unexpected error:\n`);
  process.stderr.write(err instanceof Error && err.stack ? err.stack + "\n" : String(err) + "\n");
  process.exit(1);
});
