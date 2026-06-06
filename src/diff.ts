// spec §9.3 — show template-vs-installed diff without applying (the SCAN step
// of `update`, printed instead of applied). Reuses scanTemplate().

import { requireInstall, scanTemplate, STATUS_GLYPH, type FileStatus } from "./template-sync.js";
import { resolveTargetDir } from "./utils.js";

const ORDER: FileStatus[] = ["new", "changed", "orphaned", "same", "local"];

export async function runDiff(args: string[]): Promise<void> {
  const target = resolveTargetDir(args.find((a) => !a.startsWith("-")));
  const claude = requireInstall(target);
  const changes = scanTemplate(claude);
  const showAll = args.includes("--all");
  for (const status of ORDER) {
    if ((status === "same" || status === "local") && !showAll) continue;
    for (const c of changes.filter((x) => x.status === status)) {
      process.stdout.write(`${STATUS_GLYPH[status]} ${c.path}\n`);
    }
  }
  const counts = ORDER.map((s) => `${changes.filter((c) => c.status === s).length} ${s}`).join(", ");
  process.stdout.write(`diff: ${counts}\n`);
}
