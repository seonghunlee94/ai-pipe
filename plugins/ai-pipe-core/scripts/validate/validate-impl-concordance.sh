#!/usr/bin/env bash
# TODO: spec §11.2 — Concordance Gate.
# Compare REQ-N from spec against meta.arch_coverage.spec_tasks_covered
# aggregated from all impl-agent outputs for this run. Fail (exit 1) if any
# REQ-N is uncovered. Used by verifier.
#
# Reference implementation in spec §11.2:
#   SPEC_REQS=$(grep -oP 'REQ-\d+' "$SPEC_FILE" | sort -u)
#   COVERED_REQS=$(jq -r '.meta.arch_coverage.spec_tasks_covered[]' "$IMPL_OUTPUT" | sort -u)
#   MISSING=$(comm -23 <(echo "$SPEC_REQS") <(echo "$COVERED_REQS"))

set -euo pipefail
echo "validate-impl-concordance.sh is a stub — see spec §11.2" >&2
exit 64
