# 멀티 에이전트 파이프라인 시스템 설계 Best Practices

> amf-dev-pipe (`@uj-amf-sw-dev/dev-pipe`) 코드베이스 심층 분석을 바탕으로 작성한 설계 가이드.  
> Claude Code 기반 멀티 에이전트 오케스트레이션 시스템을 처음부터 설계·구축할 때 참고할 수 있는 실전 기준.

---

## 목차

1. [시스템 구조 전체 조감](#1-시스템-구조-전체-조감)
2. [개발 언어 및 기술 스택](#2-개발-언어-및-기술-스택)
3. [인프라 설계](#3-인프라-설계)
4. [멀티 에이전트 구성 방법](#4-멀티-에이전트-구성-방법)
5. [파일 및 디렉토리 구조](#5-파일-및-디렉토리-구조)
6. [에이전트 정의 방식](#6-에이전트-정의-방식)
7. [훅 및 경계 강제(Boundary Enforcement)](#7-훅-및-경계-강제boundary-enforcement)
8. [설정 시스템 설계](#8-설정-시스템-설계)
9. [업데이트 및 버전 관리](#9-업데이트-및-버전-관리)
10. [오류 분류 및 복구 전략](#10-오류-분류-및-복구-전략)
11. [스키마 및 계약(Contract) 설계](#11-스키마-및-계약contract-설계)
12. [모니터링 및 관찰성](#12-모니터링-및-관찰성)
13. [배포 전략](#13-배포-전략)
14. [핵심 설계 결정 요약](#14-핵심-설계-결정-요약)
15. [안티패턴 및 주의사항](#15-안티패턴-및-주의사항)

---

## 1. 시스템 구조 전체 조감

### 세 가지 레이어로 분리

멀티 에이전트 파이프라인은 **관심사 분리(Separation of Concerns)** 원칙에 따라 세 레이어로 나누는 것이 핵심이다.

```
┌─────────────────────────────────────────────────────┐
│                    CLI Layer (npm)                    │
│  install / init / update / upgrade / diff / version  │
│  언어: TypeScript / Node.js                          │
└──────────────────────┬──────────────────────────────┘
                       │ deploys
┌──────────────────────▼──────────────────────────────┐
│                  Harness Layer (.claude/)             │
│  agents/ commands/ hooks/ scripts/ shared/ config/   │
│  형식: Markdown + JSON + Shell Script               │
└──────────────────────┬──────────────────────────────┘
                       │ writes to
┌──────────────────────▼──────────────────────────────┐
│                 Artifact Layer (.artifacts/)          │
│  specs/ plans/ runs/ context/ logs/                  │
│  형식: JSON + Markdown (git 추적 안 함)             │
└─────────────────────────────────────────────────────┘
```

**왜 이렇게 나누는가?**

- CLI Layer는 설치·업데이트 전용. 실행 중에는 관여하지 않는다.
- Harness Layer는 에이전트 규칙과 오케스트레이션 로직을 담는다. 팀 전체가 같은 버전을 써야 한다.
- Artifact Layer는 휘발성 산출물이다. git에 커밋하면 저장소가 오염된다.

---

## 2. 개발 언어 및 기술 스택

### CLI 도구 (설치·배포 담당)

| 항목 | 선택 | 이유 |
|------|------|------|
| 언어 | **TypeScript** | 타입 안전성, Node.js 생태계, npm 배포 용이 |
| 런타임 | **Node.js 20+** | LTS, ESM 지원, `fs.cpSync`, crypto 내장 |
| 모듈 시스템 | **ESM (type: module)** | 트리쉐이킹, 최신 표준 |
| 빌드 | **tsc** (추가 번들러 불필요) | CLI 도구는 단순 컴파일로 충분 |
| 테스트 | **Vitest** | ESM 친화적, 빠른 실행, Jest 호환 API |
| 외부 의존성 | **최소화** | CLI는 가능한 한 내장 모듈만 사용 |
| 레지스트리 | **GitHub Packages** | private org 패키지 관리, PAT 기반 인증 |

**핵심 원칙: 외부 CLI 라이브러리(commander, yargs 등) 사용하지 말 것**

이유:
- 의존성이 적을수록 보안 surface가 작다
- 커스텀 파서가 오히려 더 직관적이고 디버깅이 쉽다
- CLI의 복잡도가 라이브러리 도입을 정당화할 만큼 높지 않은 경우가 대부분이다

```typescript
// 좋은 예: 직접 파서
function readOptionValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// 나쁜 예: 무거운 라이브러리 도입
import { Command } from 'commander';
```

### 에이전트 정의 (런타임 담당)

| 항목 | 선택 | 이유 |
|------|------|------|
| 에이전트 정의 | **Markdown + YAML frontmatter** | Claude가 natively 읽음, 인간도 읽기 쉬움 |
| 설정 파일 | **JSON** | 스키마 검증, jq 조작, diff 친화적 |
| 스크립트 | **Bash** | 범용성, 파이프라인 친화적, 추가 런타임 불필요 |
| 스키마 검증 | **JSON Schema** | 표준, 다양한 언어에서 검증 가능 |
| 오케스트레이터 | **JavaScript (.js workflows)** | Claude Code workflow 런타임과 호환 |

### 기술 스택 선정 기준

1. **Claude가 직접 읽어야 하는 파일** → Markdown
2. **구조화된 설정** → JSON (YAML보다 명시적)
3. **시스템 작업** → Bash (portable, no runtime dependency)
4. **복잡한 비즈니스 로직** → TypeScript (타입 안전성)

---

## 3. 인프라 설계

### 3-1. 패키지 배포 인프라

```
GitHub Repository (source)
    │
    │  git push --tags (v* 태그)
    ▼
GitHub Actions (CI/CD)
    │
    │  npm run build → tsc
    │  npm publish → GitHub Packages
    ▼
GitHub Packages (npm registry)
    │
    │  npm install -g @org/package
    ▼
개발자 로컬 환경 (global CLI)
    │
    │  dev-pipe init
    ▼
프로젝트 .claude/ 디렉토리
```

**GitHub Actions 배포 워크플로우 핵심 포인트:**

```yaml
on:
  push:
    tags: ['v*']   # 태그 push에만 반응 (main push에 배포 금지)

jobs:
  publish:
    steps:
      - uses: actions/setup-node@v4
        with:
          registry-url: 'https://npm.pkg.github.com'
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # GITHUB_TOKEN으로 충분
```

### 3-2. 프로젝트 런타임 인프라

에이전트 실행 중 필요한 인프라:

| 인프라 | 용도 | 비고 |
|--------|------|------|
| **git worktrees** | 병렬 task 격리 | 각 task마다 별도 워킹 디렉토리 |
| **GitHub CLI (gh)** | Issue/PR/Project 관리 | API 직접 호출 대신 사용 |
| **GitHub Projects V2** | 작업 보드 상태 관리 | GraphQL API 경유 |
| **jq** | JSON 파싱 스크립트 | Bash 스크립트 내 JSON 처리 |
| **파일 기반 상태 저장** | 체크포인트, 진행 현황 | DB 없이 `.artifacts/runs/`에 저장 |

**왜 별도 DB를 쓰지 않는가?**

- 파일 기반 상태는 git diff로 추적 가능
- jq로 충분히 조작 가능
- 추가 인프라(Postgres, Redis 등) 없이 로컬에서 즉시 실행
- 장애 시 파일 직접 수정으로 복구 가능

### 3-3. 워크트리 격리 전략

병렬 에이전트 실행 시 파일 시스템 충돌을 방지하는 핵심 인프라:

```
main repo (.git/)
├── task/proj-10-1-auth-login/     ← worktree #1 (agent A)
├── task/proj-10-2-user-profile/   ← worktree #2 (agent B)
└── task/proj-10-3-api-gateway/    ← worktree #3 (agent C)
```

```bash
# 워크트리 생성
git worktree add "../task/${task_branch}" "${task_branch}"

# 에이전트 작업 완료 후 제거
git worktree remove "../task/${task_branch}" --force
```

**핵심 규칙:**
- 각 task 에이전트는 자신의 worktree에서만 작업
- merge는 orchestrator가 직렬로 수행 (race condition 방지)
- worktree 경로는 `.claude/worktrees/`에 기록하여 충돌 감지

---

## 4. 멀티 에이전트 구성 방법

### 4-1. 에이전트 역할 분류 원칙

에이전트를 설계할 때 **두 가지 축**으로 분류한다:

**축 1: 역할 (What)**
```
기획 레이어: PM → Architect
구현 레이어: Backend Eng, Frontend Eng, Infra Eng
검증 레이어: QA, Test-Unit, Test-E2E-API, Test-E2E-UI, Reviewer, Verifier
운영 레이어: Project-Ops (GitHub 작업 전담)
오케스트레이터: Task-Orch (다른 에이전트를 호출하는 에이전트)
```

**축 2: 권한 (How)**
- 읽기 전용 에이전트 (spec 작성, 분석)
- 파일 수정 에이전트 (코드 작성)
- 외부 작업 에이전트 (GitHub, git)

### 4-2. 오케스트레이션 패턴

#### 패턴 A: 직렬 체인 (Sequential Chain)
```
create-spec → design-plan → execute-plan
```
각 단계의 산출물이 다음 단계의 입력이 된다. 가장 단순하고 추적하기 쉬운 패턴.

#### 패턴 B: 병렬 그룹 (Parallel Group)
```
execute-plan
├── [Group 1: 병렬]
│   ├── Task 1: backend-eng (auth API)
│   ├── Task 2: backend-eng (user API)
│   └── Task 3: frontend-eng (login UI)
│
└── [Group 2: 직렬, Group 1 완료 후]
    └── Task 4: frontend-eng (dashboard)
```

의존성 있는 task는 직렬, 독립적인 task는 병렬로 실행. DAG(Directed Acyclic Graph) 스케줄러로 관리.

#### 패턴 C: Fan-out / Fan-in
```
task-orch
    │ fan-out
    ├── impl-agent (worktree A)
    ├── impl-agent (worktree B)
    └── impl-agent (worktree C)
    │ fan-in (serial merge)
    verifier
```

#### 핵심 규칙: Orchestrator는 작업하지 않는다

오케스트레이터(task-orch 등)는 다른 에이전트를 호출하는 역할만 한다. 직접 코드를 작성하거나 파일을 수정하면 안 된다.

```markdown
<!-- 좋은 오케스트레이터 정의 -->
## 역할
당신은 Task Orchestrator입니다. 
직접 코드를 작성하지 말고, 항상 다른 에이전트에 위임하세요.

## 금지 사항
- Edit, Write, Bash 도구로 코드 파일 수정 금지
- 구현 작업 직접 수행 금지
```

### 4-3. 에이전트 간 정보 전달 (Downstream Notes)

에이전트가 직렬로 실행될 때 앞선 에이전트의 결과를 다음 에이전트에 전달하는 패턴:

```json
// Task 1 완료 후 출력
{
  "status": "success",
  "downstream_notes": {
    "api_endpoints": ["/api/users", "/api/auth/login"],
    "type_changes": ["UserDto 에 email 필드 추가"],
    "shared_interfaces": ["IUserRepository"]
  }
}
```

```json
// Task 2 입력에 포함
{
  "task_id": "T-2",
  "downstream_notes_from_prev": {
    "api_endpoints": ["/api/users", "/api/auth/login"],
    ...
  }
}
```

**규칙:**
- `downstream_notes`는 항상 object (null 금지)
- 직전 task의 결과만 전달 (전체 히스토리 X)
- 스키마 정의 필수 (어떤 필드가 전달될 수 있는지)

### 4-4. Phase 기반 워크플로우 설계

복잡한 기능 구현을 Phase로 나누면 체크포인트와 복구 지점이 생긴다:

```
Phase 0: 준비 (브랜치 확인, artifact sync)
Phase 1: Story 생성 (GitHub Issue + feature branch)
Phase 2: Task 분할 (Sub-issue + task 브랜치 목록)
Phase 3: Task 실행 (병렬 구현 + 직렬 merge)
Phase 4: 검증 (테스트 + 리뷰 + PR)
```

각 Phase 시작/완료를 로그로 남기면 어디서 실패했는지 즉시 알 수 있다.

---

## 5. 파일 및 디렉토리 구조

### 5-1. 프로젝트 내 .claude/ 구조

```
.claude/
├── agents/                    # 에이전트 역할 정의
│   ├── pm.md
│   ├── architect.md
│   ├── backend-eng.md
│   ├── frontend-eng.md
│   ├── infra-eng.md
│   ├── qa.md
│   ├── test-unit.md
│   ├── test-e2e-api.md
│   ├── test-e2e-ui.md
│   ├── reviewer.md
│   ├── verifier.md
│   └── project-ops.md
│
├── commands/                  # 슬래시 커맨드
│   ├── create-spec.md
│   ├── design-plan.md
│   └── execute-plan.md
│
├── hooks/                     # PreToolUse 훅 (자동 컴파일)
│   ├── verify-boundary.sh
│   ├── validate-commit-msg.sh
│   └── ban-background.sh
│
├── scripts/                   # 유틸리티 스크립트
│   ├── gh/                    # GitHub 작업
│   │   ├── create-issue.sh
│   │   └── update-project-status.sh
│   ├── validate/              # 검증 스크립트
│   │   ├── validate-impl-concordance.sh
│   │   └── classify-error-recovery.sh
│   ├── test/                  # 테스트 실행
│   └── sync/                  # Cloud Sync
│
├── shared/                    # SSOT 문서 (에이전트가 참조)
│   ├── agent-rules/           # 공통 규칙
│   ├── procedures/            # 역할별 절차
│   ├── workflow/              # 오케스트레이션 로직
│   ├── formats/               # 산출물 포맷 명세
│   └── schemas/               # JSON Schema
│
├── config/
│   ├── pipeline.json          # 런타임 설정 (버전 관리)
│   ├── pipeline.local.json    # 로컬 오버라이드 (git ignore)
│   └── stack/                 # 기술 스택 감지 결과
│       ├── backend.json
│       └── frontend.json
│
├── rules/
│   └── project-settings.md   # 프로젝트별 설정 (업데이트 보호)
│
├── skills/                    # 역할별 심화 규칙
│   ├── backend-conventions/
│   └── pm-rules/
│
├── workflows/                 # 워크플로우 오케스트레이터
│   └── execute-plan.js
│
├── bin/                       # 실행 파일 래퍼
│   └── adp-watch
│
├── settings.json              # Claude Code 하네스 설정
├── settings.local.json        # 로컬 권한 오버라이드 (git ignore)
└── .dev-pipe-version          # 설치된 파이프라인 버전
```

### 5-2. .artifacts/ 구조 (git 추적 안 함)

```
.artifacts/
├── specs/                     # 기능 명세서
│   └── {slug}-spec.md
├── plans/                     # 실행 계획
│   └── {slug}-plan.md
├── runs/                      # 실행 로그
│   ├── {slug}-events.jsonl    # 이벤트 스트림
│   ├── {slug}-state.json      # 현재 상태
│   └── tasks/
│       └── {task-id}-result.json
└── context/                   # 컨텍스트 문서
    └── {slug}-context.md
```

### 5-3. CLI 소스 구조

```
src/
├── cli.ts                     # 진입점, 커맨드 라우터
├── init.ts                    # init 커맨드
├── update.ts                  # update 커맨드
├── upgrade.ts                 # upgrade 커맨드
├── diff.ts                    # diff 커맨드
├── preflight.ts               # 사전 요구사항 검증
├── detect.ts                  # GitHub Project 자동 감지
├── validate.ts                # post-init 검증
├── version.ts                 # 버전 관리
├── versions.ts                # npm 버전 목록 조회
├── utils.ts                   # 공통 유틸
├── errors.ts                  # 에러 타입 정의
├── pipeline/                  # pipeline 서브커맨드
│   └── commands.ts
├── stack/                     # 기술 스택 감지
│   └── generate.js
└── conventions/               # 컨벤션 파일 마이그레이션
    └── migrate.ts
```

**중요: 파일 당 하나의 책임.** `init.ts`는 init만, `detect.ts`는 감지만.

---

## 6. 에이전트 정의 방식

### 6-1. 파일 형식: Markdown + YAML Frontmatter

```markdown
---
name: backend-eng
description: |
  Backend Engineer. Implements APIs, business logic, and data layers.
  Called by task-orch per task. Works in git worktree isolation.
model: sonnet
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Agent
---

## 역할

당신은 Backend Engineer입니다. task-orch로부터 하나의 task를 받아 구현합니다.

## 입력 스키마

입력은 항상 `.claude/shared/schemas/impl-agent-input.schema.json`을 따릅니다.

## 작업 절차

1. 입력 JSON에서 task 정보 파싱
2. feature_branch에서 task_branch 생성
3. 구현 (파일 수정)
4. 타입 체크 + 린트
5. 유닛 테스트 추가 및 실행
6. 출력 JSON 작성

## 출력 스키마

출력은 `.claude/shared/schemas/impl-agent-output.schema.json`을 따릅니다.

## 금지 사항

- 다른 task의 worktree 파일 접근 금지
- git push 이외의 remote 작업 금지
- 테스트 삭제 금지

<!-- SHARED_REF: boundary-enforcement -->
SSOT: .claude/shared/agent-rules/boundary-enforcement.md
<!-- /SHARED_REF -->
```

### 6-2. 에이전트 정의 핵심 원칙

**원칙 1: 계약 명시 (Contract-First)**

모든 에이전트는 입출력 스키마를 선언해야 한다. 스키마 없이 "알아서 출력하라"는 에이전트는 디버깅이 불가능하다.

**원칙 2: 절차 문서화 (Procedure as Documentation)**

에이전트가 할 일을 번호 있는 목록으로 작성한다. 이것이 곧 테스트 기준이 된다.

**원칙 3: 금지 사항 명시 (Explicit Prohibitions)**

"하지 말아야 할 것"을 명시하는 것이 "해야 할 것"만큼 중요하다. 모호한 경계는 훅으로 강제한다.

**원칙 4: SSOT 참조 (SHARED_REF Pattern)**

공통 규칙은 에이전트 파일에 복사하지 않고 참조로 표시한다. 업데이트 시 한 곳만 수정하면 된다.

```markdown
<!-- SHARED_REF: common-agent-rules -->
SSOT: .claude/shared/agent-rules/index.md
<!-- /SHARED_REF -->
```

### 6-3. 에이전트 모델 선택 기준

| 에이전트 | 모델 | 이유 |
|----------|------|------|
| PM, Architect | opus | 복잡한 기획·설계 |
| Backend/Frontend/Infra Eng | sonnet | 코드 작성 (속도·비용 균형) |
| QA, Reviewer | sonnet | 분석 작업 |
| Verifier | opus | 최종 종합 판단 |
| Project-Ops | haiku | 단순 GitHub 작업 |

---

## 7. 훅 및 경계 강제(Boundary Enforcement)

### 7-1. settings.json 훅 설정

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/verify-git-safety.sh"
          },
          {
            "type": "command",
            "command": ".claude/hooks/validate-commit-msg.sh"
          }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/verify-boundary.sh"
          }
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/validate-subagent-type.sh"
          }
        ]
      }
    ]
  }
}
```

### 7-2. 훅 스크립트 패턴

```bash
#!/usr/bin/env bash
# verify-boundary.sh
# PreToolUse: Edit, Write 도구 호출 전 실행
# stdin: {"tool_input": {"file_path": "..."}, "agent_type": "..."}

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# 보호 경로 목록
PROTECTED_PATHS=(
  ".claude/rules/project-settings.md"
  ".claude/shared/github-project-ids.md"
  ".claude/settings.json"
)

for PROTECTED in "${PROTECTED_PATHS[@]}"; do
  if [[ "$FILE_PATH" == *"$PROTECTED"* ]]; then
    if [[ "$AGENT_TYPE" != "project-ops" ]]; then
      echo "BLOCKED: $FILE_PATH 는 project-ops 에이전트만 수정 가능합니다." >&2
      exit 1
    fi
  fi
done

exit 0
```

### 7-3. 훅 설계 원칙

**원칙 1: Fail-Fast (빠른 실패)**
훅은 조용히 통과시키거나 경고만 하면 안 된다. 위반 시 즉시 exit 1로 차단한다.

**원칙 2: 명확한 오류 메시지**
```bash
echo "BLOCKED: 이유를 여기에 명확히 설명" >&2
```
에이전트가 왜 차단됐는지 알아야 스스로 수정할 수 있다.

**원칙 3: stdin으로 컨텍스트 수신**
훅은 tool 호출 정보를 stdin JSON으로 받는다. 이를 파싱해서 조건별 처리한다.

**원칙 4: 훅은 단일 책임**
`verify-git-safety.sh`는 git 안전성만, `validate-commit-msg.sh`는 커밋 메시지만. 하나의 훅에 여러 검증을 넣지 않는다.

**구현해야 할 핵심 훅 목록:**

| 훅 | 대상 도구 | 기능 |
|----|----------|------|
| `verify-boundary.sh` | Edit, Write | 에이전트 경계 외 파일 수정 차단 |
| `verify-git-safety.sh` | Bash | `git reset --hard`, `git push --force` 등 위험 명령 차단 |
| `validate-commit-msg.sh` | Bash | Conventional Commit 형식 검증 |
| `ban-background.sh` | Bash | `run_in_background` 남용 차단 |
| `validate-subagent-type.sh` | Agent | 허용되지 않은 에이전트 타입 차단 |

---

## 8. 설정 시스템 설계

### 8-1. 3단계 설정 계층

```
pipeline.json (템플릿 기본값, 버전 관리됨)
    ↓ 딥 머지 오버라이드
pipeline.local.json (로컬 오버라이드, git ignore)
    ↓ 초기화 시 생성
rules/project-settings.md (프로젝트별 설정, 업데이트 보호)
```

**pipeline.json 구조 예시:**

```json
{
  "_version": "2.1",
  "limits": {
    "max_retries": 3,
    "global_max_retries": 5,
    "global_max_elapsed_min": 120,
    "max_test": 3,
    "max_lint": 2,
    "thrash_consecutive": 3
  },
  "paths": {
    "artifacts": ".artifacts",
    "conventions_dir": "docs/conventions",
    "scripts_dir": ".claude/scripts"
  },
  "project_board": {
    "statuses": {
      "backlog": "Backlog",
      "in_progress": "In progress",
      "in_review": "In Review",
      "done": "Done"
    }
  },
  "vcs": {
    "default_branch": "main",
    "task_branch_pattern": "task/{short}-{issue}-{n}-{title}",
    "feature_branch_pattern": "feat/{short}-{issue}-{title}"
  },
  "review": {
    "depth": "standard"
  }
}
```

### 8-2. project-settings.md 구조

```markdown
# Project Settings

## Project Info

- **org**: uj-amf-sw-dev
- **repo**: emmes-if
- **short**: ei

## Branch Naming

- Feature: `feat/ei-{issue}-{title}`
- Task: `task/ei-{issue}-{n}-{title}`
- Hotfix: `hotfix/ei-{issue}-{title}`

## Default Assignee

- shlee-ujamf

## Language & Conventions

- 코드: TypeScript (strict)
- 커밋 메시지: 영어, Conventional Commits
- PR 설명: 한국어 가능
```

### 8-3. 보호 파일 목록 (update 시 덮어쓰지 않는 파일)

```typescript
const LOCAL_FILES = [
  'rules/project-settings.md',
  'shared/github-project-ids.md',
  'settings.local.json',
  'worktrees/',
  '.current-agent',
  'config/stack/',
  'config/conventions/',
  'config/pipeline.local.json',
];
```

이 목록에 없는 파일은 모두 템플릿으로 덮어쓸 수 있다.

---

## 9. 업데이트 및 버전 관리

### 9-1. 버전 추적 구조

```
글로벌 패키지 버전 (npm)
    ↔ 비교
프로젝트 설치 버전 (.claude/.dev-pipe-version)
```

```bash
# .dev-pipe-version 내용
0.3.3
```

```typescript
// 버전 비교 로직
function checkVersionSync(cliVersion: string, projectVersion: string): VersionStatus {
  if (!projectVersion) return 'not-installed';
  if (cliVersion === projectVersion) return 'in-sync';
  const [cliMajor, cliMinor] = cliVersion.split('.').map(Number);
  const [projMajor, projMinor] = projectVersion.split('.').map(Number);
  if (cliMajor !== projMajor) return 'major-mismatch';
  if (cliMinor - projMinor >= 2) return 'minor-lag';
  return 'out-of-sync';
}
```

### 9-2. 해시 기반 파일 변경 감지

타임스탬프 대신 SHA256 해시를 사용한다. 타임스탬프는 `git clone`, `npm install` 시 변경될 수 있다.

```typescript
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

// 비교
const templateHash = fileHash(templatePath);
const installedHash = fileHash(installedPath);

if (templateHash !== installedHash) {
  // 파일이 변경됨
}
```

### 9-3. 3단계 업데이트 흐름

```
1. SCAN   → 템플릿 vs 설치 파일 해시 비교 → 변경/신규/삭제 분류
2. CONFIRM → 색상 코딩 표시 → 사용자 확인 (--force 시 skip)
3. APPLY  → 파일 복사/삭제 → 버전 파일 갱신 → 검증
```

```
변경 표시 예시:
  + scripts/new-feature.sh        (신규, 초록)
  ~ shared/workflow-guide.md      (수정, 노랑)
  - hooks/old-hook.sh             (삭제, 빨강)
  ✓ agents/backend-eng.md         (동일, 회색)
```

### 9-4. upgrade vs update

| 명령 | 동작 |
|------|------|
| `dev-pipe upgrade` | 글로벌 패키지 업그레이드 + 현재 프로젝트 템플릿 갱신 |
| `dev-pipe upgrade --version X.Y.Z` | 특정 버전으로 피닝 |
| `dev-pipe update` | 글로벌 패키지는 그대로, 현재 프로젝트만 갱신 |
| `dev-pipe update --force` | 확인 없이 강제 덮어쓰기 |

---

## 10. 오류 분류 및 복구 전략

### 10-1. 오류 분류 체계

에이전트가 실패했을 때 "재시도할 것인가, 에스컬레이션할 것인가"를 자동으로 결정하는 체계:

| 분류 | 설명 | 복구 전략 | 예시 |
|------|------|----------|------|
| `FLAKE` | 일시적 오류 | 즉시 재시도 | 네트워크 타임아웃, Rate limit |
| `LINT_ERROR` | 코드 스타일 | 에이전트 재실행 (린트 컨텍스트 추가) | ESLint 오류 |
| `TYPE_ERROR` | 타입 불일치 | 에이전트 재실행 (타입 오류 컨텍스트 추가) | TypeScript 오류 |
| `TEST_FAIL` | 테스트 실패 | 에이전트 재실행 (실패 로그 추가) | 유닛 테스트 실패 |
| `DESIGN_GAP` | 명세-구현 불일치 | 아키텍트에 에스컬레이션 | 누락된 API 엔드포인트 |
| `ENV_FAILURE` | 인프라 오류 | 사람 개입 필요 | git push 실패, GitHub API 오류 |
| `CONTEXT_EXHAUSTED` | 컨텍스트 초과 | task 분할 후 재시도 | 토큰 한도 초과 |

### 10-2. 분류 스크립트 패턴

```bash
#!/usr/bin/env bash
# classify-error-recovery.sh
# stdin: 에이전트 실패 로그
# stdout: 복구 분류 JSON
# exit code: 0=pass, 1=retry, 2=escalate, 3=halt

ERROR_LOG=$(cat)

# 패턴 매칭
if echo "$ERROR_LOG" | grep -q "rate limit\|timeout\|ECONNREFUSED"; then
  echo '{"category": "FLAKE", "action": "retry", "wait_sec": 30}'
  exit 1
fi

if echo "$ERROR_LOG" | grep -q "Type error\|TS[0-9]"; then
  echo '{"category": "TYPE_ERROR", "action": "retry_with_context"}'
  exit 1
fi

if echo "$ERROR_LOG" | grep -q "spec requirement.*not covered"; then
  echo '{"category": "DESIGN_GAP", "action": "escalate_to_architect"}'
  exit 2
fi

if echo "$ERROR_LOG" | grep -q "context.*exhausted\|maximum context"; then
  echo '{"category": "CONTEXT_EXHAUSTED", "action": "halt"}'
  exit 3
fi

echo '{"category": "UNKNOWN", "action": "escalate"}'
exit 2
```

### 10-3. 재시도 제한 설정

```json
{
  "limits": {
    "max_lint": 2,
    "max_typecheck": 3,
    "max_test": 3,
    "max_design_gap": 1,
    "global_max_retries": 5,
    "global_max_elapsed_min": 120,
    "thrash_consecutive": 3
  }
}
```

`thrash_consecutive`: 연속으로 동일한 오류가 발생하면 루프 감지로 강제 종료.

---

## 11. 스키마 및 계약(Contract) 설계

### 11-1. 에이전트 I/O 스키마 (JSON Schema)

```json
// impl-agent-input.schema.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["task_id", "feature_branch", "task_branch", "story_number", "issue_number"],
  "properties": {
    "task_id": { "type": "string" },
    "feature_branch": { "type": "string" },
    "task_branch": { "type": "string" },
    "story_number": { "type": "integer" },
    "issue_number": { "type": "integer" },
    "short_name": { "type": "string" },
    "task_title": { "type": "string" },
    "downstream_notes": {
      "type": "object",
      "description": "이전 task로부터의 정보 (null 불가)"
    }
  }
}
```

```json
// impl-agent-output.schema.json
{
  "type": "object",
  "required": ["status", "task_id"],
  "properties": {
    "status": { "enum": ["success", "failure", "partial"] },
    "task_id": { "type": "string" },
    "files_created": { "type": "array", "items": { "type": "string" } },
    "files_modified": { "type": "array", "items": { "type": "string" } },
    "tests_added": { "type": "integer" },
    "downstream_notes": { "type": "object" },
    "meta": {
      "type": "object",
      "properties": {
        "arch_coverage": {
          "type": "object",
          "properties": {
            "spec_tasks_covered": { "type": "array", "items": { "type": "string" } }
          }
        },
        "endpoints": { "type": "array" },
        "entities": { "type": "array" }
      }
    }
  }
}
```

### 11-2. Concordance Gate (명세-구현 일치 검증)

```bash
#!/usr/bin/env bash
# validate-impl-concordance.sh
# 명세의 REQ-N vs 구현의 arch_coverage.spec_tasks_covered 비교

SPEC_FILE="$1"
IMPL_OUTPUT="$2"

# 명세에서 요구사항 ID 추출
SPEC_REQS=$(grep -oP 'REQ-\d+' "$SPEC_FILE" | sort -u)

# 구현 출력에서 커버된 요구사항 추출
COVERED_REQS=$(jq -r '.meta.arch_coverage.spec_tasks_covered[]' "$IMPL_OUTPUT" | sort -u)

# 누락 확인
MISSING=$(comm -23 <(echo "$SPEC_REQS") <(echo "$COVERED_REQS"))

if [[ -n "$MISSING" ]]; then
  echo "DESIGN_GAP: 다음 요구사항이 구현되지 않았습니다:" >&2
  echo "$MISSING" >&2
  exit 1
fi

exit 0
```

### 11-3. 스키마 검증 시점

```
에이전트 호출 전: 입력 JSON 스키마 검증
에이전트 완료 후: 출력 JSON 스키마 검증
Phase 완료 후: Concordance Gate (명세 커버리지 검증)
Merge 전: Boundary 검증 (수정 파일 범위)
PR 생성 전: 최종 테스트 + 타입 체크
```

---

## 12. 모니터링 및 관찰성

### 12-1. 이벤트 스트림 (JSONL)

모든 실행 이벤트를 JSONL 파일에 append한다:

```jsonl
{"ts":"2026-06-03T10:00:00Z","type":"phase_start","phase":0,"slug":"auth-feature"}
{"ts":"2026-06-03T10:00:01Z","type":"phase_done","phase":0,"elapsed_sec":1}
{"ts":"2026-06-03T10:00:02Z","type":"task_start","task_id":"T-1","agent":"backend-eng"}
{"ts":"2026-06-03T10:00:45Z","type":"task_retry","task_id":"T-1","attempt":2,"category":"TYPE_ERROR"}
{"ts":"2026-06-03T10:01:30Z","type":"task_done","task_id":"T-1","status":"success","elapsed_sec":88}
{"ts":"2026-06-03T10:01:31Z","type":"task_start","task_id":"T-2","agent":"frontend-eng"}
```

**왜 JSONL인가?**
- 스트리밍 append 가능 (동시 쓰기 안전)
- `jq` 파이프라인으로 실시간 분석
- 재실행 없이 지난 실행 리플레이 가능

### 12-2. 실시간 모니터링 도구 (adp-watch 패턴)

```bash
#!/usr/bin/env bash
# adp-watch: 파이프라인 이벤트 실시간 추적
SLUG="${1:-}"
EVENTS_FILE=".artifacts/runs/${SLUG}-events.jsonl"

tail -f "$EVENTS_FILE" | while read -r LINE; do
  TS=$(echo "$LINE" | jq -r '.ts')
  TYPE=$(echo "$LINE" | jq -r '.type')
  
  case "$TYPE" in
    phase_start) echo "[$TS] ▶ Phase $(echo "$LINE" | jq -r '.phase') started" ;;
    phase_done)  echo "[$TS] ✔ Phase $(echo "$LINE" | jq -r '.phase') done" ;;
    task_start)  echo "[$TS]   ▶ $(echo "$LINE" | jq -r '.task_id') ($(echo "$LINE" | jq -r '.agent'))" ;;
    task_done)   echo "[$TS]   ✔ $(echo "$LINE" | jq -r '.task_id') $(echo "$LINE" | jq -r '.status')" ;;
    task_retry)  echo "[$TS]   ⚠ $(echo "$LINE" | jq -r '.task_id') retry #$(echo "$LINE" | jq -r '.attempt')" ;;
    escalation)  echo "[$TS]   ✗ $(echo "$LINE" | jq -r '.task_id') ESCALATED" ;;
  esac
done
```

### 12-3. 체크포인트 기반 재시작

장시간 파이프라인은 체크포인트를 남겨서 중단 후 재시작이 가능하게 한다:

```json
// .artifacts/runs/{slug}-state.json
{
  "slug": "auth-feature",
  "phase": 3,
  "completed_tasks": ["T-1", "T-2"],
  "pending_tasks": ["T-3", "T-4"],
  "started_at": "2026-06-03T10:00:00Z",
  "last_checkpoint": "2026-06-03T10:05:00Z"
}
```

---

## 13. 배포 전략

### 13-1. private npm 레지스트리 (GitHub Packages)

**장점:**
- GitHub org 단위 접근 제어
- GITHUB_TOKEN으로 CI 배포 가능
- npm 클라이언트 그대로 사용

**설정:**

```
# ~/.npmrc (개발자 로컬)
@org-name:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_XXXX

# .npmrc (프로젝트, git 커밋)
@org-name:registry=https://npm.pkg.github.com
```

```json
// package.json
{
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

### 13-2. 배포 흐름

```bash
# 1. 버전 올리기
npm version patch   # 또는 minor, major

# 2. 자동 배포 (GitHub Actions)
git push origin main --tags
```

```yaml
# .github/workflows/publish.yml
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 13-3. 팀 온보딩 체크리스트

```
신규 개발자 온보딩:
□ GitHub PAT 발급 (read:packages)
□ ~/.npmrc 설정
□ npm install -g @org/pipeline-tool
□ 프로젝트 clone
□ cd {project} && pipeline-tool init
□ dev-pipe version 으로 동기화 확인
```

---

## 14. 핵심 설계 결정 요약

| 결정 | 선택 | 이유 |
|------|------|------|
| 에이전트 정의 형식 | Markdown + YAML frontmatter | Claude가 natively 읽음; 인간도 읽기 쉬움 |
| 상태 저장 | 파일 기반 (JSONL, JSON) | DB 불필요; git diff 가능; jq로 조작 |
| 파일 변경 감지 | SHA256 해시 | 타임스탬프 신뢰 불가 |
| 병렬 실행 격리 | git worktree | 파일 시스템 충돌 방지 |
| 경계 강제 | PreToolUse 훅 | 실시간, 에이전트 bypass 불가 |
| 공통 규칙 관리 | SSOT 문서 + SHARED_REF | 중복 제거; 한 곳 수정으로 전파 |
| 설정 보호 | LOCAL_FILES 목록 | 업데이트 시 사용자 설정 보존 |
| 외부 CLI 라이브러리 | 사용 안 함 | 의존성 최소화; 직접 파서가 더 단순 |
| 오류 분류 | Bash 스크립트 + exit code | portable; scriptable; 테스트 쉬움 |
| I/O 계약 | JSON Schema | 표준; 다국어 검증; diff 친화적 |

---

## 15. 안티패턴 및 주의사항

### 피해야 할 것들

**안티패턴 1: 에이전트에 직접 로직 구현**
```markdown
<!-- 나쁜 예 -->
## 에러 처리
TypeScript 오류가 나면 3번 재시도하고, 타임아웃이면 10초 기다렸다가 재시도하고...
```
→ 오류 분류 로직은 Bash 스크립트로 분리하고 에이전트는 그 결과를 받는다.

**안티패턴 2: SSOT 없이 규칙 복사**
```markdown
<!-- 나쁜 예 -->
<!-- 모든 에이전트 파일에 동일한 규칙이 복사됨 -->
## 커밋 규칙
feat: 새 기능
fix: 버그 수정
...
```
→ 공통 규칙은 `shared/` 에 한 번만 쓰고 `<!-- SHARED_REF -->` 로 참조한다.

**안티패턴 3: 타임스탬프 기반 변경 감지**
→ `git clone`, `npm install` 이후 타임스탬프가 바뀐다. 해시 기반으로 해야 한다.

**안티패턴 4: 오케스트레이터가 직접 구현**
```markdown
<!-- 나쁜 예 -->
## task-orch 에이전트
의존성 분석 후, 직접 코드도 작성하고, 에이전트도 호출하고...
```
→ 오케스트레이터는 호출만 한다. 구현은 전담 에이전트에 위임한다.

**안티패턴 5: `.artifacts/` 를 git 추적**
→ 실행 로그와 임시 파일이 저장소를 오염시킨다. 반드시 `.gitignore` 에 추가.

**안티패턴 6: 단일 branch에서 병렬 실행**
→ 파일 시스템 충돌 발생. worktree 격리 필수.

**안티패턴 7: 모든 설정을 업데이트로 덮어쓰기**
→ 사용자가 커스터마이즈한 설정이 사라진다. LOCAL_FILES 목록으로 보호할 파일을 명시한다.

**안티패턴 8: 훅에서 경고만 출력 (exit 0)**
```bash
# 나쁜 예
if [[ 위반 ]]; then
  echo "Warning: 경계를 넘었습니다" >&2
  exit 0  # 통과시킴
fi
```
→ 훅은 위반 시 반드시 `exit 1` 로 차단해야 한다.

---

## 부록: 최소 구현 체크리스트

처음 이런 시스템을 만들 때 최소한으로 갖춰야 할 것들:

### MVP (첫 번째 버전)
- [ ] TypeScript CLI: init, update, version 명령
- [ ] 3~5개 에이전트 정의 (PM, 구현, 검증)
- [ ] settings.json 훅 (경계 강제 1개 이상)
- [ ] 프로젝트별 설정 보호 파일 목록
- [ ] 해시 기반 파일 변경 감지
- [ ] .dev-pipe-version 버전 추적
- [ ] .artifacts/ gitignore

### v1.0 (팀 도입 버전)
- [ ] 12개 역할 에이전트 전체
- [ ] DAG 기반 병렬 실행 (worktree 격리)
- [ ] 오류 분류 스크립트 (5개 카테고리 이상)
- [ ] I/O JSON Schema 정의
- [ ] Concordance Gate
- [ ] 이벤트 스트림 (JSONL)
- [ ] 실시간 모니터링 스크립트
- [ ] GitHub Actions 자동 배포
- [ ] 팀 온보딩 문서

### v2.0 (성숙 버전)
- [ ] 스택 자동 감지 (framework, test runner, pkg manager)
- [ ] 컨벤션 파일 자동 생성
- [ ] Cloud Sync (rclone + Google Drive)
- [ ] 버전 피닝 (특정 버전 고정)
- [ ] 스키마 마이그레이션 (1.0 → 2.0)
- [ ] `dev-pipe diff` 명령
- [ ] Preflight 체크 (의존 도구 자동 검증)
