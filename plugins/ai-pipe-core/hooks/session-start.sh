#!/usr/bin/env bash
# session-start.sh — PR5
# SessionStart hook. stdout is injected into Claude's context at session
# start (per Claude Code hooks semantics), giving every session an immediate
# picture of pipeline state without burning a turn on discovery.
#
# Non-blocking by design: ALWAYS exit 0. A context hook must never stop a
# session — if anything fails, print what we know and move on.

set -uo pipefail   # no -e: every probe below is best-effort

echo "## ai-pipe session context"

# Pipeline version sync (CLI vs project)
VERSION_FILE=".claude/.dev-pipe-version"
if [[ -f "$VERSION_FILE" ]]; then
  echo "- pipeline version: $(cat "$VERSION_FILE" 2>/dev/null | head -1)"
else
  echo "- pipeline version: (not initialized — run \`ai-pipe init\`)"
fi

# Project settings presence + placeholder check
PS=".claude/rules/project-settings.md"
if [[ -f "$PS" ]]; then
  if grep -q '{{' "$PS" 2>/dev/null; then
    echo "- project-settings.md: placeholders NOT yet filled ({{ORG}} 등) — edit before running the pipeline"
  else
    echo "- project-settings.md: configured"
  fi
fi

# Active worktrees (native isolation leftovers indicate in-flight or failed tasks)
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  WT_COUNT=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')
  if [[ "${WT_COUNT:-1}" -gt 1 ]]; then
    echo "- active worktrees: $((WT_COUNT - 1)) beyond main — possible in-flight/failed tasks (see \`git worktree list\`)"
  fi
  BRANCH=$(git branch --show-current 2>/dev/null)
  [[ -n "$BRANCH" ]] && echo "- current branch: $BRANCH"
fi

# Last pipeline event (most recent run, last line)
LATEST_EVENTS=$(ls -t .artifacts/runs/*-events.jsonl 2>/dev/null | head -1)
if [[ -n "$LATEST_EVENTS" ]]; then
  LAST_EVENT=$(tail -1 "$LATEST_EVENTS" 2>/dev/null)
  echo "- last pipeline event (${LATEST_EVENTS##*/}): ${LAST_EVENT:0:200}"
fi

# Plugin toolchain uncommitted-changes probe (dev 모드 전용 best-effort — 항상 exit 0)
# 디렉토리-소스 설치(dev 모드)에서 CLAUDE_PLUGIN_ROOT 는 라이브 소스를 가리키므로
# uncommitted 변경이 있으면 세션 컨텍스트에 경고를 주입한다.
# git 실패 또는 clean tree 면 아무것도 출력하지 않는다
# (github-소스/캐시 설치 = use 모드 — 구조적으로 불변, 무음).
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  if git -C "$CLAUDE_PLUGIN_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    DIRTY=$(git -C "$CLAUDE_PLUGIN_ROOT" status --porcelain -- . 2>/dev/null)
    if [[ -n "$DIRTY" ]]; then
      # 첫 3개 파일을 쉼표로 구분해 표시
      FIRST3=$(printf '%s\n' "$DIRTY" | awk 'NR<=3{gsub(/^[ \t]*/,"",$0); print $NF}' | paste -sd ',' -)
      echo "- ⚠ plugin toolchain has UNCOMMITTED changes (dev-mode live source): $FIRST3"
      echo "  → review & commit them (a session can mutate its own toolchain in dev mode — see README §6)"
    fi
  fi
fi

exit 0
