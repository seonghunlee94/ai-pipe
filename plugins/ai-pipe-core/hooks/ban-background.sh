#!/usr/bin/env bash
# ban-background.sh — spec §7.3
# PreToolUse hook for Bash. Block `run_in_background: true` on commands that
# should be foreground (build, test, lint, typecheck). Long-running dev
# servers / watchers / tails are allowed to run in background.
#
# Rationale: a backgrounded test run gives the agent a fake "passing" signal
# because the result isn't checked synchronously. Same for builds.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
BG=$(jq -r '.tool_input.run_in_background // false' <<<"$INPUT")
CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT")

# Not backgrounded → no concern.
[[ "$BG" == "true" ]] || exit 0
[[ -n "$CMD" ]] || exit 0

# Patterns where background is almost always wrong.
DISALLOWED_PATTERNS=(
  'npm[[:space:]]+(run[[:space:]]+)?(test|build|lint|typecheck|tsc)'
  'yarn[[:space:]]+(test|build|lint|typecheck|tsc)'
  'pnpm[[:space:]]+(test|build|lint|typecheck|tsc)'
  '(^|[[:space:]])tsc([[:space:]]|$)'
  '(^|[[:space:]])(eslint|prettier|biome)([[:space:]]|$)'
  '(^|[[:space:]])(vitest|jest|mocha)([[:space:]]+run)?'
  '(^|[[:space:]])(pytest|ruff|mypy)([[:space:]]|$)'
  '(^|[[:space:]])(go[[:space:]]+test|cargo[[:space:]]+(test|build|check))'
  '(^|[[:space:]])(make|gradle|mvn)([[:space:]]+(test|build|check|verify|install))'
  '(^|[[:space:]]|\./)(gradlew|mvnw)([[:space:]]+(test|build|check|verify|install))'
  '(^|[[:space:]])bazel[[:space:]]+(test|build)'
)

# Watcher / dev-server modes are legitimate backgrounding (the whole point is
# long-running). If any of these flags appear in the command, skip the block
# check — comment at top says watchers are allowed and we should keep that
# promise.
WATCHER_INDICATORS='(--watch|--watchAll|-w[[:space:]]|--ui|--serve|--dev|--hot)'
if [[ "$CMD" =~ $WATCHER_INDICATORS ]]; then
  exit 0
fi

for PAT in "${DISALLOWED_PATTERNS[@]}"; do
  if [[ "$CMD" =~ $PAT ]]; then
    cat >&2 <<EOF
BLOCKED: \`$CMD\` should not run in background.
  reason: a backgrounded build/test/lint hides failures from the agent.
  fix:    run it in foreground (omit run_in_background, or set it to false).
EOF
    exit 2
  fi
done

exit 0
