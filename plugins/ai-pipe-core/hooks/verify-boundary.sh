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
FILE_PATH=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")
AGENT_TYPE=$(jq -r '.agent_type // empty' <<<"$INPUT")

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

# Plugin-toolchain guard (dogfood-arc R3, N24 클래스)
# 주의 사항:
# (a) 메인 세션(빈 agent_type)은 위의 [[ -n "$AGENT_TYPE" ]] || exit 0 에서 이미 통과됨 — 신뢰됨.
# (b) Edit/Write PreToolUse 만 guards — Bash 파일 쓰기는 우회 가능 (advisory 레이어, 다른 훅과 동급).
# (c) 절대 경로 prefix 매칭만 수행 — 상대 경로는 resolve 하지 않음.
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -n "$FILE_PATH" ]]; then
  if [[ "$FILE_PATH" == "$CLAUDE_PLUGIN_ROOT" || "$FILE_PATH" == "$CLAUDE_PLUGIN_ROOT"/* ]]; then
    echo "BLOCKED: $FILE_PATH is inside the plugin toolchain (\$CLAUDE_PLUGIN_ROOT). Subagents must never modify the toolchain that governs them — propose the change to the main session instead." >&2
    exit 2
  fi
fi

exit 0
