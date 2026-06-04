---
name: execute-plan
description: |
  task-orch를 통해 plan의 task DAG를 worktree 격리 하에 fan-out/fan-in으로 실행.
  실행 이벤트는 .artifacts/runs/{slug}-events.jsonl에 append (spec §12.1).
  Spec §4.2 패턴 B/C.
user-invocable: true
argument-hint: "<slug>"
allowed-tools:
  - Agent
  - Bash
---

# execute-plan

TODO: 구현 예정 (PR4 — native worktree 통합 시점). 핵심 동작:

- 입력: `.artifacts/plans/{slug}-plan.md`
- task DAG 추출 → 의존성 위상 정렬
- 독립 task들은 `isolation: worktree` frontmatter를 통한 병렬 fan-out (PR4)
- 의존 task는 직렬 fan-in + merge
- 이벤트 스트림: `.artifacts/runs/{slug}-events.jsonl` (spec §12.1)

> **참고:** PR1 로드맵 PR4에서 자체 DAG runtime(`workflows/execute-plan.js`)을 native `isolation: worktree`로 대체한다.
