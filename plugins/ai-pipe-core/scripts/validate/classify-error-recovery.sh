#!/usr/bin/env bash
# classify-error-recovery.sh — spec §10.2: classify a failure log into a
# recovery category. The category table is the SSOT in common-agent-rules
# skill §8 (spec §10.1); keep the two in sync.
#
# stdin : failure log (text)
# stdout: {"category": "...", "action": "..."}
# exit  : 1 = retry (caller re-runs within config/pipeline.json limits)
#         2 = escalate (architect or human)
#
# Match order = most-explicit marker first, so a log that mentions several
# things (e.g. a type error inside a failing test run) lands on its root cause:
#   explicit DESIGN_GAP / CONTEXT_EXHAUSTED markers
#   → ENV_FAILURE (infra/auth)  → FLAKE (transient)
#   → TYPE_ERROR → LINT_ERROR → TEST_FAIL → UNKNOWN.

set -euo pipefail

LOG=$(cat)

emit() { # emit <category> <action> <exit-code>
  printf '{"category": "%s", "action": "%s"}\n' "$1" "$2"
  exit "$3"
}

# Explicit upstream markers (agents/gates may tag their own failures).
if grep -qE 'DESIGN_GAP' <<<"$LOG"; then
  emit DESIGN_GAP escalate_to_architect 2
fi
if grep -qiE 'CONTEXT_EXHAUSTED|context (length|window|limit)|maximum context|prompt is too long' <<<"$LOG"; then
  emit CONTEXT_EXHAUSTED split_task_and_retry 1
fi

# Infrastructure / auth failures → human.
if grep -qiE 'ENV_FAILURE|permission denied|EACCES|authentication fail|not authenticated|HTTP 40[13]|git push.*(fail|reject)|could not resolve host|ENOSPC|no space left' <<<"$LOG"; then
  emit ENV_FAILURE escalate_to_human 2
fi

# Transient flakes → short wait then retry.
if grep -qiE 'HTTP 429|rate.?limit|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|HTTP 50[23]|temporarily unavailable' <<<"$LOG"; then
  emit FLAKE retry_after_wait 1
fi

# Toolchain categories → retry with the relevant context attached.
if grep -qE 'error TS[0-9]+|TypeError|type mismatch' <<<"$LOG" || grep -qiE 'type ?error' <<<"$LOG"; then
  emit TYPE_ERROR retry_with_type_context 1
fi
if grep -qiE 'eslint|prettier|biome|stylelint|ruff|lint(ing)? (error|fail)' <<<"$LOG"; then
  emit LINT_ERROR retry_with_lint_context 1
fi
if grep -qiE 'test(s)? fail|AssertionError|assertion fail|expected .* (to|but)|✗|FAIL ' <<<"$LOG"; then
  emit TEST_FAIL retry_with_failure_log 1
fi

emit UNKNOWN escalate 2
