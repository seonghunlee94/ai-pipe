---
name: design-plan
description: |
  architect 에이전트를 호출해 spec을 실행 계획으로 변환한다.
  .artifacts/specs/{slug}-spec.md → .artifacts/plans/{slug}-plan.md.
  Spec §4.2 패턴 A 2단계.
user-invocable: true
argument-hint: "<slug>"
allowed-tools:
  - Agent
---

# design-plan

TODO: 구현 예정 (PR3+). architect 에이전트를 호출하여 spec을 plan으로 변환:

- 입력: `.artifacts/specs/{slug}-spec.md`
- 출력: `.artifacts/plans/{slug}-plan.md`
- plan은 REQ-N → task_id 매핑과 task DAG를 포함해야 한다 (spec §4.4)
