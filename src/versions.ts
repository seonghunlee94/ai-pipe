// spec §9.1 — list versions available on the registry.
// `ai-pipe versions` queries `npm view <pkg> versions --json`. When the package
// is unpublished / offline (the default until the your-org placeholder is
// replaced and a release is cut), it degrades to printing the local CLI version
// with a clear note rather than failing.

import { execFileSync } from "node:child_process";

import { errMsg, readPackageInfo } from "./utils.js";

export async function runVersions(_args: string[]): Promise<void> {
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
        `  This is expected until the package is published (replace the your-org\n` +
        `  placeholder per README §0 and cut a release).\n`,
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
