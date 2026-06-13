# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/),
버전은 [Semantic Versioning](https://semver.org/)을 따른다.

## [0.1.0] - 2026-06-14

첫 공개 릴리스. `@seonghunlee94/ai-pipe`, MIT.

### Added
- 멀티 에이전트 파이프라인: PM → Architect → Backend/Frontend/Infra-eng → QA →
  Test-* → Reviewer → Verifier (12 에이전트), `/create-spec → /design-plan →
  /execute-plan → /verify` 스킬 체인.
- 모델 티어링: 기획·설계·리뷰·판단 = opus(architect, pm, verifier, reviewer),
  개발·테스트 = sonnet(backend/frontend/infra-eng, qa, test-*), 기계적 GitHub
  조작 = haiku(project-ops).
- PreToolUse 안전 훅 6종(verify-boundary, verify-git-safety,
  validate-commit-msg, ban-background, secrets-scan, validate-subagent-type) +
  SessionStart/SessionEnd lifecycle 훅 2종.
- CLI 12개 명령(`init`/`validate`/`preflight`/`detect`/`update`/`diff`/
  `versions`/… — node:util parseArgs 통일), Concordance Gate, 오류 분류기.
- Claude Code Plugin Marketplace 배포(`ai-pipe-core`) + npm CLI(GitHub
  Packages) 두 채널.
- 5-레이어 테스트 스위트(78 unit + 75 hook + 25 script) + CI.

### Empirical (검증 라운드)
- 플러그인 설치 실증(§6) + 실사용 dogfood — 파이프라인 end-to-end SHIP.
- dev/use 설치 모드 구분 + dev 모드 toolchain 변이 가드 3겹.
- git 전역옵션 우회(N24) 일반화 정규화로 차단.

[0.1.0]: https://github.com/seonghunlee94/ai-pipe/releases/tag/v0.1.0
