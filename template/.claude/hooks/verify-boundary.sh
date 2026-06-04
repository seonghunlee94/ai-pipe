#!/usr/bin/env bash
# verify-boundary.sh — spec §7.2
# PreToolUse hook for Edit|Write. Blocks edits to protected paths from
# agents other than project-ops. stdin: {"tool_input": {"file_path": "..."}, "agent_type": "..."}

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 1
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Files only the project-ops agent may modify.
PROTECTED_PATHS=(
  ".claude/rules/project-settings.md"
  ".claude/shared/github-project-ids.md"
  ".claude/settings.json"
  ".claude/config/pipeline.json"
)

for PROTECTED in "${PROTECTED_PATHS[@]}"; do
  if [[ "$FILE_PATH" == *"$PROTECTED"* ]]; then
    if [[ "$AGENT_TYPE" != "project-ops" ]]; then
      echo "BLOCKED: $FILE_PATH is protected. Only the project-ops agent may modify it (spec §7.2)." >&2
      exit 1
    fi
  fi
done

exit 0
