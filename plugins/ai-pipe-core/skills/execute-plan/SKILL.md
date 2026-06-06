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

1. **Plan 파싱**: `.artifacts/plans/{slug}-plan.md` 에서 plan 헤더의 `feature_branch` 와 `## Tasks` 표를 읽는다 — 표 구조는 `${CLAUDE_PLUGIN_DIR}/shared/formats/plan-format.md`(SSOT)를 따른다. 각 task 는 `task_id`, `agent`(backend-eng/frontend-eng/infra-eng), `task_branch`, `depends_on`, `covers` 를 가진다.
   - **stub 에이전트 경고**: 배정된 `agent` 의 정의 파일(`${CLAUDE_PLUGIN_DIR}/agents/{agent}.md`)이 stub(빈 `tools: []` 또는 TODO 본문)이면 그 task 로 fan-out 하지 말고 사용자에게 "해당 에이전트 미구현"을 보고하고 멈춘다 (어떤 에이전트가 stub 인지는 정의 파일을 직접 검사해 판단 — 하드코딩 금지). 빈 에이전트에 보내면 무의미한 실패→retry 루프만 생긴다.
   - **런타임 바인딩**: `story_number`/`issue_number`/`short_name`/`downstream_notes` 는 plan 에 없으므로 실행 시점에 바인딩해 impl-agent-input 스키마를 완성한다.
     - `story_number`/`issue_number`/`short_name`: GitHub Phase 가 활성이면 그 issue/story 번호를, 로컬 단독 실행이면 `config/pipeline.json` 의 `local_defaults`(기본 `story_number=1`, `issue_number=1`, `short_name="local"`)를 사용.
     - `downstream_notes` (필수, object, null 금지 — §4.3 task 간 데이터 전달): root task(`depends_on: -`)는 빈 `{}`, 의존 task 는 완료된 dependency 들의 output `downstream_notes` 를 모아 전달한다.
2. **Base 브랜치 보장 (멱등 생성)**: fan-out 전에 메인 세션이 `feature_branch` 를 checkout 한 상태로 만든다 — native worktree 는 현재 HEAD 에서 분기하므로 base 가 어긋나면 모든 task 가 어긋난다 (task 브랜치는 `feature_branch` 를 base 로 분기). **이 브랜치를 만드는 단계는 아무도 없으므로 여기서 멱등 생성**하되, **항상 `config/pipeline.json` 의 `vcs.default_branch`(기본 main)에서 분기**해 base 를 고정한다:
   1. working tree 가 clean 한지 확인 (`git status --porcelain` 비어 있어야 함) — dirty 면 멈추고 사용자에게 commit/stash 를 요청 (uncommitted 변경이 새 브랜치에 섞이는 것 방지).
   2. `git rev-parse --verify --quiet refs/heads/${feature_branch}` 로 존재 확인 → 없으면 `git checkout ${default_branch} && git checkout -b ${feature_branch}` (canonical base 에서 분기), 있으면 `git checkout ${feature_branch}`.
3. **위상 정렬**: 의존성이 없는 task 들을 같은 그룹으로 묶는다 (spec §4.2 패턴 B).
4. **Fan-out**: 같은 그룹의 task 들을 `Agent` tool 로 병렬 호출. impl 에이전트들은 frontmatter 의 `isolation: worktree` 에 의해 하네스가 자동으로 격리된 worktree 에서 실행한다 — worktree **생성**은 항상 하네스 몫이고 이 skill 은 생성하지 않는다 (잔존물 **정리**는 step 6/8 에서 오케스트레이터가 수행).
5. **Fan-in (직렬 merge)**: 그룹의 모든 task 가 끝나면 각 task 브랜치를 feature 브랜치에 **직렬로** merge 한다 (동시 merge 금지 — race condition 방지, spec §3.3).
6. **Merge 후 정리** (순서 중요 — git 은 worktree 에 checkout 된 브랜치 삭제를 거부한다):
   1. 변경 있던 task worktree 잔존물을 먼저 정리: `git worktree remove <path>` (변경 없는 worktree 는 하네스가 이미 자동 정리)
   2. 그 다음 merge 된 task 브랜치 삭제: `git branch -d` (안전 삭제 — `-D` 는 hook 이 차단)
7. **이벤트 기록**: 각 단계를 `.artifacts/runs/{slug}-events.jsonl` 에 append (`task_start`/`task_done`/`task_retry`/`escalation`, spec §12.1). 첫 append 전에 `mkdir -p .artifacts/runs` (디렉토리 없으면 `>>` 가 실패 — pm 의 specs/, architect 의 plans/ 와 동일 패턴).
8. **실패 처리**: task 실패 시 실패 로그를 `${CLAUDE_PLUGIN_DIR}/scripts/validate/classify-error-recovery.sh` 의 stdin 으로 넘겨 분류한다 — stdout 의 `{category, action}` 과 exit 코드(1 = 재시도, 2 = escalate; 항상 비-0 이므로 `|| rc=$?` 로 받기)를 따르고, **그 외 rc(126/127 등 스크립트 자체 실행 실패)는 `ENV_FAILURE` 로 사람에게** escalate 한다. 분류 표의 SSOT 는 `common-agent-rules` skill §8. 재시도 한도는 `config/pipeline.json` 의 `limits`.
   - **재시도 전 정리 (필수)**: 실패한 attempt 의 worktree 가 task 브랜치를 checkout 한 채 잔존하면 재시도 에이전트의 `git checkout ${task_branch}` 가 거부된다 (git 은 다른 worktree 에 checkout 된 브랜치의 재checkout 을 막는다). 재호출 전에 **오케스트레이터가** `git worktree remove --force <실패 attempt 의 worktree 경로>` 로 잔존물을 정리한다 — impl 에이전트 자신은 `git worktree` 실행이 금지되어 있으므로 이 정리는 항상 오케스트레이터 책임이다. 이전 attempt 의 uncommitted 변경은 worktree 제거와 함께 사라진다 — 재시도는 마지막 commit 시점부터 다시 시작한다.

## 금지 사항

- 오케스트레이터는 직접 코드를 작성하지 않는다 (spec §4.2 — "Orchestrator는 작업하지 않는다"). 구현은 전부 impl 에이전트에 위임.
- 병렬 merge 금지 — merge 는 항상 직렬.

> **이력**: PR4 이전에는 자체 DAG runtime(`workflows/execute-plan.js`)이 이 역할을 맡을 예정이었으나, native `isolation: worktree` + `Agent` tool 병렬 호출로 대체되어 폐기됐다 (디버깅 가능성·관찰성에서 native가 우월).
