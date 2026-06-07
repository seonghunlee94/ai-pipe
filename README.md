# ai-pipe

Claude Code 기반 멀티 에이전트 자동화 파이프라인. **Claude Code Plugin Marketplace**로 배포하여 다양한 프로젝트·머신에서 공유 가능하고, 프로젝트별 설정과 GitHub Issues/Projects V2 연동을 지원한다.

> **현재 상태: DEV1–7 아크 완료 (퍼블리시 준비 단계)**. 12개 에이전트 전부 정의, spec→plan→execute 파이프라인 척추 연결, PreToolUse 6종 + SessionStart/Stop 훅, CLI 12개 명령(init/version/validate/eval + 라이프사이클 8종), Concordance Gate·오류 분류기, 5-레이어 테스트 스위트(lint/typecheck/vitest/훅·스크립트 하네스) + CI. 남은 것: §0 퍼블리시 체크리스트(라이선스 선택·§6 실증 라운드는 사용자 소유). 자세한 설계는 [`multi-agent-pipeline-best-practices.md`](./multi-agent-pipeline-best-practices.md).

---

## 0. 사용 전 교체해야 할 placeholder

루트 곳곳에 `@your-org` / `your-org`(GitHub org/user)이 들어가 있다.

macOS (BSD sed):

```bash
grep -rl 'your-org' . --include='*.json' --include='*.md' --include='*.ts' --include='.npmrc' \
  | xargs sed -i '' 's/your-org/YOUR_REAL_ORG/g'
```

Linux / WSL (GNU sed):

```bash
grep -rl 'your-org' . --include='*.json' --include='*.md' --include='*.ts' --include='.npmrc' \
  | xargs sed -i 's/your-org/YOUR_REAL_ORG/g'
```

대상 파일: `package.json`, `package-lock.json`, `.npmrc`, `README.md`, `.claude-plugin/marketplace.json`, `plugins/ai-pipe-core/plugin.json`, `plugins/ai-pipe-core/shared/schemas/*.json` ($id), `plugins/ai-pipe-core/shared/evals/*.schema.json` ($id), `src/init.ts` (안내 출력), `src/versions.ts` (주석 + 안내 출력), `src/validate.ts` (주석만 — 탐지기는 아래 주의 참조). 치환 후 `npm run build`로 dist 재생성 필요. (`.github/workflows/publish.yml`은 org 무관 — GITHUB_TOKEN 기반.)

> **주의**: `src/validate.ts` 의 placeholder **탐지기**와 `src/validate.test.ts` 의 픽스처는 리터럴을 분리(`"your-" + "org/"`)해 두어 이 스윕이 건드리지 못한다 — 탐지기가 함께 치환되면 사용자의 실제 org 가 영구 오탐이 되고 아래 체크리스트 2단계가 통과 불가능해진다. 단일 리터럴로 합치지 말 것.

### 퍼블리시 체크리스트 (공개/배포 시점에 순서대로)

1. **라이선스 결정** — 현재 `UNLICENSED`(private, 의도된 상태). 공개 전 라이선스(MIT/Apache-2.0 등)를 **사용자가 직접 선택**해 `LICENSE` 파일 추가 + `package.json` `license` 갱신 (§7).
2. **placeholder 치환** — 위 sed 스윕 실행 → `npm run build`(dist 재생성) → `node dist/cli.js validate . --strict` 로 잔여 `your-org/` 경고 0 확인.
3. **§6 실증 라운드** — `/plugin marketplace add` + `/plugin install` 1회 실행으로 미확정 10건(특히 plugin.json 스키마·PreToolUse matcher 이름)을 확정. 결과에 따라 §3 매트릭스 수정.
4. **버전·태그** — `package.json`/`plugin.json`/`marketplace.json` 버전 정렬 후 `git tag v<X.Y.Z>` push → publish workflow 가 `npm test` 게이트 통과 시 GitHub Packages 로 배포.

---

## 1. 아키텍처

ai-pipe는 **두 채널**로 사용자 프로젝트에 도착한다:

```
┌────────────────────────────────────────────────────────┐
│   Channel A: Claude Code Plugin Marketplace (주력)      │
│   /plugin marketplace add github:your-org/ai-pipe      │
│   /plugin install ai-pipe-core@ai-pipe                 │
│   → 에이전트/훅/명령/스크립트를 plugin cache로 자동 배포  │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│   Channel B: npm CLI `ai-pipe init` (보조)              │
│   사용자가 직접 편집할 파일만 프로젝트 .claude/에 떨어뜨림 │
│   • rules/project-settings.md   (org/repo placeholder) │
│   • config/pipeline.json        (재시도 한도)            │
│   • settings.local.json.example                         │
│   + .gitignore에 .artifacts/ 등 자동 추가                │
└────────────────────────────────────────────────────────┘
```

**왜 두 채널?**

- Channel A(plugin)는 모든 에이전트·훅·스크립트를 가져오고, 자동 업데이트(`/plugin marketplace update`)·캐시·버전 핀고정이 plugin marketplace 인프라로 무료로 해결된다.
- Channel B(npm CLI)는 사용자가 직접 손대야 할 4개 파일과 `.gitignore` 패치만 처리한다. plugin이 사용자 프로젝트 디렉토리 안에 파일을 떨어뜨리지 않기 때문에 필요.

장기적으로 Channel B의 4개 파일도 plugin이 `/ai-pipe-init` 같은 slash command로 떨어뜨릴 수 있게 되면 Channel B는 제거된다 (로드맵 PR 5+).

---

## 2. 설치

### 2-1. Plugin 설치 (필수 — Claude Code 내부에서)

```
/plugin marketplace add github:your-org/ai-pipe
/plugin install ai-pipe-core@ai-pipe
```

이 시점에서 에이전트(pm, backend-eng, project-ops, …), 훅(PreToolUse 차단 6종 + SessionStart/Stop lifecycle 2종), skill·명령(`/create-spec` 등)이 활성화된다.

### 2-2. 프로젝트 부트스트랩 (선택 — 새 프로젝트마다 한 번)

```bash
# npm CLI를 글로벌 설치
npm install -g @your-org/ai-pipe

# 프로젝트 디렉토리에서
cd my-project
ai-pipe init .
```

생성되는 것: `.claude/{rules,config,settings.local.json.example,.dev-pipe-version}` + `.gitignore` 패치.

### 2-3. 프로젝트별 설정 편집

```bash
$EDITOR .claude/rules/project-settings.md   # org, repo, short, default assignee
$EDITOR .claude/config/pipeline.json        # 재시도 한도, 브랜치 패턴 (필요 시)
gh auth login                                # project-ops 의 gh CLI 인증 (Projects V2 mutation 에 필수)
```

**GitHub MCP 서버 인증 (project-ops 의 1순위 경로):** remote GitHub MCP 서버(`https://api.githubcopilot.com/mcp/`)는 자체 OAuth 인증이 필요하다. plugin 의 `mcpServers` 선언이 동작하지 않는 환경에서는 수동 연결:

```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/
# 이후 Claude Code 가 OAuth 흐름 안내. PAT 방식이 필요하면 GitHub 공식 MCP 문서 참조.
```

MCP 연결이 없어도 project-ops 는 gh CLI 로 동작한다 (기능 동일, 도구 호출 방식만 다름). 단, **`gh auth login` 은 MCP 연결 여부와 무관하게 필수** — Projects V2 field mutation 은 현재 MCP 서버가 다루지 못해 `gh api graphql` 로 수행된다 (MCP toolset 확장 시 재평가).

---

## 3. 구현 현황

### Plugin (`plugins/ai-pipe-core/`)

| 영역 | 상태 | spec |
|------|------|------|
| `settings.json` (PreToolUse 6종 + SessionStart + Stop wired, `${CLAUDE_PLUGIN_DIR}` substitution) | working | §7.1 |
| `hooks/verify-boundary.sh` (suffix-match, empty agent_type 통과, exit 2) | working | §7.2 |
| `hooks/verify-git-safety.sh` (force-push/reset --hard/branch -D/clean -f/restore ./amend/--no-verify) | working | §7.3 |
| `hooks/validate-commit-msg.sh` (Conventional Commits + HEREDOC 인식) | working | §7.3 |
| `hooks/ban-background.sh` (npm/yarn/pnpm/tsc/vitest/jest/pytest/cargo/go/make/gradle/mvn/bazel) | working | §7.3 |
| `hooks/validate-subagent-type.sh` (`CLAUDE_PROJECT_DIR` 우선, 워크트리 안전) | working | §7.3 |
| `hooks/secrets-scan.sh` (PAT/AWS/API key/JWT/Authorization 헤더(도구 무관)/curl·wget basic-auth 차단 — Edit\|Write+Bash) | working | PR5 |
| `hooks/session-start.sh` (세션 시작 컨텍스트 주입 — 버전/브랜치/worktree/마지막 이벤트) | working* | PR5, §6 item 8 |
| `hooks/stop-checkpoint.sh` (세션 종료 시 JSONL checkpoint append) | working* | PR5, §12.1 |
| `agents/{pm,backend-eng,project-ops,architect,frontend-eng,infra-eng,qa,reviewer,verifier,test-unit,test-e2e-api,test-e2e-ui}.md` (12종 전부 정의됨) | working | §4.1, §6.1, §3.2 |
| `skills/create-spec/SKILL.md` (`user-invocable: true` → `/create-spec`) | working | §4.2 |
| `skills/design-plan/SKILL.md` (`/design-plan <slug>` → architect 호출, spec→plan) | working | §4.2 |
| `skills/verify/SKILL.md` (`/verify <slug>` → qa→test-*→reviewer→verifier 오케스트레이션, ship/no-ship) | working | §4.2, §4.4, §11.2 |
| `shared/formats/plan-format.md` (plan 정규 구조 SSOT — architect 생성, execute-plan 소비) | working | §4.4 |
| `skills/execute-plan/SKILL.md` (native fan-out/직렬 merge 절차 — isolation 필드 미실증) | working* | §4.2 |
| `skills/common-agent-rules/SKILL.md` (paths 자동 활성화) | working | §6.1 |
| `skills/boundary-enforcement/SKILL.md` (paths 자동 활성화) | working | §6.1, §7.2 |
| `skills/{pm-rules,backend-conventions}/SKILL.md` (paths 비활성 — 본문 채워질 때 활성화) | stub | §5.1, §6.1 |
| `shared/schemas/impl-agent-input.schema.json`, `impl-agent-output.schema.json` | working | §11.1 |
| `scripts/validate/validate-impl-concordance.sh` (Concordance Gate — spec REQ-N vs impl `spec_tasks_covered`, 누락 시 exit 1) | working | §11.2 |
| `scripts/validate/classify-error-recovery.sh` (실패 로그 → §8 분류 7종+UNKNOWN, retry=1/escalate=2) | working | §10.2 |
| GitHub 작업 — `gh` CLI 경로 working / MCP 경로 미실증 (§6 item 6, `scripts/gh/` 는 PR3에서 폐기) | working* | §3.2 |
| `bin/adp-watch` (이벤트 뷰어 `--replay`/`--cost`, 토큰/비용 집계) | working | §12.2 |
| `skills/observability/SKILL.md` (paths 자동 활성화), `shared/evals/` (스키마 + 시드 1) | working | §12.1–12.3 |
| Worktree 격리 — impl 에이전트 `isolation: worktree` frontmatter (native, §6 item 7 미실증, 자체 DAG runtime 은 PR4에서 폐기) | working* | §3.3 |

### CLI (`src/`)

| 명령 | 상태 |
|------|------|
| `init` (LOCAL_FILES 보호, `.gitignore` 자동 패치, plugin marketplace 안내, 설치 후 sanity validate) | working |
| `version` (CLI vs project sync 상태) | working |
| `validate [<dir>] [--strict] [--quiet]` (JSON 파싱 / hook `bash -n` / agent·skill frontmatter[구조 검사 — name·description 존재] / placeholder / your-org) | working |
| `eval <evalsDir> [--outputs <dir>] [--verbose]` (`*.eval.json` 케이스 검증 + 기록된 출력을 메트릭으로 채점 — 결정적 회귀 게이트) | working |
| `preflight` (node/npm/git/gh/jq/bash 존재 검사 — required 누락 시 exit 1) | working |
| `diff [<dir>] [--all]` / `update [<dir>] [--force]` (template vs 설치 SCAN — new/changed/orphaned/same/local; update 는 dry-run 기본, --force 적용, LOCAL 보존, orphan 미삭제) | working |
| `pipeline <show\|get\|set> [<key> <value>] [<dir>]` (base+local 병합 dot-path 읽기/쓰기 — set 은 pipeline.local.json) | working |
| `versions` (registry 조회 — 미발행/오프라인 시 로컬 버전 fallback) | working |
| `upgrade [--version X] [<dir>]` (글로벌 패키지 재설치 후 update 안내) | working |
| `detect [<dir>]` (gh 로 Projects V2 보드 탐지 → `shared/github-project-ids.md`; gh/org 전제조건 검사) | working* |
| `migrate [<dir>]` (convention 마이그레이션 — v2.0 레지스트리, 현재 no-op) | working |

### 테스트 (DEV2)

`npm test` = `lint`(Biome — formatter 비활성, lint 전용, `--error-on-warnings`) + `typecheck`(tsc src+tests; `tsconfig.test.json` 이 base 의 `**/*.test.ts` 제외를 재정의해 테스트도 검사) + `vitest run`(utils/version/validate/init/eval/lifecycle 단위 테스트) + 훅 하네스(`test/hooks/run.sh` — PreToolUse 6종의 block/allow 를 exit code + stderr 사유까지 검증) + 스크립트 하네스(`test/scripts/run.sh` — concordance gate §11.2 + error classifier §10.2 + §8 taxonomy sync). 정확한 케이스 수는 러너 출력이 SSOT (하드코딩 드리프트 방지). CI(`.github/workflows/ci.yml`)가 push/PR 마다 build+test 를 돌리고, publish workflow 도 `npm test` 게이트를 통과해야 배포한다.

PreToolUse 차단 훅 6종(verify-boundary, verify-git-safety, validate-commit-msg, ban-background, validate-subagent-type, secrets-scan)은 Claude Code 규약(2 = block)을 따르고, lifecycle 훅 2종(session-start, stop-checkpoint)은 best-effort 로 항상 exit 0 (세션을 막지 않음). 하네스는 각 차단 훅의 block/allow 케이스를 jq 페이로드로 검증한다.

테스트 백로그(향후): vitest coverage threshold, CI Node 매트릭스(20/22), validate EACCES/symlink 가드 테스트. (DEV-NICE 판단에서 SKIP — linter 는 Biome 게이트로 출하됨)

### 파이프라인 실행 (end-to-end)

플러그인 설치 후, Claude Code 안에서 슬래시 명령 체인으로 한 기능을 spec→plan→구현까지 흘린다:

```
/create-spec 사용자 인증 기능을 만들어줘   # PM → .artifacts/specs/{slug}-spec.md, slug 보고
/design-plan {slug}                        # architect → .artifacts/plans/{slug}-plan.md (task DAG)
/execute-plan {slug}                       # feat/{slug} 멱등 생성 → impl 에이전트 fan-out → 직렬 merge
/verify {slug}                             # qa→test-*→reviewer→verifier → ship / no-ship 결정
```

- 산출물은 `.artifacts/`(specs/plans/runs) 아래에 떨어진다. 실행 이벤트는 `.artifacts/runs/{slug}-events.jsonl`, 진행/비용은 `${CLAUDE_PLUGIN_DIR}/bin/adp-watch {slug}`.
- 로컬 단독(GitHub 미연동) 실행은 `config/pipeline.json` 의 `local_defaults`(story/issue=1)로 impl-agent-input 을 채운다. GitHub Issues/Projects 연동은 project-ops 에이전트가 담당.
- impl 에이전트 3종(backend/frontend/infra-eng)이 모두 정의됨 — plan 의 task 가 어느 레이어든 execute-plan 이 fan-out 한다. 검증 단계는 `/verify {slug}` 가 qa→test-*(직렬)→reviewer→verifier 를 오케스트레이션해 ship/no-ship 을 보고한다 (Concordance Gate 입력은 execute-plan 이 영속화한 `.artifacts/runs/{slug}-impl-outputs/*.json`).

---

## 4. 로드맵

| PR | 범위 |
|----|------|
| PR1 | Plugin marketplace 구조 재편, 훅 P0/P1 버그 fix, exit code 1→2, dangling SHARED_REF 정리, README 재작성 (8 review rounds, 33 findings) |
| PR2 | `shared/agent-rules/`, `commands/` → `skills/{name}/SKILL.md` 마이그레이션, `paths` frontmatter 자동 활성화, agent의 SHARED_REF 블록 제거 (9 review rounds, 22 findings) |
| PR3 | MCP github 서버 통합 → `scripts/gh/*.sh` 폐기, `project-ops` 풀 에이전트 재정의 (4 review rounds, 13 findings) |
| PR4 | Native `isolation: worktree` (impl 3종) → 자체 DAG runtime 폐기, execute-plan 재작성 (3 review rounds, 12 findings) |
| PR5 | Hooks v2: `secrets-scan.sh` (credential 패턴 + 도구 무관 Authorization 헤더 + curl/wget basic-auth 차단), `session-start.sh` (컨텍스트 주입), `stop-checkpoint.sh` (JSONL checkpoint) (5 review rounds, 8 findings) |
| PR6 | Observability: `adp-watch` 실구현 (이벤트 뷰어 + 토큰/비용 집계), `observability` skill (이벤트 스키마 / cache_control breakpoint 전략 / checkpoint), `shared/evals/` eval harness 시드 (스키마 + 1 케이스) (2 review rounds, 10 findings) |
| DEV1–7 | 퍼블리시 준비 아크: `validate`/`eval` + 라이프사이클 CLI 8종 실구현, 테스트 스위트(vitest + 훅/스크립트 하네스 + CI), architect·design-plan 으로 파이프라인 척추 연결, 스텁 에이전트 8종 완성, Concordance Gate·오류 분류기, 퍼블리시 체크리스트 (각 단계 2-에이전트 리뷰 2회 연속 clean 까지 반복) |

근거: 2026년 6월 기준 Claude Code는 Skills/Subagents/Plugin Marketplace/native worktree isolation을 표준으로 제공한다. 스펙(2025 amf 기반)이 자체 구현하던 대부분이 네이티브로 대체된다. 자세한 분석은 PR1 커밋 메시지 / 본 리포 git log 참조.

---

## 5. 개발

```bash
git clone https://github.com/your-org/ai-pipe.git
cd ai-pipe
npm install         # TypeScript devDep 2개만 (런타임 의존성 0)
npm run build       # tsc → dist/
node dist/cli.js init /tmp/test-target   # 부트스트랩 동작 확인
```

배포: git tag `v*` push로 GitHub Actions가 `.github/workflows/publish.yml`을 실행 (npm CLI를 GitHub Packages에 publish). Plugin marketplace는 `main` 브랜치 그 자체가 카탈로그이므로 별도 publish 단계가 없다 — `/plugin marketplace update`가 `git pull` 효과를 낸다.

### 시스템 요구사항

- Node.js 20+
- bash, git
- `jq` — 모든 훅이 stdin JSON 파싱에 사용 (`brew install jq` / `apt install jq`)
- `gh` — project-ops 에이전트가 GitHub 조작에 사용 (`gh auth login`)

Windows는 현재 미지원 (Bash 훅 의존). WSL 사용 권장.

---

## 6. 알려진 미확정 (Plugin Marketplace 실증 필요)

PR1~PR2는 Claude Code Plugin Marketplace / Skills 공식 스키마를 직접 검증하지 못한 채 작성됐다. 다음 항목은 실제 `/plugin marketplace add github:your-org/ai-pipe` + `/plugin install ai-pipe-core@ai-pipe` 시점에 검증/조정 예정:

- `plugins/ai-pipe-core/plugin.json`의 필드명 (`components`, `settings`, `requirements`, ...) — 공식 manifest 스키마와 일치 보장 불가
- `.claude-plugin/marketplace.json`의 `source: "./plugins/ai-pipe-core"` — marketplace 위치 기준인지 repo root 기준인지 미확정
- `plugins/ai-pipe-core/settings.json` 내부의 `${CLAUDE_PLUGIN_DIR}` substitution 범위 — hook command 외 필드에서도 동작하는지 미확정
- `settings.json` 내 PreToolUse matcher `"Agent"` — 실제 Claude Code의 subagent tool 이름이 `Agent` / `Task` / `TaskCreate` 중 어느 것인지 한 번 캡처 후 확정 필요
- SKILL.md frontmatter 필드 (`paths`, `disable-model-invocation`, `user-invocable`, `allowed-tools`) — 공식 스키마 대조 미완. paths의 read/edit 트리거 시맨틱도 실증 필요
- `plugin.json`의 `mcpServers` 필드 (PR3) — plugin manifest가 MCP 서버 선언을 지원하는지, 필드명/형식(`type: http` + `url`)이 맞는지 실증 필요. 미지원이면 사용자가 `claude mcp add` 로 수동 연결
- agent frontmatter 의 `isolation: worktree` 필드 (PR4) — 필드명/값과 "변경 없으면 자동 정리" 시맨틱 실증 필요. 미지원이면 backend-eng 절차에 수동 `git worktree add` 복원
- `SessionStart`/`Stop` 훅 이벤트명·페이로드 (PR5) — settings.json 의 이벤트 키 이름과 SessionStart stdout 컨텍스트 주입 시맨틱 실증 필요
- `bin/adp-watch` PATH 등록 (PR6) — `plugin.json` 은 `agents/hooks/skills` 만 컴포넌트로 선언한다. plugin 이 `bin/` 을 자동으로 PATH 에 올리는지 미확정 — 안 올리면 `${CLAUDE_PLUGIN_DIR}/bin/adp-watch` 전체 경로로 호출(현재 SKILL 안내 방식)
- observability 의 `usage` 페이로드·cache_control 전략·단가표 (PR6) — subagent 호출 시 토큰 usage(특히 `cache_read_tokens`/`cache_creation_tokens`)를 이벤트로 회수할 수 있는지, skill 본문에 `cache_control` breakpoint 를 적용할 수단이 있는지 실증 필요. `adp-watch` 의 모델별 단가표(Opus $15/$75, Sonnet $3/$15, Haiku $1/$5)는 2026-06 추정치이며 docs.anthropic.com 으로 확정 필요. 불가 시 `adp-watch --cost` 는 usage 미첨부 이벤트에 대해 0 으로 누적(현재 동작)

별도 실증 라운드에서 위 10건을 정리한다.

---

## 7. 라이선스

UNLICENSED (private). 공개 배포 시 `package.json`의 `license` 필드와 `LICENSE` 파일 추가 필요.
