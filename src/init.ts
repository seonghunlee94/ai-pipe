import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { AiPipeError } from "./errors.js";
import { hasFlag, readPackageInfo, resolveTargetDir, templateDir } from "./utils.js";

// `ai-pipe init [targetDir] [--force]`
//
// Bootstraps a project to use ai-pipe. Drops user-editable templates into
// <targetDir>/.claude/ (project-settings.md, pipeline.json, .gitignore patch).
// The actual agents/hooks/commands come from the plugin marketplace — install
// with `/plugin marketplace add github:your-org/ai-pipe` then
// `/plugin install ai-pipe-core@ai-pipe` inside Claude Code.
//
// --force: overwrite existing .claude/ EXCEPT files on the LOCAL_FILES list
//          (spec §8.3) — user customizations are preserved.

// Spec §8.3 protected files — never overwritten by init or update.
const LOCAL_FILES = [
  "rules/project-settings.md",
  "shared/github-project-ids.md",
  "settings.local.json",
  ".current-agent",
  "config/pipeline.local.json",
];

const LOCAL_DIRS = ["worktrees", "config/stack", "config/conventions"];

export async function runInit(args: string[]): Promise<void> {
  const force = hasFlag(args, "--force");
  const targetArg = args.find((a) => !a.startsWith("--"));
  const target = resolveTargetDir(targetArg);
  const targetClaude = join(target, ".claude");

  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  if (existsSync(targetClaude) && !force) {
    throw new AiPipeError(
      "E_TARGET_EXISTS",
      `${targetClaude} already exists. Use --force to overwrite (LOCAL_FILES will be preserved).`,
    );
  }

  const src = templateDir();
  if (!existsSync(src)) {
    throw new AiPipeError("E_TEMPLATE_MISSING", `Template not found at ${src}.`);
  }

  // cpSync with a filter so LOCAL_FILES that already exist locally aren't
  // touched, even under --force.
  cpSync(src, targetClaude, {
    recursive: true,
    force: true,
    filter: (srcPath) => !isLocallyOwned(srcPath, src, targetClaude),
  });

  // Make all .sh files and bin/* executable (chmod may be lost via npm tarball).
  ensureExecutable(targetClaude);

  const pkg = readPackageInfo();
  writeFileSync(join(targetClaude, ".dev-pipe-version"), `${pkg.version}\n`, "utf8");

  patchGitignore(target);

  printNextSteps(target, pkg.version);
}

function isLocallyOwned(srcPath: string, srcRoot: string, targetRoot: string): boolean {
  const rel = relative(srcRoot, srcPath);
  if (!rel) return false;
  const targetPath = join(targetRoot, rel);
  // Only preserve if the file/dir actually exists locally; otherwise copy
  // the template default so a fresh init still bootstraps a working state.
  if (!existsSync(targetPath)) return false;

  if (LOCAL_FILES.includes(rel)) return true;
  for (const dir of LOCAL_DIRS) {
    if (rel === dir || rel.startsWith(dir + "/")) return true;
  }
  return false;
}

function ensureExecutable(claudeDir: string): void {
  walkFiles(claudeDir, (p, name) => {
    if (name.endsWith(".sh")) chmodSync(p, 0o755);
  });
  const binDir = join(claudeDir, "bin");
  if (existsSync(binDir)) {
    for (const entry of readdirSync(binDir)) {
      const p = join(binDir, entry);
      if (statSync(p).isFile()) chmodSync(p, 0o755);
    }
  }
}

function walkFiles(dir: string, fn: (path: string, name: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      walkFiles(p, fn);
    } else if (s.isFile()) {
      fn(p, entry);
    }
  }
}

function patchGitignore(target: string): void {
  const gitignore = join(target, ".gitignore");
  const marker = "# Added by ai-pipe init";
  const block = [
    "",
    marker,
    ".artifacts/",
    ".claude/worktrees/",
    ".claude/.current-agent",
    ".claude/settings.local.json",
    ".claude/config/pipeline.local.json",
    ".claude/config/stack/*.json",
    "",
  ].join("\n");

  if (existsSync(gitignore)) {
    const current = readFileSync(gitignore, "utf8");
    if (current.includes(marker)) return; // already patched
    appendFileSync(gitignore, block);
  } else {
    writeFileSync(gitignore, block.trimStart(), "utf8");
  }
}

function printNextSteps(target: string, version: string): void {
  process.stdout.write(
    [
      `✓ ai-pipe ${version} bootstrapped at ${target}/.claude`,
      ``,
      `Project-scope files installed:`,
      `  • rules/project-settings.md    (placeholders to fill)`,
      `  • config/pipeline.json         (retry limits, branch patterns)`,
      `  • settings.local.json.example  (rename if you need local overrides)`,
      `  • .gitignore                   (patched for .artifacts/ etc.)`,
      ``,
      `The agents, hooks, commands, and scripts come from the ai-pipe-core plugin.`,
      `Inside Claude Code, run:`,
      `  /plugin marketplace add github:your-org/ai-pipe`,
      `  /plugin install ai-pipe-core@ai-pipe`,
      ``,
      `Then edit ${target}/.claude/rules/project-settings.md and run \`gh auth login\`.`,
      ``,
    ].join("\n"),
  );
}
