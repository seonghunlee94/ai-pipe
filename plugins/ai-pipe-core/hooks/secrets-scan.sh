#!/usr/bin/env bash
# secrets-scan.sh — PR5 (PR3 예고: raw curl 토큰 차단의 강제 지점)
# PreToolUse hook for Edit|Write AND Bash.
#   Edit/Write: blocks file contents containing credential patterns.
#   Bash: blocks commands embedding tokens (curl auth headers, inline env).
#
# Rationale (Managed-Agents credential isolation, PR1 research): credentials
# must never appear in tool inputs — they live in gh auth's store / OS
# keychain. A leaked token in a command line or file lands in transcripts,
# logs, and possibly git history.
#
# False-positive escape: placeholders/docs use ghp_XXXX / <token> forms that
# the patterns below deliberately don't match (length/charset constraints).
# Exit: 2 = block, 0 = pass.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is required for ai-pipe hooks. Install with: brew install jq" >&2
  exit 2
fi

INPUT=$(cat)
TOOL=$(jq -r '.tool_name // empty' <<<"$INPUT")

# Collect the text to scan depending on the tool shape.
#   Edit:  .tool_input.new_string
#   Write: .tool_input.content
#   Bash:  .tool_input.command
TEXT=$(jq -r '(.tool_input.new_string // "") + "\n" + (.tool_input.content // "") + "\n" + (.tool_input.command // "")' <<<"$INPUT")
[[ -n "${TEXT//[[:space:]]/}" ]] || exit 0

block() {
  echo "BLOCKED: potential credential detected ($1)." >&2
  echo "  Credentials must never appear in commands or files (transcripts/logs/git history retain them)." >&2
  echo "  Use \`gh auth\` / OS keychain / environment configured OUTSIDE the agent session." >&2
  exit 2
}

# --- Token formats (length/charset constrained to avoid placeholder FPs) ---
# GitHub classic PAT (ghp_ + 36 alnum), fine-grained (github_pat_ + 22 + _ + 59)
if grep -qE 'ghp_[A-Za-z0-9]{36}' <<<"$TEXT"; then block "GitHub classic PAT"; fi
if grep -qE 'github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}' <<<"$TEXT"; then block "GitHub fine-grained PAT"; fi
# GitHub OAuth / server tokens
if grep -qE 'gh[ours]_[A-Za-z0-9]{36}' <<<"$TEXT"; then block "GitHub app/oauth token"; fi
# AWS access key id + secret heuristic
if grep -qE 'AKIA[0-9A-Z]{16}' <<<"$TEXT"; then block "AWS access key ID"; fi
if grep -qiE 'aws_secret_access_key[[:space:]]*[=:][[:space:]]*[A-Za-z0-9/+=]{40}' <<<"$TEXT"; then block "AWS secret access key"; fi
# Anthropic API key
if grep -qE 'sk-ant-[A-Za-z0-9_-]{20,}' <<<"$TEXT"; then block "Anthropic API key"; fi
# OpenAI-style keys: sk- followed by 20+ chars but NOT the sk-ant- prefix
# (that's matched above). The negative lookahead-style guard keeps this from
# firing on Anthropic keys without skipping a co-located OpenAI key.
if grep -qE 'sk-(proj-|svcacct-)?[A-Za-z0-9]{20,}' <<<"$TEXT" && ! grep -qE 'sk-ant-[A-Za-z0-9]{20,}' <<<"$TEXT"; then block "API key (sk- prefix)"; fi
# Slack tokens
if grep -qE 'xox[baprs]-[A-Za-z0-9-]{10,}' <<<"$TEXT"; then block "Slack token"; fi
# Private key blocks
if grep -qE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' <<<"$TEXT"; then block "private key material"; fi
# JWT (three base64url segments, header starts eyJ)
if grep -qE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' <<<"$TEXT"; then block "JWT"; fi

# --- Bash-specific: auth headers / basic-auth carrying inline literal values ---
if [[ "$TOOL" == "Bash" || -z "$TOOL" ]]; then
  CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT")
  if [[ -n "$CMD" ]]; then
    # A literal `Authorization: token|Bearer <value>` header is a leaked secret
    # regardless of which tool carries it — match it directly (no curl-proximity
    # requirement, so query-string `&` in the URL can't break the scan). Allow
    # `$VAR`/`${VAR}` expansion forms, which keep the secret out of the command.
    if grep -qiE 'authorization:[[:space:]]*(token|bearer)[[:space:]]+[A-Za-z0-9_.-]{8,}' <<<"$CMD" \
       && ! grep -qiE 'authorization:[[:space:]]*(token|bearer)[[:space:]]+[$"'"'"']*\$' <<<"$CMD"; then
      block "literal Authorization header (use gh CLI or MCP instead)"
    fi
    # `-u user:password` basic-auth. Split on real command separators
    # (&& || ; |) — NOT single `&` — so a query-string `&` stays in the curl
    # segment but a later command's `-u` (e.g. `... && psql -u a:b`) is judged
    # in its own segment. Only flag a segment that actually invokes curl/wget.
    SEGMENTS=$(printf '%s' "$CMD" | sed -E 's/(\&\&|\|\||;|\|)/\n/g')
    while IFS= read -r SEG; do
      [[ "$SEG" =~ (curl|wget) ]] || continue
      if grep -qE '[[:space:]]-u[[:space:]]+[^[:space:]$]+:[^[:space:]$]+' <<<"$SEG"; then
        block "curl/wget with inline basic-auth credentials"
      fi
    done <<<"$SEGMENTS"
  fi
fi

exit 0
