---
name: boundary-enforcement
description: |
  Worktree isolation, protected files, git discipline, commit format,
  background-execution rules, subagent invocation, test policy — the full
  set of rules enforced by ai-pipe-core hooks. Auto-activates when the
  agent edits source code or tests. Impl agents (backend/frontend/infra)
  embed the core ban-list inline in their definitions; this skill provides
  the full SSOT. Trigger keywords for model invocation: "boundary",
  "worktree", "protected file", "force push", "verify-boundary".
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src/**/*.js"
  - "src/**/*.jsx"
  - "tests/**/*.ts"
  - "tests/**/*.tsx"
  - "tests/**/*.js"
  - "tests/**/*.jsx"
disable-model-invocation: false
user-invocable: false
---

# Boundary Enforcement (SSOT)

이 문서는 ai-pipe의 에이전트 경계 규칙의 단일 진실 원천(SSOT)이다. `paths` frontmatter에 의해 **소스/테스트 파일을 read/edit 할 때** 자동 활성화된다 (subagent 호출 자체로는 트리거되지 않음 — 그래서 impl 에이전트 정의 파일들은 핵심 ban-list를 인라인으로 갖고 있고, 이 문서는 그보다 깊은 룰을 보충한다).

---

## 1. Worktree Isolation (spec §3.3)

- 각 impl 에이전트는 자신에게 할당된 git worktree 안에서만 작업한다.
- 다른 task의 worktree 디렉토리 접근 금지. 공유 코드 변경이 필요하면 `downstream_notes`로 다음 task에 위임.
- worktree 경로는 `../task/{task_branch}` 패턴 (spec §3.3 참조 구현). 본인 worktree의 경로를 입력 JSON의 `task_branch`로 확인.

## 2. Protected Files (PreToolUse `verify-boundary.sh`로 강제)

다음 파일은 `project-ops` 에이전트만 수정 가능. impl 에이전트가 이 경로에 `Edit`/`Write`를 시도하면 hook이 즉시 차단(exit 2).

- `.claude/rules/project-settings.md` — 프로젝트 식별 메타데이터
- `.claude/shared/github-project-ids.md` — GitHub Projects V2 ID 캐시
- `.claude/settings.json` — Claude Code 하네스 설정
- `.claude/config/pipeline.json` — 파이프라인 limits/paths

설정 변경이 필요하면 명세 요청을 만들어 `project-ops`로 위임.

## 3. Git Operations

`verify-git-safety.sh`가 다음 명령을 차단한다 (exit 2):

| 차단 명령 | 이유 |
|-----------|------|
| `git push --force`, `-f`, `--force-with-lease` | 팀원 작업 덮어쓸 위험 + main/master 보호 |
| `git reset --hard` | uncommitted 작업 비가역 폐기 |
| `git branch -D` | 머지되지 않은 브랜치 강제 삭제 |
| `git clean -f`, `-fd`, `-fdx` | untracked 파일 비가역 제거 |
| `git checkout .`, `git restore .` | working tree 변경사항 폐기 |
| `git commit --amend` | 이전 commit 재작성 — 새 commit 만들기 |
| `--no-verify` (commit/push) | repo hook 우회 — 실패 hook을 fix하기 |

위 명령 중 진짜 필요하면 사용자에게 수동 실행을 요청한다. 에이전트가 자체 판단으로 우회 금지.

## 4. Commit Discipline

`validate-commit-msg.sh`가 다음을 강제한다:

- 형식: `<type>(<scope>)?(!)?: <subject>`
- 허용 type: `feat fix docs chore refactor test perf ci build revert style`
- subject 길이: 1–100 자 (type 접두사 제외)
- 마침표로 끝나면 안 됨
- HEREDOC 형식(`-m "$(cat <<'EOF' ... EOF)"`)도 검증됨

새 commit을 만든다. 기존 commit 수정 금지 (`--amend` 차단).

## 5. Background Execution

`ban-background.sh`가 다음의 `run_in_background: true` 사용을 차단한다:

- build: `npm run build`, `tsc`, `cargo build`, `mvn`, `gradle`, `./gradlew`, `./mvnw`, `bazel build`, `make build`
- test: `npm test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `bazel test`, `make test`
- lint/typecheck: `eslint`, `prettier`, `biome`, `mypy`, `ruff`, `tsc --noEmit`

이유: 백그라운드 실행은 결과를 동기 확인하지 못해 잘못된 통과 신호를 만든다.

dev server, watcher, `tail -f` 등은 백그라운드 허용.

## 6. Subagent Invocation

`validate-subagent-type.sh`가 `Agent` 도구 호출 시 `subagent_type`을 화이트리스트로 검증한다:

- 프로젝트 에이전트: `${CLAUDE_PROJECT_DIR}/.claude/agents/*.md` + `${CLAUDE_PLUGIN_DIR}/agents/*.md` 파일명에서 자동 추출
- 빌트인: `general-purpose`, `claude`, `Explore`, `Plan`, `claude-code-guide`, `statusline-setup`

오타나 환각된 에이전트 이름은 즉시 차단된다.

## 7. Test Files

- 테스트 삭제 금지. 실패하면 코드를 고친다.
- 명세에 명시되지 않은 기능 추가 금지 — 스코프 외 작업은 별도 task로 회부.
- 새 코드는 최소 unit test 1개를 동반 (impl-agent-output.schema.json의 `tests_added`로 보고).
