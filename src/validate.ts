// spec §11 — post-init / pre-run validation.
//
// Walks a directory tree and runs structural checks, collecting EVERY problem
// (no fail-fast) so one run surfaces all issues:
//   - every *.json parses
//   - every hook/bin/script *.sh passes `bash -n`
//   - every agents//skills/ *.md has a delimited frontmatter block with `name:`
//   - filled project-settings.md has no remaining {{PLACEHOLDER}} markers
//   - publishable *.json has no leftover `your-org` placeholder (warning)
//
// Exposed as a library function (`validateTree`) so init.ts can run a post-write
// sanity check, and as the `ai-pipe validate` CLI command. The frontmatter check
// is intentionally STRUCTURAL (no YAML dependency — the project ships zero
// runtime deps); full YAML validation is a tracked follow-up.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { AiPipeError } from "./errors.js";
import { hasFlag, resolveTargetDir } from "./utils.js";

export type ProblemLevel = "error" | "warn";

export interface Problem {
  readonly level: ProblemLevel;
  readonly file: string; // path relative to the validated root
  readonly message: string;
}

export interface ValidateOptions {
  // Check that project-settings.md has no unfilled {{...}} markers. Off for the
  // post-init sanity check, where placeholders are expected (the user fills them
  // as the next step).
  readonly placeholders?: boolean;
}

// Build/VCS/runtime-artifact directories that never contain source to validate.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".artifacts",
  "worktrees",
]);

// Read a directory into a minimal shape, sidestepping the Dirent<Buffer|string>
// generic overload mismatch. Unreadable directories yield [] (skipped, not fatal).
function listDir(dir: string): { name: string; isDir: boolean; isFile: boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      isFile: e.isFile(),
    }));
  } catch {
    return [];
  }
}

function walk(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const ent of listDir(dir)) {
      const full = join(dir, ent.name);
      if (ent.isDir) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(full);
      } else if (ent.isFile) {
        out.push(full);
      }
    }
  }
  return out;
}

function bashAvailable(): boolean {
  try {
    execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Structural frontmatter check (no YAML parser): the block must open with `---`
// on line 1, close with a `---` line, and declare a non-empty `name:` field.
// Catches the common failures (missing/unterminated block, missing name); full
// YAML validation is a known follow-up.
function checkFrontmatter(raw: string, rel: string): Problem[] {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return [{ level: "error", file: rel, message: "missing YAML frontmatter (file must start with `---`)" }];
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return [{ level: "error", file: rel, message: "unterminated frontmatter (no closing `---`)" }];
  }
  const body = lines.slice(1, close);
  const hasName = body.some((l) => /^name:\s*\S/.test(l));
  if (!hasName) {
    return [{ level: "error", file: rel, message: "frontmatter missing required `name:` field" }];
  }
  return [];
}

export function validateTree(root: string, opts: ValidateOptions = {}): Problem[] {
  const checkPlaceholders = opts.placeholders ?? true;
  const problems: Problem[] = [];
  const haveBash = bashAvailable();
  let bashWarned = false;

  for (const file of walk(root)) {
    const rel = relative(root, file) || basename(file);
    const segs = rel.split(sep);
    const underTemplate = segs.includes("template");

    if (file.endsWith(".json")) {
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch (e) {
        problems.push({ level: "error", file: rel, message: `cannot read: ${(e as Error).message}` });
        continue;
      }
      try {
        JSON.parse(raw);
      } catch (e) {
        problems.push({ level: "error", file: rel, message: `invalid JSON: ${(e as Error).message}` });
      }
      // Templates legitimately carry the placeholder; only flag real config.
      if (!underTemplate && raw.includes("your-org")) {
        problems.push({
          level: "warn",
          file: rel,
          message: "contains 'your-org' placeholder — run the README §0 sed sweep before publishing",
        });
      }
    } else if (file.endsWith(".sh")) {
      const inHookish = segs.includes("hooks") || segs.includes("bin") || segs.includes("scripts");
      if (!inHookish) continue;
      if (!haveBash) {
        if (!bashWarned) {
          problems.push({ level: "warn", file: rel, message: "bash not found — skipping `bash -n` syntax checks" });
          bashWarned = true;
        }
        continue;
      }
      try {
        execFileSync("bash", ["-n", file], { stdio: "pipe" });
      } catch (e) {
        const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
        problems.push({ level: "error", file: rel, message: `bash -n failed: ${stderr || (e as Error).message}` });
      }
    } else if (file.endsWith(".md")) {
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch (e) {
        problems.push({ level: "error", file: rel, message: `cannot read: ${(e as Error).message}` });
        continue;
      }
      if (segs.includes("agents") || segs.includes("skills")) {
        problems.push(...checkFrontmatter(raw, rel));
      }
      if (checkPlaceholders && !underTemplate && basename(file) === "project-settings.md") {
        if (/\{\{[^}]+\}\}/.test(raw)) {
          problems.push({
            level: "error",
            file: rel,
            message: "unfilled {{PLACEHOLDER}} markers remain — fill before running the pipeline",
          });
        }
      }
    }
  }
  return problems;
}

export async function runValidate(args: string[]): Promise<void> {
  const dir = resolveTargetDir(args.find((a) => !a.startsWith("-")));
  if (!existsSync(dir)) {
    throw new AiPipeError("E_BAD_USAGE", `validate: directory not found: ${dir}`, 2);
  }
  const strict = hasFlag(args, "--strict");
  const quiet = hasFlag(args, "--quiet");

  const problems = validateTree(dir);
  const errors = problems.filter((p) => p.level === "error");
  const warns = problems.filter((p) => p.level === "warn");

  for (const p of quiet ? errors : problems) {
    const tag = p.level === "error" ? "ERROR" : "warn ";
    process.stdout.write(`${tag}  ${p.file}: ${p.message}\n`);
  }

  const summary =
    `validate: ${errors.length} error(s), ${warns.length} warning(s)` + (strict ? " (strict)" : "");
  const failCount = strict ? errors.length + warns.length : errors.length;
  if (failCount > 0) {
    throw new AiPipeError("E_VALIDATION", summary, 1);
  }
  process.stdout.write(`${summary} — OK\n`);
}
