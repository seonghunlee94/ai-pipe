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
import { errMsg, readOptionValue, readPackageInfo, resolveTargetDir } from "./utils.js";

export async function runUpgrade(args: string[]): Promise<void> {
  const pkg = readPackageInfo();
  const version = readOptionValue(args, "--version") ?? "latest";
  const spec = `${pkg.name}@${version}`;
  const target = resolveTargetDir(args.find((a) => !a.startsWith("--")));

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
