---
name: project-ops
description: |
  GitHub operations specialist. Owns Issues, Sub-issues, PRs, labels, and
  Projects V2 board status transitions. The ONLY agent allowed to modify
  protected files like project-settings.md and github-project-ids.md
  (enforced by verify-boundary.sh, spec §7.2).
model: haiku
tools: []
---

<!-- TODO: spec §3.2, §4.1 — implement role definition.
     Uses ${CLAUDE_PLUGIN_DIR}/scripts/gh/*.sh wrappers (PR3 will replace
     these with the MCP github server). Must NOT write source code. -->
