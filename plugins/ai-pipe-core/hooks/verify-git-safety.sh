#!/usr/bin/env bash
# verify-git-safety.sh -- spec §7.3
# PreToolUse hook for Bash. Blocks destructive git commands. The agent can
# still ask the user to run them manually if truly needed.
#
# stdin: {"tool_input": {"command": "..."}, "agent_type": "..."}
# Exit: 2 = block (Claude Code shows stderr to model), 0 = pass.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
CMD_ORIG=$(jq -r '.tool_input.command // empty' <<<"$INPUT")

# Normalize subshell / command-substitution / backtick wrappers to spaces so a
# single set of regex patterns covers all of them. Backticks especially can't
# be safely placed in a bash regex literal -- they're command-substitution
# metacharacters inside `[[ ]]`. After normalization:
#   `(git push --force)`      -> ` git push --force `
#   `$(git push --force)`     -> ` git push --force `
#   `` `git push --force` ``  -> ` git push --force `
#   `(cd dir && git push --force)` -> ` cd dir && git push --force `
# This closes the subshell-wrap bypass on both ends (R7 fix, symmetric with
# R6's `)` in the dotfile end-anchor) without char-class gymnastics.
CMD="${CMD_ORIG//\`/ }"
CMD="${CMD//\$(/ }"
CMD="${CMD//(/ }"
CMD="${CMD//)/ }"

# Normalize git GLOBAL options so `git -C /tmp push --force origin main` etc. hit
# the existing block patterns (dogfood-arc R3 finding N24: global options between
# `git` and the subcommand shift it out of every block pattern).
#
# ONE generalized pass (not a per-option whack-a-mole — R2 hunter showed an
# enumerated no-arg list always leaves another global, e.g. --namespace/-p, as a
# residual bypass). Key insight: the SUBCOMMAND never starts with `-`, so collapse
# every option token between `git` and the first non-`-` token:
#   • mandatory-arg globals (enumerated) consume their following arg too, so the
#     arg can't be mistaken for the subcommand: -C -c --git-dir --work-tree
#     --namespace --super-prefix --config-env (both `=val` and ` val` forms).
#   • ANY other `-…`/`--…` token is treated as no-arg and dropped generically —
#     covers --no-pager/--paginate/-p/-P/--bare/--exec-path=…/future globals.
# Residual (documented, advisory): an UNKNOWN mandatory-arg global in the ` val`
# form would have its arg mistaken for the subcommand — rare; the common set is
# enumerated. Flat alternation, each branch carries its own trailing space (a
# nested form silently failed to match on BSD sed / macOS).
CMD=$(sed -E 's/git[[:space:]]+((-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)(=[^[:space:]]+|[[:space:]]+[^[:space:]]+)[[:space:]]+|-[^[:space:]]+[[:space:]]+)+/git /g' <<<"$CMD")

# Not a git command -> pass through. Matches `git ...` at command start, after
# a separator (`;`, `&&`, `||`, `|`), or via an absolute / relative path
# (`/usr/bin/git`, `./scripts/git`). Subshell forms are pre-normalized.
#
# A path-segment `git` like `cd path/git push-aside` still satisfies this fast
# filter; the downstream block patterns all require `git[[:space:]]+(push|...)`
# so a token like `push-aside` does not trigger a block.
[[ "$CMD" =~ (^|[[:space:]]|;|\&\&|\|\|?)([^[:space:]]*/)?git[[:space:]] ]] || exit 0

block() {
  echo "BLOCKED: $1" >&2
  echo "  command: $CMD_ORIG" >&2
  echo "  reason:  $2" >&2
  echo "  if intended, ask the user to run it manually." >&2
  exit 2
}

# Patterns are intentionally permissive -- `-f` alone is ambiguous, so we only
# match when paired with destructive subcommands.

# git push --force / -f (force-with-lease is safer but still risky on main)
if [[ "$CMD" =~ git[[:space:]]+push.*(--force([[:space:]]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$)) ]]; then
  block "force push detected" "force-pushing can overwrite teammates' work; never force-push main/master"
fi

# git reset --hard
if [[ "$CMD" =~ git[[:space:]]+reset[[:space:]]+(.*[[:space:]])?--hard ]]; then
  block "git reset --hard" "discards uncommitted work irreversibly"
fi

# git branch -D (force delete, even unmerged)
if [[ "$CMD" =~ git[[:space:]]+branch[[:space:]]+(.*[[:space:]])?-D([[:space:]]|$) ]]; then
  block "git branch -D" "force-deletes possibly unmerged branches; use -d instead"
fi

# git clean -f / -fd / -fdx (removes untracked files)
if [[ "$CMD" =~ git[[:space:]]+clean[[:space:]]+(.*[[:space:]])?-[a-zA-Z]*f ]]; then
  block "git clean -f" "removes untracked files irreversibly; review with -n first"
fi

# git checkout . / git restore . (discards working tree changes).
# Require `.` to be a STANDALONE argument. The end-of-token character class
# includes whitespace AND every shell separator (`;`, `|`, `&`, `<`, `>`) so
# chained commands like `git restore .;rm -rf .` don't slip through. (R7:
# `)` no longer needed in the class because subshell wrappers are normalized
# above into spaces.)
# Dotfile paths like `.env`, `.gitignore`, `.github/workflows/x.yml` still
# pass because the next char is alphanumeric, not in this set.
if [[ "$CMD" =~ git[[:space:]]+(checkout|restore)[[:space:]]+(--[[:space:]]+)?\.([[:space:];\\|\\&\\<\\>]|$) ]]; then
  block "git ${BASH_REMATCH[1]} . discards working tree" "use specific paths instead of '.'"
fi

# --no-verify (bypasses pre-commit/pre-push hooks)
if [[ "$CMD" =~ git[[:space:]]+(commit|push)[[:space:]]+.*--no-verify ]]; then
  block "--no-verify" "bypasses repo hooks; fix the failing hook instead"
fi

# git commit --amend on already-pushed commit -- we can't reliably detect "pushed"
# state from the command alone, but amend itself is risky enough to flag.
if [[ "$CMD" =~ git[[:space:]]+commit[[:space:]]+(.*[[:space:]])?--amend ]]; then
  block "git commit --amend" "amend rewrites the previous commit; create a new commit instead"
fi

exit 0
