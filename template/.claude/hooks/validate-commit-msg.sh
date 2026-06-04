#!/usr/bin/env bash
# validate-commit-msg.sh — spec §7.3
# PreToolUse hook for Bash. When the command is `git commit -m "..."`, verify
# the message matches Conventional Commits: <type>(<scope>)?: <subject>
# Allowed types: feat fix docs chore refactor test perf ci build revert style.
#
# Notes:
#   - Only checks `-m` / `-am` inline messages. `-F file` is left to the agent
#     (verifier can validate the file separately).
#   - Subject must be 1-100 chars, must not end with a period.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 1
fi

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only target git commit invocations.
[[ "$CMD" =~ git[[:space:]]+commit ]] || exit 0

# Extract -m or -am message. Supports both 'single' and "double" quoted forms,
# and heredoc-style `-m "$(cat <<'EOF' ... EOF)"`. For heredocs we only see the
# opening line, so we extract the subject from the next visible content.

MSG=""
# Case 1: -m "msg" or -m 'msg' (simple inline)
if [[ "$CMD" =~ -[aA]?m[[:space:]]+\"([^\"]+)\" ]]; then
  MSG="${BASH_REMATCH[1]}"
elif [[ "$CMD" =~ -[aA]?m[[:space:]]+\'([^\']+)\' ]]; then
  MSG="${BASH_REMATCH[1]}"
fi

# Heredoc form: $(cat <<'EOF' ... EOF) — pull the first non-empty line after EOF marker.
if [[ -z "$MSG" ]] && [[ "$CMD" =~ \<\<[\'\"]*EOF[\'\"]*[[:space:]]+ ]]; then
  MSG=$(echo "$CMD" | awk '/<<.?EOF.?$/{flag=1; next} flag && NF{print; exit}')
fi

# No detectable message → pass (could be -F file, --no-edit, etc.).
[[ -n "$MSG" ]] || exit 0

# Subject = first line only.
SUBJECT=$(echo "$MSG" | head -n1)

CC_REGEX='^(feat|fix|docs|chore|refactor|test|perf|ci|build|revert|style)(\([a-zA-Z0-9_/.-]+\))?(!)?: .+'

if ! [[ "$SUBJECT" =~ $CC_REGEX ]]; then
  cat >&2 <<EOF
BLOCKED: commit subject does not match Conventional Commits format.
  subject: $SUBJECT
  expected: <type>(<scope>)?: <subject>
  types:    feat fix docs chore refactor test perf ci build revert style
  example:  feat(auth): add email/password login
EOF
  exit 1
fi

# Subject length: 1..100 chars after the "type: " prefix.
SUBJ_TAIL="${SUBJECT#*: }"
LEN=${#SUBJ_TAIL}
if (( LEN < 1 || LEN > 100 )); then
  echo "BLOCKED: commit subject body length $LEN (must be 1-100 chars)." >&2
  exit 1
fi

# No trailing period on subject.
if [[ "${SUBJECT: -1}" == "." ]]; then
  echo "BLOCKED: commit subject must not end with a period." >&2
  exit 1
fi

exit 0
