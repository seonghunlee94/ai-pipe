#!/usr/bin/env bash
# validate-impl-concordance.sh — spec §11.2 Concordance Gate.
# Compare the spec's REQ-N set against meta.arch_coverage.spec_tasks_covered
# aggregated across one or more impl-agent output JSON files.
#
# Usage: validate-impl-concordance.sh <spec-file> <impl-output.json> [more.json...]
# Exit:  0 = every REQ-N covered
#        1 = uncovered REQ-N (listed on stderr) or spec has no REQ-N (a gate
#            must not pass vacuously)
#        2 = usage error / unreadable input
#       78 = jq missing
#
# Portability: uses grep -oE (BSD+GNU), not the GNU-only -oP from the spec's
# reference snippet. Used by the verifier agent.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "validate-impl-concordance: jq is required. Install with: brew install jq" >&2
  exit 78
fi

if [[ $# -lt 2 ]]; then
  echo "usage: validate-impl-concordance.sh <spec-file> <impl-output.json> [more.json...]" >&2
  exit 2
fi

SPEC_FILE="$1"
shift

# -r (exists AND readable): an unreadable spec must be a hard usage error here,
# not fall through to grep failing and being misread as "no REQ-N found".
if [[ ! -f "$SPEC_FILE" || ! -r "$SPEC_FILE" ]]; then
  echo "validate-impl-concordance: spec file not found or not readable: $SPEC_FILE" >&2
  exit 2
fi

# `grep` exits 1 on no match; tolerate that (handled below) but not real errors.
SPEC_REQS=$(grep -oE 'REQ-[0-9]+' "$SPEC_FILE" | sort -u || true)
if [[ -z "$SPEC_REQS" ]]; then
  echo "validate-impl-concordance: no REQ-N found in $SPEC_FILE — a gate must not pass vacuously" >&2
  exit 1
fi

COVERED_REQS=""
for OUT in "$@"; do
  if [[ ! -f "$OUT" ]]; then
    echo "validate-impl-concordance: impl output not found: $OUT" >&2
    exit 2
  fi
  # `?` tolerates outputs without the meta path (contributes nothing);
  # a malformed JSON file is a hard usage error.
  if ! PART=$(jq -r '.meta.arch_coverage.spec_tasks_covered[]?' "$OUT" 2>/dev/null); then
    echo "validate-impl-concordance: invalid JSON in $OUT" >&2
    exit 2
  fi
  COVERED_REQS="${COVERED_REQS}${PART}"$'\n'
done
COVERED_REQS=$(printf '%s' "$COVERED_REQS" | grep -oE 'REQ-[0-9]+' | sort -u || true)

MISSING=$(comm -23 <(printf '%s\n' "$SPEC_REQS") <(printf '%s\n' "$COVERED_REQS"))
# Coverage claims for REQ-N that do not exist in the spec are likely hallucinated
# coverage — warn (do not fail; the gate's job is uncovered REQs, not extras).
EXTRA=$(comm -13 <(printf '%s\n' "$SPEC_REQS") <(printf '%s\n' "$COVERED_REQS"))
if [[ -n "$EXTRA" ]]; then
  echo "warning: covered REQ-N not present in the spec (hallucinated coverage?):" >&2
  printf '%s\n' "$EXTRA" >&2
fi

if [[ -n "$MISSING" ]]; then
  echo "DESIGN_GAP: the following requirements are not covered by any impl output:" >&2
  printf '%s\n' "$MISSING" >&2
  exit 1
fi

TOTAL=$(printf '%s\n' "$SPEC_REQS" | grep -c .)
echo "concordance: all ${TOTAL} REQ-N covered"
exit 0
