---
name: observability
description: |
  Pipeline observability — JSONL event stream schema, token/cost tracking,
  prompt-cache breakpoint strategy, and the eval-harness seed. Auto-activates
  when editing run artifacts; model-invocable for cost/caching questions.
  Trigger keywords: "token usage", "cost", "cache_control", "prompt caching",
  "eval", "events.jsonl", "observability".
paths:
  - ".artifacts/runs/*.jsonl"
  - ".artifacts/runs/*-state.json"
disable-model-invocation: false
user-invocable: false
---

# Observability (PR6)

파이프라인 실행의 관찰성 SSOT. 이벤트 스트림, 토큰/비용, prompt caching, eval을 다룬다.

## 1. Event stream (spec §12.1)

모든 실행 이벤트는 `.artifacts/runs/{slug}-events.jsonl` 에 append 한다 (스트리밍 append-safe, jq 분석 가능, 리플레이 가능). 표준 이벤트 타입:

| type | 필드 |
|------|------|
| `phase_start` / `phase_done` | `phase`, (done) `elapsed_sec` |
| `task_start` | `task_id`, `agent` |
| `task_done` | `task_id`, `status`, `elapsed_sec`, `usage`? |
| `task_retry` | `task_id`, `attempt`, `category` |
| `escalation` | `task_id`, `to` |
| `session_stop` | `branch`, `dirty_files` (Stop 훅이 기록) |

`${CLAUDE_PLUGIN_DIR}/bin/adp-watch <slug>` 로 실시간 추적, `... <slug> --replay` 로 재생, `--cost` 로 비용 요약 (`bin/` 이 PATH 에 자동 등록되는지는 README §6 미확정 — 전체 경로로 호출).

## 2. Token / cost tracking

비용이 드는 task 는 `task_done` 이벤트에 `usage` object 를 첨부한다:

```json
{"ts":"...","type":"task_done","task_id":"T-1","status":"success",
 "usage":{"model":"claude-sonnet-4-6","input_tokens":12000,"output_tokens":3000,
          "cache_read_tokens":8000,"cache_creation_tokens":0}}
```

`adp-watch --cost` 가 모델별 단가표로 누적 비용을 계산한다. cache read 는 input 단가의 ~10%, cache write 는 ~125% 로 과금된다. **개인 스케일에서도 비용 추적은 필수** — 한도 초과로 도구를 끄게 되는 일을 막는다.

## 3. Prompt cache breakpoint 전략

12개 에이전트가 공유하는 공통 preamble (`common-agent-rules`, `boundary-enforcement` skill 본문)은 매 호출마다 동일하다. 이를 prompt 앞부분에 고정 배치하고 `cache_control: {"type": "ephemeral"}` breakpoint 로 묶으면 공통 4–8K 토큰이 매 호출 cache hit → 입력 비용 대폭 절감.

규칙:
- SSOT skill 본문을 prompt **맨 앞**에 inline (자주 바뀌는 task 입력은 그 뒤에).
- breakpoint 는 공통 영역 끝에 1개. 4개까지 가능하지만 공통/agent별/task별 3단이면 충분.
- 캐시 TTL 은 5분 — 그 안에 연속 호출되는 fan-out 그룹이 최대 수혜.

## 4. Eval harness seed

prompt 변경이 품질을 떨어뜨리지 않았는지 회귀 검사한다. 시드 위치: `${CLAUDE_PLUGIN_DIR}/shared/evals/` (스키마 `eval-case.schema.json` + 케이스 `*.eval.json`).

각 eval 케이스는 고정 입력 + 기대 메트릭:

```json
{"name":"pm-auth-spec","input":"사용자 인증 기능","metric":{
  "req_ids_min":3, "spec_path_exists":true, "downstream_notes_not_null":true}}
```

러너 `ai-pipe eval <evalsDir>` 는 케이스를 발견·구조 검증하고, `--outputs <dir>` 가 주어지면 각 케이스를 `<dir>/<name>.json`(기록된 에이전트 출력)에 대해 채점한다 (메트릭 통과 수 / 실패 시 exit 1). CLI 는 LLM 을 호출하지 않으므로 **에이전트 출력 생성은 Claude Code 단계**, eval 은 그 결과를 결정적으로 채점하는 회귀 게이트다.

## 5. Checkpoint / resume (spec §12.3)

장시간 파이프라인은 `.artifacts/runs/{slug}-state.json` 에 phase/완료 task/대기 task 를 기록해 중단 후 재시작한다. SessionStart 훅이 이 파일과 마지막 이벤트를 컨텍스트로 주입한다.
