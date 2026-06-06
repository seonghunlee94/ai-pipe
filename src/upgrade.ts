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
  // Accept both `--version X` (space) and `--version=X` (equals) — the equals
  // form was previously silently ignored, installing @latest instead of the
  // requested version (a surprising global side effect).
  let version = readOptionValue(args, "--version") ?? "latest";
  const eqTok = args.find((a) => a.startsWith("--version="));
  if (eqTok !== undefined) {
    const val = eqTok.slice("--version=".length);
    if (val === "") {
      throw new AiPipeError("E_BAD_USAGE", "upgrade: --version= requires a value", 2);
    }
    version = val;
  }
  const spec = `${pkg.name}@${version}`;
  // Positional dir = first non-flag arg, skipping the --version VALUE (so
  // `upgrade --version 1.2.3 /proj` resolves /proj, not 1.2.3).
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--version") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push(a);
  }
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
