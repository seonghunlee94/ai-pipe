// spec §9.4 — upgrade the globally-installed package, then point the user at
// `update` to sync the project tree.
//   ai-pipe upgrade [--version X.Y.Z] [<dir>]
//
// Unlike `update` (which only touches .claude/), this reinstalls the global npm
// package. The freshly-installed binary ships the new template, so the project
// sync must be run by THAT binary afterwards — this command performs the global
// install and then instructs `ai-pipe update`, rather than syncing in-process
// with the now-stale template of the running (old) binary.

import { execFileSync } from "node:child_process";

import { AiPipeError } from "./errors.js";
import { errMsg, parseCommandArgs, readPackageInfo, resolveTargetDir } from "./utils.js";

export async function runUpgrade(args: string[]): Promise<void> {
  const pkg = readPackageInfo();
  // parseArgs handles both `--version X` and `--version=X` natively and throws
  // on a missing value. An empty `--version=` or a flag-eaten value is still
  // rejected here — a silent @latest install would be a surprising global
  // side effect.
  const { values, positionals } = parseCommandArgs("upgrade", args, { version: { type: "string" } });
  if (positionals.length > 1) {
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe upgrade [--version X.Y.Z] [<dir>]", 2);
  }
  let version = "latest";
  const v = values.version;
  if (v !== undefined) {
    if (typeof v !== "string" || v === "" || v.startsWith("-")) {
      throw new AiPipeError("E_BAD_USAGE", "upgrade: --version requires a value", 2);
    }
    version = v;
  }
  const spec = `${pkg.name}@${version}`;
  const target = resolveTargetDir(positionals[0]);

  process.stdout.write(`upgrade: npm install -g ${spec}\n`);
  try {
    execFileSync("npm", ["install", "-g", spec], { stdio: ["ignore", "inherit", "inherit"] });
  } catch (e) {
    throw new AiPipeError("E_VALIDATION", `upgrade: global install failed (${errMsg(e)})`, 1);
  }
  process.stdout.write(
    `upgrade: installed ${spec}.\n` +
      `  Next, sync the project with the new template:\n` +
      `    ai-pipe update ${target} --force\n`,
  );
}
