#!/usr/bin/env node
// Entry point. Custom mini-parser per spec §2 — no external CLI libraries.

import { AiPipeError } from "./errors.js";
import { readPackageInfo } from "./utils.js";
import { runInit } from "./init.js";
import { runVersion } from "./version.js";

const HELP = `\
ai-pipe — multi-agent automation pipeline (scaffolding stage)

Usage:
  ai-pipe <command> [options]

Commands:
  init [<dir>] [--force]     Install .claude/ tree into <dir> (default: cwd)
  version [--project <dir>]  Show CLI/project version and sync status
  --version, -v              Print CLI version
  --help, -h                 Show this help

Not yet implemented (stubs — see src/ and spec §):
  update     §9.3   upgrade    §9.4   diff       §9.3
  preflight  §13.3  detect     §3.2   validate   §11
  pipeline   §8.1   versions   §9.1
`;

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

  switch (cmd) {
    case "init":
      return runInit(rest);
    case "version":
      return runVersion(rest);
    case "update":
    case "upgrade":
    case "diff":
    case "preflight":
    case "detect":
    case "validate":
    case "versions":
    case "pipeline":
      throw new AiPipeError(
        "E_NOT_IMPLEMENTED",
        `\`${cmd}\` is a stub. See src/${cmd}.ts and multi-agent-pipeline-best-practices.md.`,
        2,
      );
    default:
      throw new AiPipeError("E_BAD_USAGE", `Unknown command: ${cmd}\n\n${HELP}`, 2);
  }
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
