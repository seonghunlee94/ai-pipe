---
name: common-agent-rules
description: |
  Common rules every ai-pipe agent follows: identity, file boundaries, git
  discipline, tool usage, output contracts, test policy, cost/caching,
  escalation. Auto-activates when an agent edits a spec or plan artifact.
  Agent definition files (agents/*.md) embed the core ban-list inline; this
  skill provides the full SSOT for deeper rules. Trigger keywords for model
  invocation: "agent rules", "subagent contract", "downstream_notes",
  "escalation".
paths:
  - ".artifacts/specs/*.md"
  - ".artifacts/plans/*.md"
disable-model-invocation: false
user-invocable: false
---

# Common Agent Rules (SSOT)

이 문서는 모든 ai-pipe 에이전트가 따라야 할 공통 규칙의 단일 진실 원천(SSOT)이다. `paths` frontmatter에 의해 **spec/plan 아티팩트를 read/edit 할 때** 자동 활성화된다 (subagent 호출 자체로는 트리거되지 않음). 그래서 각 에이전트 정의 파일은 핵심 ban-list를 인라인으로 갖고, 이 문서는 그보다 깊은 룰(escalation 카테고리, 비용/캐싱 전략, output 계약 세부)을 보충한다.

---

## 1. Identity & Scope

- 자신이 어떤 에이전트인지를 응답 첫 문장에 명시하지 말 것 (불필요한 노이즈).
- 자신의 역할 경계 밖 작업은 즉시 거부하고 적절한 에이전트로 escalate.
- "오케스트레이터는 작업하지 않는다" 원칙: 다른 에이전트를 호출하는 역할이면 직접 코드/파일 수정 금지.

## 2. File System Boundaries

- 자신에게 할당된 worktree 또는 디렉토리 바깥은 접근 금지.
- 보호 파일(`verify-boundary.sh`가 차단하는 경로) 수정 금지:
  - `.claude/rules/project-settings.md`
  - `.claude/shared/github-project-ids.md`
  - `.claude/settings.json`
  - `.claude/config/pipeline.json`
- 위 파일들은 `project-ops` 에이전트만 수정 가능.

## 3. Git Discipline

- 새 커밋을 만들 것 (amend 금지).
- Conventional Commits 형식 준수: `<type>(<scope>)?: <subject>` — `validate-commit-msg.sh`가 강제.
- 위험 명령 금지: `reset --hard`, `push --force`, `branch -D`, `clean -f`, `restore .`, `--no-verify` — `verify-git-safety.sh`가 차단.
- 사용자 명시 요청 없이 push 금지.

## 4. Tool Usage

- 백그라운드 실행은 dev server / watcher / tail에만 허용. 빌드·테스트·린트는 항상 foreground — `ban-background.sh`가 차단.
- 다른 서브에이전트는 plugin 에이전트(`${CLAUDE_PLUGIN_DIR}/agents/*.md`), 프로젝트 에이전트(`.claude/agents/*.md`, 있는 경우), 또는 빌트인(`Explore`, `Plan`, `general-purpose` 등) 중에서만 호출 — `validate-subagent-type.sh`가 양쪽 디렉토리에서 화이트리스트를 구성한다.

## 5. Output Contracts

- 입출력 JSON은 반드시 `${CLAUDE_PLUGIN_DIR}/shared/schemas/impl-agent-{input,output}.schema.json` (또는 역할별 스키마)를 따른다.
- `downstream_notes`는 항상 object (빈 `{}`도 허용, `null` 금지) — spec §4.3.
- `status` 값: `"success"`, `"failure"`, `"partial"` 중 하나.

## 6. Test & Verification

- 테스트 삭제 금지. 실패하는 테스트는 코드를 고친다 — 스펙 정신(§15 안티패턴).
- 명세에 없는 기능 임의 추가 금지. 스코프 외 작업은 별도 task로 회부.
- PR 생성 전 반드시 빌드 + 타입체크 + 린트 + 유닛 테스트가 통과한 상태여야 한다.

## 7. Cost & Caching

- 가능하면 SSOT 문서를 prompt 앞부분에 위치시켜 prompt cache hit rate를 최대화한다. (PR6에서 cache_control breakpoint 자동화 예정.)
- 한 task의 컨텍스트가 비대해지면 task를 분할한다 (`CONTEXT_EXHAUSTED` — 스펙 §10.1).

## 8. Escalation

오류 분류 전체 카테고리 (spec §10.1):

| 카테고리 | 의미 | 복구 행동 |
|----------|------|----------|
| `FLAKE` | 일시적 오류 (네트워크 타임아웃, rate limit 429) | 짧게 대기 후 재시도 (한도는 `limits` 참조) |
| `LINT_ERROR` | 코드 스타일 위반 | 린트 컨텍스트 추가 후 재실행 |
| `TYPE_ERROR` | 타입 불일치 | 타입 오류 컨텍스트 추가 후 재실행 |
| `TEST_FAIL` | 테스트 실패 | 실패 로그 추가 후 재실행 |
| `DESIGN_GAP` | 명세-구현 불일치 | **architect 로 escalate** |
| `ENV_FAILURE` | 인프라 오류 (git push 실패, GitHub API/인증 오류) | **사람에게 escalate** |
| `CONTEXT_EXHAUSTED` | 컨텍스트 한도 초과 | task 분할 후 재시도 (§7 참조) |

- 임의 retry 금지. 카테고리별 재시도 한도는 `config/pipeline.json`의 `limits` 참조.
