---
description: task-orch 를 통해 plan 을 병렬 실행 (spec §4.2 패턴 B/C)
argument-hint: "<slug>"
---

<!-- TODO: spec §4.2 — workflows/execute-plan.js 를 호출하여
     plan 의 task DAG 를 worktree 격리(§3.3) 하에 fan-out → fan-in 으로 실행.
     실행 이벤트는 .artifacts/runs/{slug}-events.jsonl 에 append (§12.1). -->
