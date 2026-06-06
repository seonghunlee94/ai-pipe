// spec §11 — post-init / pre-run validation.
//
// Walks a directory tree and runs structural checks, collecting EVERY problem
// (no fail-fast) so one run surfaces all issues:
//   - every *.json parses
//   - every hook/bin/script *.sh passes `bash -n`
//   - every agent definition (agents/<name>.md) and SKILL.md has a delimited
//     frontmatter block with both `name:` and `description:`
//   - filled project-settings.md has no remaining {{PLACEHOLDER}} markers
//   - publishable *.json has no leftover `your-org/` placeholder (warning)
//   - an unreadable directory is surfaced as a warning, never silently skipped
//
// Exposed as a library function (`validateTree`) so init.ts can run a post-write
// sanity check, and as the `ai-pipe validate` CLI command. The frontmatter check
// is intentionally STRUCTURAL (no YAML dependency — the project ships zero
// runtime deps); full YAML validation is a tracked follow-up.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import { AiPipeError } from "./errors.js";
import { errMsg, hasFlag, resolveTargetDir } from "./utils.js";

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

function walk(root: string, problems: Problem[]): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: { name: string; isDir: boolean; isFile: boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        isFile: e.isFile(),
      }));
    } catch (e) {
      // A missing dir is benign (caller handles a missing root); anything else
      // (EACCES, ENOTDIR on a nested entry) is surfaced so the run never reports
      // "OK" while silently skipping content it could not read.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        problems.push({
          level: "warn",
          file: relative(root, dir) || dir,
          message: `cannot read directory (${code ?? errMsg(e)}) — contents not validated`,
        });
      }
      continue;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      // Symlinks are neither isDir nor isFile here, so they are intentionally
      // not followed (no traversal escape, no symlink loops) and not validated.
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

// Read a file or record a read error and return null, removing the duplicated
// try/catch at each call site.
function tryRead(file: string, rel: string, problems: Problem[]): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    problems.push({ level: "error", file: rel, message: `cannot read: ${errMsg(e)}` });
    return null;
  }
}

// True for the files Claude Code actually loads as definitions: an agent file
// directly under agents/ (agents/<name>.md) or a skill's SKILL.md. Supporting
// reference markdown bundled elsewhere under those trees is NOT required to have
// frontmatter, so it is not flagged.
function isDefinitionFile(file: string): boolean {
  if (basename(file) === "SKILL.md") return true;
  return basename(dirname(file)) === "agents" && file.endsWith(".md");
}

// Structural frontmatter check (no YAML parser): the block must open with `---`
// on line 1, close with a `---` line, and declare non-empty `name:` and
// `description:` fields (Claude Code refuses to load a definition missing
// either). `description: |` block scalars satisfy the `\S`-after-colon test.
// Catches the common failures; full YAML validation is a known follow-up.
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
  const out: Problem[] = [];
  if (!body.some((l) => /^name:\s*\S/.test(l))) {
    out.push({ level: "error", file: rel, message: "frontmatter missing required `name:` field" });
  }
  if (!body.some((l) => /^description:\s*\S/.test(l))) {
    out.push({ level: "error", file: rel, message: "frontmatter missing required `description:` field" });
  }
  return out;
}

export function validateTree(root: string, opts: ValidateOptions = {}): Problem[] {
  const checkPlaceholders = opts.placeholders ?? true;
  const problems: Problem[] = [];
  const haveBash = bashAvailable();
  let bashWarned = false;

  for (const file of walk(root, problems)) {
    const rel = relative(root, file) || basename(file);
    const segs = rel.split(sep);
    const underTemplate = segs.includes("template");

    if (file.endsWith(".json")) {
      const raw = tryRead(file, rel, problems);
      if (raw === null) continue;
      try {
        JSON.parse(raw);
      } catch (e) {
        problems.push({ level: "error", file: rel, message: `invalid JSON: ${errMsg(e)}` });
      }
      // Templates legitimately carry the placeholder; only flag real config.
      // Match `your-org/` (npm scope `@your-org/`, github `your-org/`) so a real
      // org like `your-organization` is not a false positive.
      if (!underTemplate && raw.includes("your-org/")) {
        problems.push({
          level: "warn",
          file: rel,
          message: "contains 'your-org/' placeholder — run the README §0 sed sweep before publishing",
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
        problems.push({ level: "error", file: rel, message: `bash -n failed: ${stderr || errMsg(e)}` });
      }
    } else if (file.endsWith(".md")) {
      const raw = tryRead(file, rel, problems);
      if (raw === null) continue;
      if (isDefinitionFile(file)) {
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
  const positionals = args.filter((a) => !a.startsWith("-"));
  if (positionals.length > 1) {
    throw new AiPipeError("E_BAD_USAGE", `validate: expected at most one directory, got ${positionals.length}`, 2);
  }
  const dir = resolveTargetDir(positionals[0]);
  if (!existsSync(dir)) {
    throw new AiPipeError("E_BAD_USAGE", `validate: directory not found: ${dir}`, 2);
  }
  if (!statSync(dir).isDirectory()) {
    throw new AiPipeError("E_BAD_USAGE", `validate: not a directory: ${dir}`, 2);
  }
  const strict = hasFlag(args, "--strict");
  const quiet = hasFlag(args, "--quiet");

  const problems = validateTree(dir);
  const errors = problems.filter((p) => p.level === "error");
  const warns = problems.filter((p) => p.level === "warn");

  // In strict mode warnings are failure-causing, so they must be shown even
  // under --quiet (otherwise a strict+quiet run exits 1 with no explanation).
  const shown = quiet && !strict ? errors : problems;
  for (const p of shown) {
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
