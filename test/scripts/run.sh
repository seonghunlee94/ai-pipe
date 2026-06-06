#!/usr/bin/env bash
# Table-driven harness for plugins/ai-pipe-core/scripts/validate/*.sh
# (concordance gate §11.2 + error classifier §10.2). Mirrors test/hooks/run.sh:
# asserts exit code AND an output substring. Run via `npm run test:scripts`.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS="$REPO_ROOT/plugins/ai-pipe-core/scripts/validate"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/aipipe-scripts.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "script harness requires jq" >&2
  exit 78
fi

PASS=0
FAIL=0

# check <desc> <want_exit> <want_substr> -- <cmd...>   (stdin via $STDIN if set)
check() {
  local desc="$1" want="$2" substr="$3" got out
  shift 3
  [[ "$1" == "--" ]] && shift
  out=$({ printf '%s' "${STDIN:-}" | "$@"; } 2>&1)
  got=$?
  local ok=1
  [[ "$got" == "$want" ]] || ok=0
  if [[ -n "$substr" && "$out" != *"$substr"* ]]; then ok=0; fi
  if [[ "$ok" == 1 ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL  %-28s want %s/"%s" got %s | %s\n' "$desc" "$want" "$substr" "$got" "${out%%$'\n'*}"
  fi
}

# ---------- fixtures ----------
printf '### REQ-1: a\n### REQ-2: b\n### REQ-3: c\n' > "$TMP/spec.md"
printf 'no requirements here\n' > "$TMP/empty.md"
echo '{"meta":{"arch_coverage":{"spec_tasks_covered":["REQ-1","REQ-2"]}}}' > "$TMP/t1.json"
echo '{"meta":{"arch_coverage":{"spec_tasks_covered":["REQ-3"]}}}' > "$TMP/t2.json"
echo '{"status":"success"}' > "$TMP/nometa.json"
echo '{bad json' > "$TMP/bad.json"

# ---------- validate-impl-concordance.sh ----------
C="$SCRIPTS/validate-impl-concordance.sh"
check "concordance: full cover"   0 "all 3 REQ-N covered" -- bash "$C" "$TMP/spec.md" "$TMP/t1.json" "$TMP/t2.json"
check "concordance: missing REQ"  1 "REQ-3"               -- bash "$C" "$TMP/spec.md" "$TMP/t1.json"
check "concordance: no-meta out"  1 "DESIGN_GAP"          -- bash "$C" "$TMP/spec.md" "$TMP/nometa.json"
check "concordance: vacuous spec" 1 "vacuously"           -- bash "$C" "$TMP/empty.md" "$TMP/t1.json"
check "concordance: bad json"     2 "invalid JSON"        -- bash "$C" "$TMP/spec.md" "$TMP/bad.json"
check "concordance: usage"        2 "usage:"              -- bash "$C" "$TMP/spec.md"
check "concordance: missing spec" 2 "not found"           -- bash "$C" "$TMP/nope.md" "$TMP/t1.json"

# ---------- classify-error-recovery.sh ----------
K="$SCRIPTS/classify-error-recovery.sh"
STDIN="Error: connect ETIMEDOUT 1.2.3.4:443" \
  check "classify: FLAKE"        1 '"FLAKE"'            -- bash "$K"
STDIN="src/x.ts(3,1): error TS2322: Type 'string' is not assignable" \
  check "classify: TYPE_ERROR"   1 '"TYPE_ERROR"'       -- bash "$K"
STDIN="eslint found 3 problems (2 errors)" \
  check "classify: LINT_ERROR"   1 '"LINT_ERROR"'       -- bash "$K"
STDIN="Tests failed: 2 of 10. AssertionError: expected 1 to be 2" \
  check "classify: TEST_FAIL"    1 '"TEST_FAIL"'        -- bash "$K"
STDIN="DESIGN_GAP: REQ-4 cannot be mapped to any module" \
  check "classify: DESIGN_GAP"   2 'escalate_to_architect' -- bash "$K"
STDIN="fatal: Authentication failed for 'https://github.com/x/y'" \
  check "classify: ENV_FAILURE"  2 'escalate_to_human'  -- bash "$K"
STDIN="prompt is too long: maximum context exceeded" \
  check "classify: CONTEXT"      1 'split_task_and_retry' -- bash "$K"
STDIN="something inexplicable happened" \
  check "classify: UNKNOWN"      2 '"UNKNOWN"'          -- bash "$K"
# Root-cause ordering: explicit DESIGN_GAP marker wins over an embedded type error.
STDIN="DESIGN_GAP found while fixing error TS2322" \
  check "classify: order"        2 '"DESIGN_GAP"'       -- bash "$K"

echo "── script harness: $PASS passed, $FAIL failed ──"
[[ "$FAIL" == 0 ]]
