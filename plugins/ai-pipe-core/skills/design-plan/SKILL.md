---
name: design-plan
description: |
  architect 에이전트를 호출해 spec을 실행 계획으로 변환한다.
  .artifacts/specs/{slug}-spec.md → .artifacts/plans/{slug}-plan.md.
  Slash command form: /design-plan <slug>. Spec §4.2 패턴 A 2단계.
user-invocable: true
argument-hint: "<slug>"
allowed-tools:
  - Agent
---

# design-plan

당신의 임무는 `architect` 에이전트를 호출해 PM 의 spec 을 실행 가능한 plan(task DAG)으로 변환하는 것입니다. spec→plan→execute 파이프라인의 가운데 단계입니다.

## 절차

1. `$ARGUMENTS` 에서 `slug` 를 받는다 (예: `user-authentication`). 비어 있으면 사용자에게 slug 를 묻는다.
2. `architect` 에이전트를 호출한다 (`Agent` tool, `subagent_type: architect`). 프롬프트에 slug 를 전달하고, spec 경로가 `.artifacts/specs/{slug}-spec.md` 임을 명시한다.
3. architect 의 출력 JSON 을 파싱한다:
   - `status` 가 `failure` 면 (대개 `DESIGN_GAP` — `uncovered_reqs` 누락, 또는 `ENV_FAILURE` — spec 없음) 그 사유를 사용자에게 그대로 보고하고 **중단**한다. plan 을 임의로 만들지 않는다.
   - `status` 가 `success` 면 `plan_path`, `tasks`, `coverage_complete` 를 추출.
4. 사용자에게 다음을 보고:
   - 생성된 plan 파일 경로 (`plan_path`)
   - task 개수와 DAG 요약 (각 task 의 `task_id` / `agent` / `depends_on` / `covers`)
   - 커버리지 상태 (`coverage_complete`)
   - 다음 단계 안내: `/execute-plan <slug>`

## 금지 사항

- 직접 plan 파일을 작성하지 말 것 (architect 에이전트가 전담). 이 skill 은 오케스트레이션만.
- plan 디렉토리(`.artifacts/plans/`) 외 파일을 수정하지 말 것.
- architect 가 `failure`/`DESIGN_GAP` 를 반환했는데도 다음 단계로 진행하지 말 것 — 불완전한 plan 으로 execute 하면 REQ 누락이 구현까지 전파된다.

> plan 의 정규 구조는 `shared/formats/plan-format.md`(SSOT)를, architect 의 역할·출력 계약은 `agents/architect.md` 를 따른다.
