#!/usr/bin/env bash
# validate-commit-msg.sh — spec §7.3
# PreToolUse hook for Bash. When the command is `git commit -m "..."`, verify
# the message matches Conventional Commits: <type>(<scope>)?: <subject>
# Allowed types: feat fix docs chore refactor test perf ci build revert style.
#
# Notes:
#   - Handles three forms: -m "msg", -m 'msg', and the recommended
#     -m "$(cat <<'EOF' ... EOF)" heredoc (CLAUDE.md's recommended pattern).
#   - Heredoc is detected FIRST so its quoted form isn't mistaken for a simple
#     inline message.
#   - `-F file` and `--no-edit` are left to the agent / pre-commit hooks.
#   - Subject must be 1-100 chars, must not end with a period.
# Exit: 2 = block, 0 = pass.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only target git commit invocations.
[[ "$CMD" =~ git[[:space:]]+commit ]] || exit 0

MSG=""

# Case A: heredoc form `$(cat <<'EOF' ... EOF)` — must be checked FIRST so the
# opening `$(cat ...` isn't captured as a simple -m "msg" by Case B.
if [[ "$CMD" =~ \<\<-?[\'\"]*EOF[\'\"]* ]]; then
  # First non-empty line after the heredoc-open line is the subject.
  MSG=$(printf '%s\n' "$CMD" | awk '
    /<<-?[A-Za-z'\''"]*EOF/ { found_open = 1; next }
    found_open && NF { print; exit }
  ')
fi

# Case B: simple inline -m "msg" or -m 'msg'.
if [[ -z "$MSG" ]]; then
  if [[ "$CMD" =~ -[aA]?m[[:space:]]+\"([^\"]+)\" ]]; then
    CANDIDATE="${BASH_REMATCH[1]}"
    # Defensive: if the captured value looks like the start of a heredoc/subshell,
    # ignore it (heredoc detection above should have caught it).
    [[ "$CANDIDATE" != \$\(* ]] && MSG="$CANDIDATE"
  elif [[ "$CMD" =~ -[aA]?m[[:space:]]+\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[1]}"
  fi
fi

# No detectable message → pass (could be -F file, --no-edit, --amend, etc.).
[[ -n "$MSG" ]] || exit 0

# Subject = first line only.
SUBJECT=$(printf '%s\n' "$MSG" | head -n1)

CC_REGEX='^(feat|fix|docs|chore|refactor|test|perf|ci|build|revert|style)(\([a-zA-Z0-9_/.-]+\))?(!)?: .+'

if ! [[ "$SUBJECT" =~ $CC_REGEX ]]; then
  cat >&2 <<MSGEOF
BLOCKED: commit subject does not match Conventional Commits format.
  subject:  $SUBJECT
  expected: <type>(<scope>)?: <subject>
  types:    feat fix docs chore refactor test perf ci build revert style
  example:  feat(auth): add email/password login
MSGEOF
  exit 2
fi

# Subject length: 1..100 chars after the "type: " prefix. 100 is a project
# soft cap; Conventional Commits standard doesn't mandate. Override by editing
# this hook in your fork.
SUBJ_TAIL="${SUBJECT#*: }"
LEN=${#SUBJ_TAIL}
if (( LEN < 1 || LEN > 100 )); then
  echo "BLOCKED: commit subject body length $LEN (must be 1-100 chars)." >&2
  exit 2
fi

# No trailing period on subject.
if [[ "${SUBJECT: -1}" == "." ]]; then
  echo "BLOCKED: commit subject must not end with a period." >&2
  exit 2
fi

exit 0
