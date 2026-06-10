#!/usr/bin/env bash
# stop-checkpoint.sh — PR5
# SessionEnd hook. Appends a session-end checkpoint line to the latest run's JSONL
# event stream (spec §12.1) so interrupted pipelines can be resumed with
# context about where the session left off.
#
# Non-blocking by design: ALWAYS exit 0 — a checkpoint writer must never
# prevent a session from ending.

set -uo pipefail   # no -e: best-effort

LATEST_EVENTS=$(ls -t .artifacts/runs/*-events.jsonl 2>/dev/null | head -1)
[[ -n "$LATEST_EVENTS" ]] || exit 0   # no active run — nothing to checkpoint

# Summarize working-tree state without leaking file contents.
DIRTY_COUNT=0
BRANCH=""
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  DIRTY_COUNT=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  BRANCH=$(git branch --show-current 2>/dev/null)
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if command -v jq >/dev/null 2>&1; then
  jq -nc --arg ts "$TS" --arg branch "${BRANCH:-}" --argjson dirty "${DIRTY_COUNT:-0}" \
    '{ts: $ts, type: "session_stop", branch: $branch, dirty_files: $dirty}' \
    >> "$LATEST_EVENTS" 2>/dev/null
else
  # jq unavailable — write a minimal well-formed line by hand (branch names
  # with quotes are vanishingly rare; dirty count is numeric).
  printf '{"ts":"%s","type":"session_stop","branch":"%s","dirty_files":%s}\n' \
    "$TS" "${BRANCH:-}" "${DIRTY_COUNT:-0}" >> "$LATEST_EVENTS" 2>/dev/null
fi

exit 0
