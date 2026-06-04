// SSOT for paths protected from overwrite (spec §8.3) and the .gitignore
// block that init.ts appends. Imported by init.ts (now) and update.ts (when
// implemented). Keeping these in one place prevents divergence.

export const LOCAL_FILES: readonly string[] = [
  "rules/project-settings.md",
  "shared/github-project-ids.md",
  "settings.local.json",
  ".current-agent",
  "config/pipeline.local.json",
];

export const LOCAL_DIRS: readonly string[] = [
  "worktrees",
  "config/stack",
  "config/conventions",
];

export const GITIGNORE_MARKER = "# Added by ai-pipe init";

export const GITIGNORE_LINES: readonly string[] = [
  ".artifacts/",
  ".claude/worktrees/",
  ".claude/.current-agent",
  ".claude/settings.local.json",
  ".claude/config/pipeline.local.json",
  ".claude/config/stack/*.json",
];
