#!/usr/bin/env bash
# Table-driven harness for the 6 PreToolUse safety hooks. Feeds crafted JSON
# payloads on stdin and asserts the exit code (2 = block, 0 = allow) AND, for
# block cases, that stderr names the real reason (so a hook exiting 2 for the
# wrong reason — e.g. the jq-missing guard — does not pass). Run via
# `npm run test:hooks`. Exits non-zero if any case fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS="$REPO_ROOT/plugins/ai-pipe-core/hooks"

# validate-subagent-type resolves its whitelist from these; point them at the
# plugin so real agent names pass and bogus ones are blocked.
export CLAUDE_PLUGIN_ROOT="$REPO_ROOT/plugins/ai-pipe-core"
export CLAUDE_PROJECT_DIR="$REPO_ROOT"

if ! command -v jq >/dev/null 2>&1; then
  echo "hook harness requires jq" >&2
  exit 78
fi

PASS=0
FAIL=0

# check <desc> <hook.sh> <expected_exit> <json> [expected_stderr_substring]
check() {
  local desc="$1" hook="$2" want="$3" json="$4" substr="${5:-}" got err ok=1
  err=$(printf '%s' "$json" | bash "$HOOKS/$hook" 2>&1 >/dev/null)
  got=$?
  [[ "$got" == "$want" ]] || ok=0
  if [[ -n "$substr" && "$err" != *"$substr"* ]]; then ok=0; fi
  if [[ "$ok" == 1 ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL  %-22s %-28s want %s/"%s" got %s | %s\n' \
      "$hook" "$desc" "$want" "$substr" "$got" "${err%%$'\n'*}"
  fi
}

# --- payload builders (jq --arg avoids all quoting hazards) ---
p_cmd()      { jq -nc --arg c "$1" '{tool_input:{command:$c}}'; }
p_bg()       { jq -nc --arg c "$1" --argjson bg "$2" '{tool_input:{command:$c,run_in_background:$bg}}'; }
p_boundary() { jq -nc --arg f "$1" --arg a "$2" '{tool_input:{file_path:$f},agent_type:$a}'; }
p_subagent() { jq -nc --arg s "$1" '{tool_input:{subagent_type:$s}}'; }
p_swrite()   { jq -nc --arg c "$1" '{tool_name:"Write",tool_input:{content:$c}}'; }
p_sbash()    { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }

# --- verify-boundary ---
check "block protected edit" verify-boundary.sh 2 "$(p_boundary ".claude/config/pipeline.json" "backend-eng")" "is protected"
check "allow project-ops"    verify-boundary.sh 0 "$(p_boundary ".claude/config/pipeline.json" "project-ops")"
check "allow main session"   verify-boundary.sh 0 "$(p_boundary ".claude/config/pipeline.json" "")"
check "allow normal src"     verify-boundary.sh 0 "$(p_boundary "src/index.ts" "backend-eng")"

# --- verify-git-safety (each block pattern + subshell normalization) ---
check "block force push"   verify-git-safety.sh 2 "$(p_cmd "git push --force origin main")" "force push"
check "block force -f"      verify-git-safety.sh 2 "$(p_cmd "git push -f origin main")" "force push"
check "block subshell push" verify-git-safety.sh 2 "$(p_cmd "echo x && \$(git push --force)")" "force push"
check "block reset hard"    verify-git-safety.sh 2 "$(p_cmd "git reset --hard HEAD~1")" "reset --hard"
check "block branch -D"     verify-git-safety.sh 2 "$(p_cmd "git branch -D feature")" "branch -D"
check "block clean -fd"     verify-git-safety.sh 2 "$(p_cmd "git clean -fd")" "git clean"
check "block checkout dot"  verify-git-safety.sh 2 "$(p_cmd "git checkout .")" "discards working tree"
check "block no-verify"     verify-git-safety.sh 2 "$(p_cmd "git commit -m x --no-verify")" "no-verify"
check "block amend"         verify-git-safety.sh 2 "$(p_cmd "git commit --amend -m x")" "amend"
check "allow plain push"    verify-git-safety.sh 0 "$(p_cmd "git push origin main")"
check "allow git status"    verify-git-safety.sh 0 "$(p_cmd "git status")"
check "allow checkout file" verify-git-safety.sh 0 "$(p_cmd "git checkout src/x.ts")"

# --- validate-commit-msg (forms + length + period) ---
HEREDOC_OK=$'git commit -m "$(cat <<\'EOF\'\nfeat: heredoc subject\nEOF\n)"'
HEREDOC_BAD=$'git commit -m "$(cat <<\'EOF\'\nadded a thing no type\nEOF\n)"'
LONG_SUBJECT=$(head -c 101 </dev/zero | tr '\0' a)
check "allow -m conventional" validate-commit-msg.sh 0 "$(p_cmd 'git commit -m "feat: add thing"')"
check "allow --message= form" validate-commit-msg.sh 0 "$(p_cmd 'git commit --message="fix: a bug"')"
check "allow heredoc form"     validate-commit-msg.sh 0 "$(p_cmd "$HEREDOC_OK")"
check "block heredoc non-type" validate-commit-msg.sh 2 "$(p_cmd "$HEREDOC_BAD")" "Conventional Commits"
check "block non-type msg"     validate-commit-msg.sh 2 "$(p_cmd 'git commit -m "added a thing"')" "Conventional Commits"
check "block --message no type" validate-commit-msg.sh 2 "$(p_cmd 'git commit --message="no type here"')" "Conventional Commits"
check "block over-long subject" validate-commit-msg.sh 2 "$(p_cmd "git commit -m \"feat: $LONG_SUBJECT\"")" "length"
check "block trailing period"   validate-commit-msg.sh 2 "$(p_cmd 'git commit -m "feat: ends here."')" "period"
check "ignore non-commit"       validate-commit-msg.sh 0 "$(p_cmd "ls -la")"

# --- ban-background (build/test block + watcher allow) ---
check "block bg test"     ban-background.sh 2 "$(p_bg "npm test" true)" "background"
check "block bg build"    ban-background.sh 2 "$(p_bg "npm run build" true)" "background"
check "allow fg test"     ban-background.sh 0 "$(p_bg "npm test" false)"
# real watcher detection: --watch flag (WATCHER_FLAGS) and a dev-server (WATCHER_TOOLS)
check "allow bg --watch"   ban-background.sh 0 "$(p_bg "vitest --watch" true)"
check "allow bg vite dev"  ban-background.sh 0 "$(p_bg "vite dev" true)"
# non-build/non-watcher bg command: passes because nothing matches DISALLOWED
check "allow bg non-build" ban-background.sh 0 "$(p_bg "tail -f log.txt" true)"

# --- validate-subagent-type ---
check "allow real agent"  validate-subagent-type.sh 0 "$(p_subagent "backend-eng")"
check "allow builtin"     validate-subagent-type.sh 0 "$(p_subagent "general-purpose")"
check "block bogus agent" validate-subagent-type.sh 2 "$(p_subagent "totally-made-up")" "not registered"

# --- secrets-scan (token families + auth) ---
# Secret-pattern fixtures are ASSEMBLED AT RUNTIME from a prefix + a repeated
# filler so no complete, matchable secret literal is ever committed (which would
# trip GitHub push protection / secret scanning — and is bad practice even for
# fakes). Each assembled value still matches the corresponding hook regex.
rep() { printf "%${2}s" "" | tr ' ' "$1"; } # rep <char> <count>
GH_PAT="ghp_$(rep a 36)"                          # ghp_[A-Za-z0-9]{36}
AWS_ID="AKIA$(rep A 16)"                          # AKIA[0-9A-Z]{16}
ANTHROPIC="sk-ant-$(rep a 24)"                    # sk-ant-[A-Za-z0-9_-]{20,}
OPENAI="sk-proj-$(rep a 24)"                      # sk-(proj-)?[A-Za-z0-9]{20,}
SLACK="xoxb-$(rep 1 11)-$(rep a 12)"              # xox[baprs]-[A-Za-z0-9-]{10,}
JWT="eyJ$(rep a 12).$(rep b 12).$(rep c 12)"      # eyJ…{10,}.…{10,}.…{10,}
PRIVKEY="$(rep - 5)BEGIN RSA PRIVATE KEY$(rep - 5)" # -----BEGIN [A-Z ]*PRIVATE KEY-----
check "block github PAT"   secrets-scan.sh 2 "$(p_swrite "t = $GH_PAT")" "GitHub"
check "block AWS key id"    secrets-scan.sh 2 "$(p_swrite "id = $AWS_ID")" "AWS"
check "block anthropic key" secrets-scan.sh 2 "$(p_swrite "k = $ANTHROPIC")" "Anthropic"
check "block openai key"    secrets-scan.sh 2 "$(p_swrite "k = $OPENAI")" "sk-"
check "block slack token"   secrets-scan.sh 2 "$(p_swrite "t = $SLACK")" "Slack"
check "block JWT"           secrets-scan.sh 2 "$(p_swrite "j = $JWT")" "JWT"
check "block private key"   secrets-scan.sh 2 "$(p_swrite "$PRIVKEY")" "private key"
check "block literal auth"  secrets-scan.sh 2 "$(p_sbash 'curl -H "Authorization: Bearer abcdef0123456789" https://x')" "Authorization"
check "block basic-auth"    secrets-scan.sh 2 "$(p_sbash 'curl -u admin:hunter2pass https://x')" "basic-auth"
check "allow env auth"      secrets-scan.sh 0 "$(p_sbash 'curl -H "Authorization: Bearer $TOKEN" https://x')"
check "allow plain content" secrets-scan.sh 0 "$(p_swrite "const x = 1; // nothing secret here")"

echo "── hook harness: $PASS passed, $FAIL failed ──"
[[ "$FAIL" == 0 ]]
