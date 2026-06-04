#!/usr/bin/env bash
# validate-subagent-type.sh — spec §7.3
# PreToolUse hook for Agent. Allows only subagent_type values registered as
# project agents (.claude/agents/*.md AND ${CLAUDE_PLUGIN_DIR}/agents/*.md)
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
REQUESTED=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')

# Agent tool can be called without subagent_type (defaults to general-purpose).
[[ -n "$REQUESTED" ]] || exit 0

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

# Resolve project root.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$PROJECT_ROOT" ]]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
fi

# Gather allowed agents from both the project's .claude/agents/ and the
# plugin's own agents/ (when invoked via plugin).
ALLOWED=""
for DIR in "${PROJECT_ROOT}/.claude/agents" "${CLAUDE_PLUGIN_DIR:-}/agents"; do
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

if ! printf '%s\n' "$ALLOWED" | grep -qx "$REQUESTED"; then
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
