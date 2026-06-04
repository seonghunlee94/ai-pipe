#!/usr/bin/env bash
# validate-subagent-type.sh — spec §7.3
# PreToolUse hook for Agent. Allows only subagent_type values that correspond
# to a file in .claude/agents/*.md, plus Claude Code's built-in agents.
#
# Why: typos and hallucinated agent names should fail loudly, not silently
# fall through to a default agent.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 1
fi

INPUT=$(cat)
REQUESTED=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')

# Agent tool can be called without subagent_type (defaults to general-purpose).
[[ -n "$REQUESTED" ]] || exit 0

# Built-in agents that don't need a .claude/agents/*.md file.
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

# Project agents — derive whitelist from filenames.
AGENTS_DIR=".claude/agents"
if [[ ! -d "$AGENTS_DIR" ]]; then
  echo "BLOCKED: $AGENTS_DIR not found; cannot validate subagent_type." >&2
  exit 1
fi

ALLOWED=$(find "$AGENTS_DIR" -maxdepth 1 -name '*.md' -exec basename {} .md \; | sort -u)

if ! echo "$ALLOWED" | grep -qx "$REQUESTED"; then
  cat >&2 <<EOF
BLOCKED: subagent_type '$REQUESTED' is not registered.
  available project agents:
$(echo "$ALLOWED" | sed 's/^/    /')
  available built-in agents:
$(printf '    %s\n' "${BUILTIN[@]}")
EOF
  exit 1
fi

exit 0
