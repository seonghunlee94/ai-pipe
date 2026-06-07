// spec §9.3 — update an installed .claude/ tree from the packaged template.
//
// SCAN  : scanTemplate() classifies each file (new/changed/orphaned/same/local).
// REVIEW: print the plan (+/~). Non-interactive: applies ONLY with --force;
//         without it, prints the plan and exits without writing.
// APPLY  : copy new + changed files from the template, then rewrite
//          .claude/.dev-pipe-version. LOCAL_FILES/LOCAL_DIRS are never touched;
//          orphaned files (template no longer ships them) are reported but left
//          in place — update never deletes user content.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { AiPipeError } from "./errors.js";
import { requireInstall, scanTemplate, STATUS_GLYPH } from "./template-sync.js";
import { parseCommandArgs, readPackageInfo, resolveTargetDir, templateDir } from "./utils.js";

export async function runUpdate(args: string[]): Promise<void> {
  const { values, positionals } = parseCommandArgs("update", args, { force: { type: "boolean" } });
  if (positionals.length > 1) {
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe update [<dir>] [--force]", 2);
  }
  const target = resolveTargetDir(positionals[0]);
  const claude = requireInstall(target, "update");
  const force = values.force === true;

  const changes = scanTemplate(claude);
  const toApply = changes.filter((c) => c.status === "new" || c.status === "changed");
  const orphaned = changes.filter((c) => c.status === "orphaned");

  for (const c of toApply) process.stdout.write(`${STATUS_GLYPH[c.status]} ${c.path}\n`);
  for (const c of orphaned) process.stdout.write(`${STATUS_GLYPH.orphaned} ${c.path} (orphaned — left in place)\n`);

  if (toApply.length === 0) {
    process.stdout.write("update: already up to date\n");
    return;
  }
  if (!force) {
    process.stdout.write(`update: ${toApply.length} file(s) would change — re-run with --force to apply\n`);
    return;
  }

  const tmplRoot = templateDir();
  for (const c of toApply) {
    const dst = join(claude, c.path);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(tmplRoot, c.path), dst);
  }
  const pkg = readPackageInfo();
  writeFileSync(join(claude, ".dev-pipe-version"), `${pkg.version}\n`, "utf8");
  process.stdout.write(`update: applied ${toApply.length} file(s); .dev-pipe-version → ${pkg.version}\n`);
}
