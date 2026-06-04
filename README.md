# ai-pipe

Claude Code 기반 멀티 에이전트 자동화 파이프라인. 다양한 프로젝트에 `.claude/` 트리를 설치하고, 팀 단위로 공유 가능하도록 npm 패키지로 배포한다.

> **현재 상태: 스캐폴딩(scaffolding)** — 디렉토리 구조와 핵심 파일 골격만 갖춰진 상태다. `init`, `version` 명령만 실제로 동작한다. 자세한 설계 의도와 v1.0까지의 로드맵은 [`multi-agent-pipeline-best-practices.md`](./multi-agent-pipeline-best-practices.md) 참조.

---

## 0. 사용 전 교체해야 할 placeholder

루트 곳곳에 `@your-org`(GitHub org/user)이 들어가 있다. 실제로 사용하기 전 일괄 치환한다.

```bash
grep -rl '@your-org' . --include='*.json' --include='*.md' --include='.npmrc' \
  | xargs sed -i '' 's/@your-org/YOUR_REAL_ORG/g'
```

대상 파일: `package.json`, `.npmrc`, `README.md`, `.github/workflows/publish.yml`.

---

## 1. 설치

### 1-1. GitHub PAT 설정 (한 번만)

```bash
# PAT 발급: GitHub → Settings → Developer settings → Tokens (classic)
#  필요 권한: read:packages (설치), write:packages (배포 시)

cat >> ~/.npmrc <<'EOF'
@your-org:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_xxxxxxxxxxxxxxxxxxxx
EOF
```

### 1-2. 글로벌 설치

```bash
npm install -g @your-org/ai-pipe
ai-pipe --version
```

---

## 2. 사용

### 2-1. 프로젝트에 파이프라인 설치

```bash
cd my-project
ai-pipe init .
```

생성되는 것: `.claude/` 트리 전체 + `.dev-pipe-version`. 이후 `git status`로 확인하고 커밋한다. `.artifacts/`는 자동으로 `.gitignore`에 추가된다.

### 2-2. 버전 확인

```bash
ai-pipe version
# CLI: 0.0.1 / Project: 0.0.1 / Status: in-sync
```

### 2-3. 프로젝트별 설정

설치 직후 다음 파일을 편집한다:

| 파일 | 용도 |
|------|------|
| `.claude/rules/project-settings.md` | org, repo, short, default assignee 등 (spec §8.2) |
| `.claude/config/pipeline.json` | 재시도 한도, 브랜치 패턴 등 (spec §8.1) |
| `.claude/config/pipeline.local.json` | 로컬 오버라이드 (git ignore, optional) |
| `.claude/settings.local.json` | 로컬 권한 오버라이드 (`settings.local.json.example` 참고) |

---

## 3. 구현 현황

`[working]` = 실제 동작, `[stub]` = 골격만 (TODO 주석 + spec 참조).

### CLI (`src/`)

| 파일 | 상태 | spec |
|------|------|------|
| `cli.ts`, `init.ts`, `version.ts`, `utils.ts`, `errors.ts` | `[working]` | §2, §5.3, §9.1 |
| `update.ts`, `upgrade.ts`, `diff.ts` | `[stub]` | §9.3, §9.4 |
| `preflight.ts`, `detect.ts`, `validate.ts`, `versions.ts` | `[stub]` | §3.2, §13.3 |
| `pipeline/commands.ts`, `stack/generate.js`, `conventions/migrate.ts` | `[stub]` | §8.1, v2.0 |

### Template (`template/.claude/`)

| 파일 | 상태 | spec |
|------|------|------|
| `settings.json` (verify-boundary 훅 1개 wired) | `[working]` | §7.1 |
| `config/pipeline.json` | `[working]` | §8.1 |
| `rules/project-settings.md` (placeholder 값) | `[working]` | §8.2 |
| `agents/pm.md`, `agents/backend-eng.md` | `[working]` | §6.1 |
| `agents/*.md` (10개) | `[stub]` | §4.1 |
| `commands/create-spec.md` | `[working]` | §4.2 |
| `commands/design-plan.md`, `execute-plan.md` | `[stub]` | §4.2 |
| `hooks/verify-boundary.sh` | `[working]` | §7.2 |
| `hooks/*.sh` (4개) | `[stub]` | §7.3 |
| `shared/schemas/impl-agent-input.schema.json` | `[working]` | §11.1 |
| 그 외 `shared/`, `scripts/`, `workflows/`, `bin/`, `skills/` | `[stub]` | 다양함 |

---

## 4. 스캐폴딩 이후 작업 순서 (권장)

1. **훅 4종 활성화** (spec §7.3) — `verify-git-safety.sh`, `validate-commit-msg.sh`, `ban-background.sh`, `validate-subagent-type.sh` 본문 채우고 `settings.json`에 wire.
2. **에이전트 + SSOT 정착** (spec §6) — `architect.md` 풀 작성 + `shared/agent-rules/boundary-enforcement.md` 작성, SHARED_REF 패턴 검증.
3. **`init` 대화형 프롬프트** — `project-settings.md` 의 placeholder 자동 치환.
4. **`update` 명령** (spec §9.3) — 해시 기반 SCAN/CONFIRM/APPLY + `LOCAL_FILES` 보호.
5. **End-to-end 시연** — pm → backend-eng 직렬 체인을 실제 Claude Code 세션에서 실행.

이후 DAG 병렬 실행(§4.2), worktree(§3.3), Concordance Gate(§11.2), JSONL 이벤트(§12)를 차례로 채워 v1.0 완성.

---

## 5. 개발

```bash
git clone https://github.com/your-org/ai-pipe.git
cd ai-pipe
npm install         # 외부 의존성 0 (spec §2 — 의존성 최소화 원칙)
npm run build       # tsc → dist/
node dist/cli.js init /tmp/test-target
```

배포는 git tag `v*` push로 GitHub Actions가 자동 실행한다 (`.github/workflows/publish.yml`, spec §13.2).

---

## 6. 라이선스

UNLICENSED (private). 공개 배포 시 `package.json`의 `license` 필드를 수정한다.
