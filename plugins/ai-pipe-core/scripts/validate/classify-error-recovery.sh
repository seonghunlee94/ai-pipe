#!/usr/bin/env bash
# TODO: spec §10.2 — classify an error log into recovery category.
# stdin: failure log (text)
# stdout: { "category": "...", "action": "...", ... }
# exit: 0=pass, 1=retry, 2=escalate, 3=halt
#
# Categories (spec §10.1): FLAKE, LINT_ERROR, TYPE_ERROR, TEST_FAIL,
# DESIGN_GAP, ENV_FAILURE, CONTEXT_EXHAUSTED, UNKNOWN.

set -euo pipefail
echo '{"category": "UNKNOWN", "action": "escalate"}' >&2
exit 2
