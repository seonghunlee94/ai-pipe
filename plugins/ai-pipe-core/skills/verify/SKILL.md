---
name: verify
description: |
  검증 스테이지 오케스트레이션: qa → test-*(직렬) → reviewer → verifier 를
  차례로 디스패치해 한 기능의 ship / no-ship 결정을 받아낸다.
  Slash command form: /verify <slug>. execute-plan 다음 단계 (spec §4.2/§4.4
  Phase 4). 입력은 spec/plan + execute-plan 이 영속화한 impl 출력
  (.artifacts/runs/{slug}-impl-outputs/*.json).
user-invocable: true
argument-hint: "<slug>"
allowed-tools:
  - Agent
  - Bash
  - Read
---

# verify

당신의 임무는 한 기능의 검증 스테이지를 오케스트레이션하는 것입니다. 직접 테스트/리뷰하지 않고, 각 역할 에이전트를 디스패치한 뒤 verifier 의 ship/no-ship 단일 결정을 사용자에게 보고합니다.

## 입력

- `$ARGUMENTS` 의 `slug`. 비어 있으면 사용자에게 묻는다.
- spec: `.artifacts/specs/{slug}-spec.md`, plan: `.artifacts/plans/{slug}-plan.md`.
- impl 출력: `.artifacts/runs/{slug}-impl-outputs/*.json` (execute-plan step 7 이 저장). 없으면 같은 세션의 execute-plan 결과 JSON 을 직접 사용 — 둘 다 없으면 사용자에게 `/execute-plan {slug}` 선행을 안내하고 중단.

## 절차

1. **사전 확인**: spec/plan/impl 출력이 존재하는지 확인 (없으면 위 안내 후 중단). plan 의 `## Tasks` 표에서 `covers` 와 agent 레이어를 읽는다.
2. **qa 디스패치** (`Agent`, `subagent_type: qa`): slug 와 impl 출력 요약을 전달. qa 는 REQ-N 별 수용 기준을 정의하고 필요한 test-* 레이어를 결정·**직렬** 디스패치한다 (qa 정의 참조 — test 에이전트들은 worktree 격리가 없어 병렬 금지). qa 출력의 `uncovered_reqs` 가 비어 있지 않으면 그 사실을 verifier 입력에 포함.
3. **reviewer 디스패치** (`subagent_type: reviewer`): plan 헤더의 `feature_branch` 와 비교 base(`vcs.default_branch`)를 전달. 출력 findings/verdict 수집.
4. **verifier 디스패치** (`subagent_type: verifier`): slug + impl 출력 파일 경로들 + qa/test 결과 + reviewer 출력을 전달. **impl 출력은 step 1 에서 읽은 현재 plan 의 `task_id` 에 해당하는 `{task_id}.json` 만 골라 전달**한다 — 디렉토리 glob 전체를 넘기면 개정 전 plan 의 잔존 파일(삭제·개명된 task)이 커버리지를 거짓 주장해 게이트를 오염시킨다. verifier 는 Concordance Gate(`scripts/validate/validate-impl-concordance.sh`)와 세 신호를 종합해 `{decision: ship|no-ship, blockers, concordance}` 를 반환.
5. **이벤트 기록**: `.artifacts/runs/{slug}-events.jsonl` 에 `phase_start`/`phase_done` (phase: "verify") 및 각 에이전트의 `task_start`/`task_done` 을 append (`mkdir -p .artifacts/runs` 선행, spec §12.1).
6. **보고**: decision, blockers(있으면 출처별), concordance 요약, 추가된 테스트 수를 사용자에게 보고. no-ship 이면 다음 행동(architect 회부 / impl 재작업 task)을 제안.

## 실패 처리

- 디스패치한 에이전트가 실패하면 실패 로그를 `${CLAUDE_PLUGIN_DIR}/scripts/validate/classify-error-recovery.sh` 로 분류해 따른다 (exit 1 = 재시도[`limits` 한도 내], 2 = escalate, 그 외 rc = `ENV_FAILURE`) — execute-plan step 8 과 동일 계약.

## 금지 사항

- 직접 테스트 작성/코드 수정/리뷰 금지 — 전부 역할 에이전트에 위임 (오케스트레이션만).
- verifier 가 no-ship 을 반환했는데 임의로 ship 으로 보고 금지.
- test-* 병렬 디스패치 금지 (공유 작업 트리 충돌).

> 역할별 계약(출력 JSON, escalation)은 각 에이전트 정의(`agents/{qa,reviewer,verifier,test-*}.md`)가, 분류 표는 `common-agent-rules` skill §8 이, Concordance 절차는 spec §11.2 / 게이트 스크립트가 SSOT.
