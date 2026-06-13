// Shared SCAN logic for `diff` and `update` (spec §9.3): compare the packaged
// template tree against an installed .claude/ tree, classifying each file.
// LOCAL_FILES / LOCAL_DIRS (spec §8.3) are never touched.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { AiPipeError } from "./errors.js";
import { GENERATED_FILES, LOCAL_DIRS, LOCAL_FILES } from "./local-files.js";
import { fileHash, templateDir } from "./utils.js";

// Resolve and require an installed .claude/ tree under target; shared by
// diff + update so the precondition lives in one place. `cmd` prefixes the
// error so the message keeps the per-command context (`diff: ...`).
export function requireInstall(target: string, cmd: string): string {
  const claude = join(target, ".claude");
  if (!existsSync(claude) || !statSync(claude).isDirectory()) {
    throw new AiPipeError("E_BAD_USAGE", `${cmd}: no .claude/ install at ${target} (run \`ai-pipe init\` first)`, 2);
  }
  return claude;
}

export type FileStatus = "new" | "changed" | "same" | "orphaned" | "local";

export interface FileChange {
  readonly path: string; // relative to the .claude/ root, posix-separated
  readonly status: FileStatus;
}

export function isLocallyOwnedPath(rel: string): boolean {
  if (LOCAL_FILES.includes(rel)) return true;
  for (const d of LOCAL_DIRS) {
    if (rel === d || rel.startsWith(`${d}/`)) return true;
  }
  return false;
}

// `.dev-pipe-version` is WRITTEN by init/update from pkg.version, not synced
// from the template — so it must never be drift-compared (else the static
// template seed needs a hand-bump every release, N26) nor flagged orphaned.
function isGeneratedPath(rel: string): boolean {
  return GENERATED_FILES.includes(rel);
}

// List files under root as paths relative to root, with forward slashes (so
// they compare against the posix-style LOCAL_FILES entries on any platform).
function walkRel(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const relDir = stack.pop();
    if (relDir === undefined) break;
    const abs = relDir === "" ? root : join(root, relDir);
    let entries: { name: string; isDir: boolean; isFile: boolean }[];
    try {
      entries = readdirSync(abs, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        isFile: e.isFile(),
      }));
    } catch {
      continue;
    }
    for (const ent of entries) {
      const childRel = relDir === "" ? ent.name : `${relDir}/${ent.name}`;
      if (ent.isDir) stack.push(childRel);
      else if (ent.isFile) out.push(childRel.split(sep).join("/"));
    }
  }
  return out;
}

// Compare templateDir() against an installed .claude/ tree.
export function scanTemplate(installedClaudeDir: string): FileChange[] {
  const tmplRoot = templateDir();
  const tmplFiles = new Set(walkRel(tmplRoot));
  const instFiles = new Set(existsSync(installedClaudeDir) ? walkRel(installedClaudeDir) : []);
  const changes: FileChange[] = [];

  for (const rel of tmplFiles) {
    if (isGeneratedPath(rel)) continue;
    if (isLocallyOwnedPath(rel)) {
      changes.push({ path: rel, status: "local" });
    } else if (!instFiles.has(rel)) {
      changes.push({ path: rel, status: "new" });
    } else if (fileHash(join(tmplRoot, rel)) !== fileHash(join(installedClaudeDir, rel))) {
      changes.push({ path: rel, status: "changed" });
    } else {
      changes.push({ path: rel, status: "same" });
    }
  }
  // Files present in the install but no longer shipped by the template.
  for (const rel of instFiles) {
    if (!tmplFiles.has(rel) && !isLocallyOwnedPath(rel) && !isGeneratedPath(rel)) {
      changes.push({ path: rel, status: "orphaned" });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export const STATUS_GLYPH: Record<FileStatus, string> = {
  new: "+",
  changed: "~",
  orphaned: "-",
  same: "✓",
  local: "·",
};
