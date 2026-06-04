#!/usr/bin/env bash
# validate-commit-msg.sh — spec §7.3
# PreToolUse hook for Bash. When the command is `git commit ...`, verify the
# message matches Conventional Commits: <type>(<scope>)?(!)?: <subject>
# Allowed types: feat fix docs chore refactor test perf ci build revert style.
#
# Supported forms (all checked):
#   git commit -m "msg"        # double-quoted
#   git commit -m 'msg'        # single-quoted
#   git commit -m"msg"         # no space (POSIX getopt)
#   git commit -am "msg"
#   git commit --message "msg"
#   git commit --message="msg"
#   git commit -m "$(cat <<'EOF' ... EOF)"  # heredoc (CLAUDE.md pattern)
#
# Skipped (no inline message we can read):
#   git commit -F file
#   git commit --no-edit
#   git commit --amend (separate hook handles this)
# Exit: 2 = block (Claude Code shows stderr to model), 0 = pass.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT")

# Only target git commit invocations.
[[ "$CMD" =~ git[[:space:]]+commit ]] || exit 0

MSG=""

# Case A (highest priority): heredoc form `$(cat <<'EOF' ... EOF)`.
# Must be checked FIRST so the opening `$(cat ...` isn't captured as a
# simple -m "msg" by Case B. `<` is not a regex metachar in bash; no escape.
if [[ "$CMD" =~ \<\<-?[\'\"]*EOF[\'\"]* ]]; then
  MSG=$(printf '%s\n' "$CMD" | awk '
    /<<-?[A-Za-z'\''"]*EOF/ { found_open = 1; next }
    found_open && NF { print; exit }
  ')
fi

# Case B: --message="msg" or --message "msg" (long form).
if [[ -z "$MSG" ]]; then
  if [[ "$CMD" =~ --message=\"([^\"]+)\" ]]; then
    MSG="${BASH_REMATCH[1]}"
  elif [[ "$CMD" =~ --message=\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[1]}"
  elif [[ "$CMD" =~ --message[[:space:]]+\"([^\"]+)\" ]]; then
    MSG="${BASH_REMATCH[1]}"
  elif [[ "$CMD" =~ --message[[:space:]]+\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[1]}"
  fi
fi

# Case C: short form -m / -am with or without space, with double or single
# quotes. The `-[aA]?m` allows `-m`, `-am`, `-Am`.
if [[ -z "$MSG" ]]; then
  if [[ "$CMD" =~ -[aA]?m[[:space:]]*\"([^\"]+)\" ]]; then
    CANDIDATE="${BASH_REMATCH[1]}"
    # Defensive: if the captured value starts with `$(` it's likely the head
    # of a subshell/heredoc that Case A failed to parse. Treat as no message.
    [[ "$CANDIDATE" != \$\(* ]] && MSG="$CANDIDATE"
  elif [[ "$CMD" =~ -[aA]?m[[:space:]]*\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[1]}"
  fi
fi

# No detectable inline message → pass (could be -F file, --no-edit, etc.).
[[ -n "$MSG" ]] || exit 0

# Subject = first non-empty line.
SUBJECT=$(printf '%s\n' "$MSG" | awk 'NF{print; exit}')

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

# Subject length: 1..100 chars after the "type: " prefix.
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
