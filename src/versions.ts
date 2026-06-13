// spec §9.1 — list versions available on the registry.
// `ai-pipe versions` queries `npm view <pkg> versions --json`. When the package
// is unpublished / offline (e.g. no release cut yet, or no registry auth), it
// degrades to printing the local CLI version with a clear note rather than
// failing.

import { execFileSync } from "node:child_process";

import { AiPipeError } from "./errors.js";
import { errMsg, parseCommandArgs, readPackageInfo } from "./utils.js";

export async function runVersions(args: string[]): Promise<void> {
  const { positionals } = parseCommandArgs("versions", args, {});
  if (positionals.length > 0) {
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe versions", 2);
  }
  const pkg = readPackageInfo();
  process.stdout.write(`CLI (this install): ${pkg.version}\n`);

  let raw: string;
  try {
    raw = execFileSync("npm", ["view", pkg.name, "versions", "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch (e) {
    process.stdout.write(
      `registry: unavailable for ${pkg.name} (${errMsg(e)}).\n` +
        `  Expected if the package isn't published yet or the registry needs auth\n` +
        `  (see README §0 publish checklist).\n`,
    );
    return;
  }

  let versions: unknown;
  try {
    versions = JSON.parse(raw);
  } catch {
    process.stdout.write(`registry: returned unparseable output for ${pkg.name}\n`);
    return;
  }
  const list = Array.isArray(versions) ? versions : typeof versions === "string" ? [versions] : [];
  if (list.length === 0) {
    process.stdout.write(`registry: no published versions for ${pkg.name}\n`);
    return;
  }
  process.stdout.write(`registry (${pkg.name}): ${list.length} version(s)\n`);
  for (const v of list.slice(-10)) process.stdout.write(`  ${String(v)}\n`);
  if (list.length > 10) process.stdout.write(`  … (${list.length - 10} older)\n`);
}
