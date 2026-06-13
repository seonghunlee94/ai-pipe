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
# Plugin-toolchain guard (N24/dogfood R3): subagents must never edit the
# toolchain that governs them — NO project-ops exception (toolchain ≠ project
# config); main session (empty agent_type) stays trusted.
check "block subagent toolchain edit" verify-boundary.sh 2 "$(p_boundary "$CLAUDE_PLUGIN_ROOT/hooks/verify-git-safety.sh" "backend-eng")" "plugin toolchain"
check "block project-ops toolchain"   verify-boundary.sh 2 "$(p_boundary "$CLAUDE_PLUGIN_ROOT/hooks/verify-git-safety.sh" "project-ops")" "plugin toolchain"
check "allow main toolchain edit"     verify-boundary.sh 0 "$(p_boundary "$CLAUDE_PLUGIN_ROOT/hooks/verify-git-safety.sh" "")"

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
# Git GLOBAL options before the subcommand must NOT bypass the block patterns
# (N24/dogfood R3 — normalized in one pass, not a new parser layer).
check "block -C force push"  verify-git-safety.sh 2 "$(p_cmd "git -C /tmp push --force origin main")" "force push"
check "block -c reset hard"  verify-git-safety.sh 2 "$(p_cmd "git -c user.name=x reset --hard HEAD~1")" "reset --hard"
check "allow -C status"      verify-git-safety.sh 0 "$(p_cmd "git -C /tmp status")"
# No-arg globals also shift the subcommand — must not bypass (R1 auditor B2).
check "block --no-pager push" verify-git-safety.sh 2 "$(p_cmd "git --no-pager push --force origin main")" "force push"
check "block -P reset hard"    verify-git-safety.sh 2 "$(p_cmd "git -P reset --hard HEAD")" "reset --hard"
check "block mixed globals"    verify-git-safety.sh 2 "$(p_cmd "git --no-pager -C /tmp push --force")" "force push"
# Generic normalization closes ANY global, not an enumerated list (R2 hunter:
# --namespace / -p / --exec-path slipped the no-arg-list version).
check "block --namespace push" verify-git-safety.sh 2 "$(p_cmd "git --namespace=x push --force origin main")" "force push"
check "block -p reset hard"    verify-git-safety.sh 2 "$(p_cmd "git -p reset --hard HEAD")" "reset --hard"
check "block --exec-path push" verify-git-safety.sh 2 "$(p_cmd "git --exec-path=/x push --force")" "force push"
# A global option's ARG must not be mistaken for the subcommand.
check "arg not subcommand"     verify-git-safety.sh 2 "$(p_cmd "git -c push=1 reset --hard HEAD")" "reset --hard"

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
# Documented scope limit (header "Skipped"): global options before commit are
# unparsed by this LINT hook (the SAFETY hook normalizes them) — pin the
# behavior so a future change is loud (N23/N24).
check "global-opt commit unparsed" validate-commit-msg.sh 0 "$(p_cmd 'git -C /tmp commit -m "added stuff"')"
# Dogfood regressions: a FILE-creation heredoc in a compound command must not
# be mistaken for the commit message (Case A is anchored to -m "$(cat <<TAG).
FILE_HEREDOC_GOOD=$'cat > pkg.json <<\'EOF\'\n{\n  "a": 1\n}\nEOF\ngit commit -m "chore: scaffold"'
FILE_HEREDOC_BAD=$'cat > pkg.json <<\'EOF\'\n{\n  "a": 1\n}\nEOF\ngit commit -m "added stuff"'
check "allow file-heredoc+good" validate-commit-msg.sh 0 "$(p_cmd "$FILE_HEREDOC_GOOD")"
check "block file-heredoc+bad"  validate-commit-msg.sh 2 "$(p_cmd "$FILE_HEREDOC_BAD")" "Conventional Commits"
# Bundled short flags ending in m (-qm/-sm) now parse via Cases C (quoted)
# and D (bare token).
check "allow -qm conventional"  validate-commit-msg.sh 0 "$(p_cmd 'git commit -qm "feat: bundled flag"')"
check "block -qm non-type"      validate-commit-msg.sh 2 "$(p_cmd 'git commit -qm "added a thing"')" "Conventional Commits"
check "block -qm bare token"    validate-commit-msg.sh 2 "$(p_cmd 'git commit -qm fixstuff')" "Conventional Commits"
# Heredoc BODY that merely QUOTES commit-like text (writing fixtures/docs)
# must not trigger the gate or any Case (dogfood round 2 — self-hosting).
BODY_LITERAL_NO_COMMIT=$'cat > fixture.sh <<\'EOF\'\ngit commit -m "$(cat <<TAG\nnot a real subject\nTAG\n)"\nEOF'
BODY_LITERAL_THEN_BAD=$'cat > fixture.sh <<\'EOF\'\ngit commit -m "$(cat <<TAG\nnot a real subject\nTAG\n)"\nEOF\ngit commit -m "added stuff"'
check "allow body-literal only" validate-commit-msg.sh 0 "$(p_cmd "$BODY_LITERAL_NO_COMMIT")"
check "block after body-literal" validate-commit-msg.sh 2 "$(p_cmd "$BODY_LITERAL_THEN_BAD")" "Conventional Commits"
# `<<-` heredoc legitimately tab-indents its body — leading tab must be
# stripped from the subject, not false-blocked.
HEREDOC_TABBED=$'git commit -m "$(cat <<-\'EOF\'\n\tfeat: tabbed subject\n\tEOF\n)"'
check "allow <<- tabbed subject" validate-commit-msg.sh 0 "$(p_cmd "$HEREDOC_TABBED")"
# Stripper edge regressions (round 2): a here-string is NOT a heredoc opener
# (was a false-allow: body mode swallowed the following bad commit) …
HERESTRING_BAD=$'jq . <<<foo\ngit commit -m "added stuff"'
check "block after here-string" validate-commit-msg.sh 2 "$(p_cmd "$HERESTRING_BAD")" "Conventional Commits"
# … an arithmetic literal shift is not an opener either (guard must not
# break a normal command) …
ARITH_GOOD=$'x=$((1<<8))\ngit commit -m "feat: shift ok"'
check "allow arithmetic shift"  validate-commit-msg.sh 0 "$(p_cmd "$ARITH_GOOD")"
# … CRLF closers still close (was a false-allow: body never ended) …
CRLF_BAD=$'cat > f <<EOF\r\n{\r\nEOF\r\ngit commit -m "added stuff"'
check "block CRLF heredoc+bad"  validate-commit-msg.sh 2 "$(p_cmd "$CRLF_BAD")" "Conventional Commits"
# … and a tab-indented tag line inside a PLAIN heredoc body does NOT close it
# (unconditional tab-strip re-opened the body and false-blocked).
PLAIN_TABTAG_GOOD=$'cat > f <<EOF\n\tEOF\ngit commit -m "not real, still body"\nEOF\ngit commit -m "feat: real one"'
check "allow plain tab-tag body" validate-commit-msg.sh 0 "$(p_cmd "$PLAIN_TABTAG_GOOD")"

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
# Plugin-namespaced form ({plugin}:{agent}) — how the Agent tool actually
# addresses plugin agents (dogfood finding: bare-name-only comparison blocked
# EVERY plugin agent dispatch).
check "allow namespaced agent" validate-subagent-type.sh 0 "$(p_subagent "ai-pipe-core:pm")"
check "block namespaced bogus" validate-subagent-type.sh 2 "$(p_subagent "ai-pipe-core:totally-made-up")" "not registered"
# Prefix is deliberately NOT validated (a wrong prefix fails loudly at Agent
# dispatch; this hook gates typo'd agent NAMES) — pin the looseness.
check "allow foreign prefix"   validate-subagent-type.sh 0 "$(p_subagent "some-other-plugin:pm")"

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

# --- hooks.json wiring integrity ---
# hooks.json must parse, enumerate the EXPECTED number of commands, and every
# ${CLAUDE_PLUGIN_ROOT}/hooks/*.sh it references must exist and be executable —
# catches wiring drift (renamed scripts, a DIR/ROOT-style variable regression,
# and SHAPE drift: jq output is captured with its exit code checked, and the
# count is pinned, so a structure change can never enumerate 0 and pass
# vacuously — the failure mode a `< <(jq …)` process substitution would hide).
EXPECTED_WIRED_COMMANDS=9 # 7 PreToolUse (2 Edit|Write + 4 Bash + 1 Agent) + 1 SessionStart + 1 SessionEnd
WIRING_OK=1
if ! cmds=$(jq -re '.hooks[][].hooks[].command' "$HOOKS/hooks.json" 2>&1); then
  WIRING_OK=0
  echo "FAIL  hooks.json does not parse / unexpected shape: ${cmds%%$'\n'*}"
else
  count=$(printf '%s\n' "$cmds" | grep -c .)
  if [[ "$count" -ne "$EXPECTED_WIRED_COMMANDS" ]]; then
    WIRING_OK=0
    echo "FAIL  hooks.json wiring: enumerated $count commands, expected $EXPECTED_WIRED_COMMANDS (update the constant if wiring intentionally changed)"
  fi
  while IFS= read -r cmd; do
    script="${cmd//\$\{CLAUDE_PLUGIN_ROOT\}/$CLAUDE_PLUGIN_ROOT}"
    if [[ "$script" == *'${'* ]]; then
      WIRING_OK=0
      echo "FAIL  hooks.json command uses an unknown variable: $cmd"
    elif [[ ! -f "$script" || ! -x "$script" ]]; then
      # -f guards against a directory passing the -x test (dirs are executable)
      WIRING_OK=0
      echo "FAIL  hooks.json references a missing/non-executable script: $cmd"
    fi
  done <<<"$cmds"
fi
if [[ "$WIRING_OK" == 1 ]]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi

echo "── hook harness: $PASS passed, $FAIL failed ──"
[[ "$FAIL" == 0 ]]
