import { cpSync, existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { AiPipeError } from "./errors.js";
import { hasFlag, readPackageInfo, resolveTargetDir, templateDir } from "./utils.js";

// `ai-pipe init [targetDir] [--force]`
//
// Spec §5.1, §9.1: copy template/.claude/ into <targetDir>/.claude/ and write
// .dev-pipe-version. Refuses to overwrite an existing .claude unless --force.
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
      `${targetClaude} already exists. Use --force to overwrite, or run \`ai-pipe update\` (once implemented).`,
    );
  }

  const src = templateDir();
  if (!existsSync(src)) {
    throw new AiPipeError("E_TEMPLATE_MISSING", `Template not found at ${src}.`);
  }

  cpSync(src, targetClaude, { recursive: true, force: true });

  // Ensure hook scripts retain exec permission. `cpSync` should preserve mode,
  // but a freshly-published npm tarball can land without +x depending on host.
  ensureHooksExecutable(join(targetClaude, "hooks"));

  const pkg = readPackageInfo();
  writeFileSync(join(targetClaude, ".dev-pipe-version"), `${pkg.version}\n`, "utf8");

  printNextSteps(target, pkg.version);
}

function ensureHooksExecutable(hooksDir: string): void {
  if (!existsSync(hooksDir)) return;
  for (const entry of readdirSync(hooksDir)) {
    const p = join(hooksDir, entry);
    if (statSync(p).isFile() && entry.endsWith(".sh")) {
      chmodSync(p, 0o755);
    }
  }
}

function printNextSteps(target: string, version: string): void {
  process.stdout.write(
    [
      `✓ ai-pipe ${version} installed at ${target}/.claude`,
      ``,
      `Next steps:`,
      `  1. Edit  ${target}/.claude/rules/project-settings.md   (set org, repo, short)`,
      `  2. Edit  ${target}/.claude/config/pipeline.json        (adjust limits if needed)`,
      `  3. Add   .artifacts/  to your .gitignore               (spec §5.2)`,
      `  4. Run   gh auth login                                 (project-ops agent needs gh)`,
      ``,
      `See README and multi-agent-pipeline-best-practices.md for the full spec.`,
      ``,
    ].join("\n"),
  );
}
