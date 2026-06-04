#!/usr/bin/env bash
# ban-background.sh — spec §7.3
# PreToolUse hook for Bash. Block `run_in_background: true` on commands that
# should be foreground (build, test, lint, typecheck). Long-running dev
# servers / watchers / tails are allowed to run in background.
#
# Rationale: a backgrounded test run gives the agent a fake "passing" signal
# because the result isn't checked synchronously. Same for builds.
# Exit: 2 = block, 0 = pass.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
BG=$(jq -r '.tool_input.run_in_background // false' <<<"$INPUT")
CMD_ORIG=$(jq -r '.tool_input.command // empty' <<<"$INPUT")

# Not backgrounded → no concern.
[[ "$BG" == "true" ]] || exit 0
[[ -n "$CMD_ORIG" ]] || exit 0

# Normalize subshell / backtick wrappers to spaces — same approach as
# verify-git-safety.sh so `(vite build)`, `$(npm test)`, `` `vitest` ``
# resolve to their bare form and the patterns below match.
CMD="${CMD_ORIG//\`/ }"
CMD="${CMD//\$(/ }"
CMD="${CMD//(/ }"
CMD="${CMD//)/ }"

# Patterns where background is almost always wrong.
DISALLOWED_PATTERNS=(
  '(npm|yarn|pnpm)[[:space:]]+(run[[:space:]]+)?(test|build|lint|typecheck|tsc)'
  '(^|[[:space:]])tsc([[:space:]]|$)'
  '(^|[[:space:]])(eslint|prettier|biome)([[:space:]]|$)'
  '(^|[[:space:]])(vitest|jest|mocha)([[:space:]]+run)?'
  '(^|[[:space:]])(pytest|ruff|mypy)([[:space:]]|$)'
  '(^|[[:space:]])(go[[:space:]]+test|cargo[[:space:]]+(test|build|check))'
  '(^|[[:space:]])(make|gradle|mvn)([[:space:]]+(test|build|check|verify|install))'
  '(^|[[:space:]]|\./)(gradlew|mvnw)([[:space:]]+(test|build|check|verify|install))'
  '(^|[[:space:]])bazel[[:space:]]+(test|build)'
  # Bundlers / build tools (their watcher / dev-server modes are allowed
  # below via WATCHER_FLAGS / WATCHER_TOOLS; reaching this list means
  # non-watcher.)
  '(^|[[:space:]])(webpack|vite|esbuild|rollup|parcel|tsup)([[:space:]]|$)'
)

# Watcher / dev-server modes are legitimate backgrounding (long-running by
# design). Two-part detection:
#
# 1. WATCHER_FLAGS — explicit flag forms with a trailing word boundary so
#    `--watch=false`, `--devtool=source-map`, `--hotfix-only`, `--servers=2`
#    don't false-allow. `--dev` / `--hot` standalone are NOT included because
#    `npm install --dev`, `pip install --dev` etc. are not watchers.
# 2. WATCHER_TOOLS — explicit dev-server / watcher CLIs. `vite` and `webpack`
#    have non-watcher subcommands (`vite build`), so we require the watcher
#    subcommand to be present.
#
# `-w` alone is too overloaded (`grep -w`, `xargs -w`, ...) to use as a
# watcher signal; agents should write the long form when they want background.
WATCHER_FLAGS='(--watch|--watchAll)([[:space:]]|$)'
WATCHER_TOOLS='(^|[[:space:]])(nodemon|webpack-dev-server|webpack[[:space:]]+serve|vite[[:space:]]+(dev|serve)|next[[:space:]]+dev|astro[[:space:]]+dev|remix[[:space:]]+dev|tsx[[:space:]]+watch)([[:space:]]|$)'
if [[ "$CMD" =~ $WATCHER_FLAGS ]] || [[ "$CMD" =~ $WATCHER_TOOLS ]]; then
  exit 0
fi

for PAT in "${DISALLOWED_PATTERNS[@]}"; do
  if [[ "$CMD" =~ $PAT ]]; then
    cat >&2 <<EOF
BLOCKED: \`$CMD_ORIG\` should not run in background.
  reason: a backgrounded build/test/lint hides failures from the agent.
  fix:    run it in foreground (omit run_in_background, or set it to false).
EOF
    exit 2
  fi
done

exit 0
