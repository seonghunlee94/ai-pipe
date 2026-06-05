---
name: execute-plan
description: |
  plan의 task DAG를 native worktree 격리 하에 fan-out/fan-in으로 실행.
  impl 에이전트들은 isolation: worktree frontmatter로 자동 격리되고,
  merge는 직렬로 수행. 실행 이벤트는 .artifacts/runs/{slug}-events.jsonl에
  append (spec §12.1). Spec §4.2 패턴 B/C.
user-invocable: true
argument-hint: "<slug>"
allowed-tools:
  - Agent
  - Bash
  - Read
  - Write
---

# execute-plan

`.artifacts/plans/{slug}-plan.md` 의 task DAG 를 실행하는 오케스트레이션 절차.

## 절차 (Claude가 직접 수행 — 자체 DAG runtime 없음)

1. **Plan 파싱**: `.artifacts/plans/{slug}-plan.md` 에서 task 목록과 의존성을 읽는다. 각 task 는 `task_id`, `task_branch`, 담당 에이전트(backend-eng/frontend-eng/infra-eng), 의존 task 목록을 가진다.
2. **위상 정렬**: 의존성이 없는 task 들을 같은 그룹으로 묶는다 (spec §4.2 패턴 B).
3. **Fan-out**: 같은 그룹의 task 들을 `Agent` tool 로 병렬 호출. impl 에이전트들은 frontmatter 의 `isolation: worktree` 에 의해 하네스가 자동으로 격리된 worktree 에서 실행한다 — 이 skill 이 `git worktree` 명령을 직접 실행하지 않는다.
4. **Fan-in (직렬 merge)**: 그룹의 모든 task 가 끝나면 각 task 브랜치를 feature 브랜치에 **직렬로** merge 한다 (동시 merge 금지 — race condition 방지, spec §3.3).
5. **이벤트 기록**: 각 단계를 `.artifacts/runs/{slug}-events.jsonl` 에 append (`task_start`/`task_done`/`task_retry`/`escalation`, spec §12.1).
6. **실패 처리**: task 실패 시 `common-agent-rules` skill §8 의 오류 분류에 따라 재시도/escalate. 재시도 한도는 `config/pipeline.json` 의 `limits`.

## 금지 사항

- 오케스트레이터는 직접 코드를 작성하지 않는다 (spec §4.2 — "Orchestrator는 작업하지 않는다"). 구현은 전부 impl 에이전트에 위임.
- 병렬 merge 금지 — merge 는 항상 직렬.

> **이력**: PR4 이전에는 자체 DAG runtime(`workflows/execute-plan.js`)이 이 역할을 맡을 예정이었으나, native `isolation: worktree` + `Agent` tool 병렬 호출로 대체되어 폐기됐다 (디버깅 가능성·관찰성에서 native가 우월).
