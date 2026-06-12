#!/usr/bin/env bash
# validate-subagent-type.sh — spec §7.3
# PreToolUse hook for Agent. Allows only subagent_type values registered as
# project agents (.claude/agents/*.md AND ${CLAUDE_PLUGIN_ROOT}/agents/*.md)
# or Claude Code's built-in agents.
#
# Why: typos and hallucinated agent names should fail loudly, not silently
# fall through to a default agent.
#
# Resolution of project root (in order of preference):
#   1. $CLAUDE_PROJECT_DIR (set by Claude Code)
#   2. `git rev-parse --show-toplevel` (fallback when running inside a worktree)
#   3. current cwd (last resort)
# This way the hook still works correctly when a subagent runs inside a
# git worktree (spec §3.3) whose cwd is not the project root.
# Exit: 2 = block, 0 = pass.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
REQUESTED=$(jq -r '.tool_input.subagent_type // empty' <<<"$INPUT")

# Agent tool can be called without subagent_type (defaults to general-purpose).
[[ -n "$REQUESTED" ]] || exit 0

# Plugin agents are addressed as '{plugin}:{agent}' in the Agent tool, but the
# allowlist below is built from .md basenames — compare against the bare name.
# The PREFIX itself is deliberately not validated: a wrong/typo'd prefix fails
# loudly at Agent dispatch anyway; this hook gates typo'd agent NAMES.
REQUESTED_BASE="${REQUESTED##*:}"

# Built-in agents that don't need a .md file.
BUILTIN=(
  "general-purpose"
  "claude"
  "Explore"
  "Plan"
  "claude-code-guide"
  "statusline-setup"
)

for BI in "${BUILTIN[@]}"; do
  [[ "$REQUESTED" == "$BI" ]] && exit 0
done

# Resolve MAIN project root. Inside a git worktree (incl. the native
# isolation: worktree kind), --show-toplevel returns the worktree dir; we use
# --git-common-dir to find the main .git, then its parent is the main repo.
# (Worktrees do check out tracked .claude/ content, but resolving against the
# main root keeps the allowlist stable regardless of worktree checkout state.)
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$PROJECT_ROOT" ]]; then
  COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || true)
  if [[ -n "$COMMON_DIR" ]]; then
    # --git-common-dir may be relative; resolve against cwd.
    [[ "$COMMON_DIR" = /* ]] || COMMON_DIR="$PWD/$COMMON_DIR"
    PROJECT_ROOT=$(cd "$(dirname "$COMMON_DIR")" && pwd)
  else
    PROJECT_ROOT="$PWD"
  fi
fi

# Gather allowed agents from both the project's .claude/agents/ and the
# plugin's own agents/ (when invoked via plugin).
ALLOWED=""
for DIR in "${PROJECT_ROOT}/.claude/agents" "${CLAUDE_PLUGIN_ROOT:-}/agents"; do
  [[ -d "$DIR" ]] || continue
  while IFS= read -r f; do
    ALLOWED+="$(basename "$f" .md)"$'\n'
  done < <(find "$DIR" -maxdepth 1 -name '*.md' -type f)
done

ALLOWED=$(printf '%s' "$ALLOWED" | sort -u | sed '/^$/d')

if [[ -z "$ALLOWED" ]]; then
  # No project agents found anywhere — pass through to avoid blocking on
  # fresh installs where the plugin hasn't materialized yet.
  exit 0
fi

if ! printf '%s\n' "$ALLOWED" | grep -Fxq -- "$REQUESTED_BASE"; then
  cat >&2 <<MSGEOF
BLOCKED: subagent_type '$REQUESTED' is not registered.
  available project agents:
$(printf '%s\n' "$ALLOWED" | sed 's/^/    /')
  available built-in agents:
$(printf '    %s\n' "${BUILTIN[@]}")
MSGEOF
  exit 2
fi

exit 0
