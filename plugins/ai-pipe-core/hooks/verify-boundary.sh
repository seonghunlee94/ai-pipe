#!/usr/bin/env bash
# verify-boundary.sh — spec §7.2
# PreToolUse hook for Edit|Write. Blocks edits to protected paths from
# subagents other than project-ops. Main session (no agent_type) is trusted.
# stdin: {"tool_input": {"file_path": "..."}, "agent_type": "..."}
# Exit codes follow Claude Code convention: 2 = block (stderr shown to model).

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Empty agent_type = main Claude Code session, not a subagent.
# The user is editing directly, so we trust the action.
[[ -n "$AGENT_TYPE" ]] || exit 0

# Suffix-match (not substring) to avoid false positives on .bak / .example etc.
PROTECTED_SUFFIXES=(
  ".claude/rules/project-settings.md"
  ".claude/shared/github-project-ids.md"
  ".claude/settings.json"
  ".claude/config/pipeline.json"
)

for PROTECTED in "${PROTECTED_SUFFIXES[@]}"; do
  if [[ "$FILE_PATH" == "$PROTECTED" ]] || [[ "$FILE_PATH" == *"/$PROTECTED" ]]; then
    if [[ "$AGENT_TYPE" != "project-ops" ]]; then
      echo "BLOCKED: $FILE_PATH is protected. Only the project-ops agent may modify it (spec §7.2)." >&2
      exit 2
    fi
  fi
done

exit 0
