#!/usr/bin/env bash
# validate-commit-msg.sh — spec §7.3
# PreToolUse hook for Bash. When the command is `git commit ...`, verify the
# message matches Conventional Commits: <type>(<scope>)?(!)?: <subject>
# Allowed types: feat fix docs chore refactor test perf ci build revert style.
#
# Supported forms (all checked):
#   git commit -m "msg"            # double-quoted
#   git commit -m 'msg'            # single-quoted
#   git commit -m"msg"             # no space
#   git commit -am "msg"
#   git commit -mTOKEN             # bare token, no quotes (bash allows when
#                                  # no special chars are present)
#   git commit -m TOKEN
#   git commit --message "msg"
#   git commit --message='msg'
#   git commit --message=TOKEN     # bare token after =
#   git commit -m "$(cat <<'TAG' ... TAG)"  # heredoc with arbitrary tag
#                                           # (TAG can be EOF, MSGEOF, END, etc.)
#
# Skipped (no inline message we can read):
#   git commit -F file
#   git commit --no-edit
#   git commit --amend (verify-git-safety.sh handles this)
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

# Case A (highest priority): heredoc form `-m "$(cat <<'TAG' ... TAG)"`.
# Must be checked FIRST so the opening `$(cat ...` isn't captured as a bare
# token by Case B/C/D.
#
# ANCHORED to the message flag (dogfood finding): an unanchored `<<TAG` match
# fired on ANY heredoc in a compound command — e.g. `cat > pkg.json <<'EOF'
# { ... } EOF && git commit -m "chore: x"` extracted `{` as the subject and
# false-blocked. The construct must be `-m`/`-am`/`--message` followed by
# `"$(cat <<TAG`. The subject is then taken from the text right after the
# matched opener (no tag re-search — immune to same-tag file heredocs).
CASE_A_RE='(^|[[:space:]])(-[a-zA-Z]*m|--message)[[:space:]]*=?[[:space:]]*\"?\$\(cat[[:space:]]+<<-?['"'"'\"]*([A-Za-z_][A-Za-z0-9_]*)'
if [[ "$CMD" =~ $CASE_A_RE ]]; then
  rest="${CMD#*"${BASH_REMATCH[0]}"}"
  # Drop the remainder of the opener line (closing quote etc.); the subject is
  # the first non-empty line after it.
  MSG=$(printf '%s\n' "$rest" | tail -n +2 | awk 'NF { print; exit }')
fi

# Case B: --message="msg" or --message "msg" (quoted long form).
# Left-anchored `(^|[[:space:]])` for the same defensive reason as Case C/D:
# unanchored `--message=` could match substrings of unknown future flags.
if [[ -z "$MSG" ]]; then
  if [[ "$CMD" =~ (^|[[:space:]])--message=\"([^\"]+)\" ]]; then
    MSG="${BASH_REMATCH[2]}"
  elif [[ "$CMD" =~ (^|[[:space:]])--message=\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[2]}"
  elif [[ "$CMD" =~ (^|[[:space:]])--message[[:space:]]+\"([^\"]+)\" ]]; then
    MSG="${BASH_REMATCH[2]}"
  elif [[ "$CMD" =~ (^|[[:space:]])--message[[:space:]]+\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[2]}"
  fi
fi

# Case C: short form -m / -am with double or single quotes.
# Left anchor `(^|[[:space:]])` prevents matching the inner `m` of unrelated
# long flags like `--merge`, `--max-count`, `--reuse-message`. BASH_REMATCH[1]
# is the anchor, [2] is the message — note the shift from the unanchored form.
if [[ -z "$MSG" ]]; then
  # `-[a-zA-Z]*m` also parses BUNDLED short flags ending in m (`-qm "..."`,
  # `-sm "..."` — dogfood finding: `-qm` previously fell through unparsed).
  if [[ "$CMD" =~ (^|[[:space:]])-[a-zA-Z]*m[[:space:]]*\"([^\"]+)\" ]]; then
    CANDIDATE="${BASH_REMATCH[2]}"
    # Defensive: if the captured value starts with `$(` it's likely the head
    # of a subshell/heredoc that Case A failed to parse. Treat as no message.
    [[ "$CANDIDATE" != \$\(* ]] && MSG="$CANDIDATE"
  elif [[ "$CMD" =~ (^|[[:space:]])-[a-zA-Z]*m[[:space:]]*\'([^\']+)\' ]]; then
    MSG="${BASH_REMATCH[2]}"
  fi
fi

# Case D: UNQUOTED bare-token forms — `-mTOKEN`, `-m TOKEN`, `--message=TOKEN`,
# `--message TOKEN`. Token has no whitespace/quotes (bash doesn't require
# quoting when no special chars are present). These almost always fail the
# Conventional Commits regex (no space-separated subject), so users hitting
# this branch see a clear BLOCKED message instead of a silent pass.
# Same left-anchor discipline as Case C so `--merge` / `--max-count=10` etc.
# don't get their inner `m` captured (round-2 regression).
if [[ -z "$MSG" ]]; then
  if [[ "$CMD" =~ (^|[[:space:]])--message=([^[:space:]\'\"]+) ]]; then
    MSG="${BASH_REMATCH[2]}"
  elif [[ "$CMD" =~ (^|[[:space:]])--message[[:space:]]+([^[:space:]\'\"-][^[:space:]\'\"]*) ]]; then
    MSG="${BASH_REMATCH[2]}"
  elif [[ "$CMD" =~ (^|[[:space:]])-[aA]?m([A-Za-z0-9][^[:space:]\'\"]*) ]]; then
    # -mTOKEN (no space). Don't match -m alone or -m followed by quote.
    MSG="${BASH_REMATCH[2]}"
  elif [[ "$CMD" =~ (^|[[:space:]])-[aA]?m[[:space:]]+([^[:space:]\'\"-][^[:space:]\'\"]*) ]]; then
    # -m TOKEN (space + bare token, not starting with - to avoid flags).
    MSG="${BASH_REMATCH[2]}"
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
