// spec §14 (v2.0) — convention-file migration. When the template's convention
// files evolve across versions, registered migrations transform user-edited
// files in docs/conventions/ without losing customizations.
//
// The migration REGISTRY is empty until v2.0 ships convention files, so this is
// a forward-compatible no-op: it reports "no migrations" and exits 0 rather than
// throwing, so scripts/CI can call it unconditionally.

import { parseCommandArgs, resolveTargetDir } from "../utils.js";

export interface Migration {
  readonly id: string;
  readonly describe: string;
  // apply(targetDir): number of files migrated
  readonly apply: (targetDir: string) => number;
}

// No migrations defined yet (v2.0). Add entries here as convention files evolve.
export const MIGRATIONS: readonly Migration[] = [];

export async function runMigrate(args: string[]): Promise<void> {
  const { positionals } = parseCommandArgs("migrate", args, {});
  const target = resolveTargetDir(positionals[0]);
  if (MIGRATIONS.length === 0) {
    process.stdout.write("migrate: no migrations defined for this version — nothing to do\n");
    return;
  }
  let total = 0;
  for (const m of MIGRATIONS) {
    const n = m.apply(target);
    total += n;
    process.stdout.write(`migrate: ${m.id} — ${m.describe} (${n} file(s))\n`);
  }
  process.stdout.write(`migrate: ${total} file(s) migrated across ${MIGRATIONS.length} migration(s)\n`);
}
