// spec §9.3 — show template-vs-installed diff without applying (the SCAN step
// of `update`, printed instead of applied). Reuses scanTemplate().

import { AiPipeError } from "./errors.js";
import { requireInstall, scanTemplate, STATUS_GLYPH, type FileStatus } from "./template-sync.js";
import { parseCommandArgs, resolveTargetDir } from "./utils.js";

const ORDER: FileStatus[] = ["new", "changed", "orphaned", "same", "local"];

export async function runDiff(args: string[]): Promise<void> {
  const { values, positionals } = parseCommandArgs("diff", args, { all: { type: "boolean" } });
  if (positionals.length > 1) {
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe diff [<dir>] [--all]", 2);
  }
  const target = resolveTargetDir(positionals[0]);
  const claude = requireInstall(target, "diff");
  const changes = scanTemplate(claude);
  const showAll = values.all === true;
  for (const status of ORDER) {
    if ((status === "same" || status === "local") && !showAll) continue;
    for (const c of changes.filter((x) => x.status === status)) {
      process.stdout.write(`${STATUS_GLYPH[status]} ${c.path}\n`);
    }
  }
  const counts = ORDER.map((s) => `${changes.filter((c) => c.status === s).length} ${s}`).join(", ");
  process.stdout.write(`diff: ${counts}\n`);
}
