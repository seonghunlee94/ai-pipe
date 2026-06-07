<!--
  Spec §8.2 — project-specific settings. This file is on the LOCAL_FILES
  protected list (spec §8.3), meaning `ai-pipe update` will NEVER overwrite it.
  Edit values below to match your project. The {{PLACEHOLDER}} markers must
  all be replaced before the pipeline can run.
-->

# Project Settings

## Project Info

- **org**: {{ORG}}            <!-- GitHub org or user, e.g. uj-amf-sw-dev -->
- **repo**: {{REPO}}           <!-- repo name, e.g. emmes-if -->
- **short**: {{SHORT}}         <!-- 2-4 char project shortcode, e.g. ei -->

## Branch Naming

- Feature: `feat/{{SHORT}}-{issue}-{title}`
- Task:    `task/{{SHORT}}-{issue}-{n}-{title}`
- Hotfix:  `hotfix/{{SHORT}}-{issue}-{title}`

## Default Assignee

- {{DEFAULT_ASSIGNEE}}         <!-- GitHub username -->

## Language & Conventions

- 코드 언어: {{CODE_LANGUAGE}}            <!-- e.g. TypeScript (strict) -->
- 커밋 메시지: Conventional Commits (영어 권장)
- PR 설명: 한국어 가능
- 코멘트/문서: 한국어

## Reviewer Pool

- {{REVIEWER_USERNAMES}}        <!-- comma-separated GitHub usernames -->

## GitHub Project (V2)

- 보드 번호: {{PROJECT_NUMBER}}   <!-- `gh project list --owner {{ORG}}` -->
- 상세 매핑은 `ai-pipe detect` 가 `shared/github-project-ids.md` 에 기록
