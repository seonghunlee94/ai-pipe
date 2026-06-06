import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { AiPipeError } from "./errors.js";
import {
  GITIGNORE_LINES,
  GITIGNORE_MARKER,
  LOCAL_DIRS,
  LOCAL_FILES,
} from "./local-files.js";
import { hasFlag, readPackageInfo, resolveTargetDir, templateDir } from "./utils.js";
import { validateTree } from "./validate.js";

// `ai-pipe init [targetDir] [--force]`
//
// Drops user-editable files into <targetDir>/.claude/ (project-settings.md,
// pipeline.json, settings.local.json.example) and patches .gitignore. The
// agents/hooks/skills/scripts come from the ai-pipe-core plugin — see
// README for the `/plugin marketplace add` flow.
//
// --force: overwrite the existing tree EXCEPT files on LOCAL_FILES (spec
// §8.3); user customizations are preserved.

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

  cpSync(src, targetClaude, {
    recursive: true,
    force: true,
    filter: (srcPath) => !isLocallyOwned(srcPath, src, targetClaude),
  });

  const pkg = readPackageInfo();
  writeFileSync(join(targetClaude, ".dev-pipe-version"), `${pkg.version}\n`, "utf8");

  patchGitignore(target);

  // Post-write sanity check: confirm the install produced parseable files.
  // Placeholders are EXPECTED right after init (the user fills them next), so
  // that check is off here. A failure here signals a packaging bug, not user
  // error — surface it as a warning without failing the otherwise-good install.
  const problems = validateTree(targetClaude, { placeholders: false }).filter(
    (p) => p.level === "error",
  );
  if (problems.length > 0) {
    process.stderr.write(`\n⚠ post-init validation found ${problems.length} issue(s):\n`);
    for (const p of problems) {
      process.stderr.write(`  ${p.file}: ${p.message}\n`);
    }
  }

  printNextSteps(target, pkg.version);
}

function isLocallyOwned(srcPath: string, srcRoot: string, targetRoot: string): boolean {
  const rel = relative(srcRoot, srcPath);
  if (!rel) return false;
  const targetPath = join(targetRoot, rel);
  // Only preserve if it actually exists locally; otherwise copy the template
  // default so a fresh install still bootstraps a working state.
  if (!existsSync(targetPath)) return false;

  if (LOCAL_FILES.includes(rel)) return true;
  for (const dir of LOCAL_DIRS) {
    if (rel === dir || rel.startsWith(dir + "/")) return true;
  }
  return false;
}

function patchGitignore(target: string): void {
  const gitignore = join(target, ".gitignore");
  const block = ["", GITIGNORE_MARKER, ...GITIGNORE_LINES, ""].join("\n");

  if (existsSync(gitignore)) {
    const current = readFileSync(gitignore, "utf8");
    if (current.includes(GITIGNORE_MARKER)) return;
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
      `The agents, hooks, skills (incl. slash commands), and scripts come from the ai-pipe-core plugin.`,
      `Inside Claude Code, run:`,
      `  /plugin marketplace add github:your-org/ai-pipe`,
      `  /plugin install ai-pipe-core@ai-pipe`,
      ``,
      `Then edit ${target}/.claude/rules/project-settings.md and run \`gh auth login\`.`,
      ``,
    ].join("\n"),
  );
}
