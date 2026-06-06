---
name: create-spec
description: |
  PM 에이전트를 호출해 사용자 요청을 명세서(.artifacts/specs/{slug}-spec.md)로 만든다.
  Slash command form: /create-spec <feature description>.
  Direct invocation pattern A from spec §4.2 (sequential chain).
user-invocable: true
argument-hint: "<feature description>"
allowed-tools:
  - Agent
---

# create-spec

당신의 임무는 PM 에이전트를 호출해서 사용자의 요청을 정형화된 명세서로 만드는 것입니다.

## 절차

1. 사용자의 메시지(`$ARGUMENTS`)를 그대로 PM 에이전트에 위임한다 (`Agent` tool, `subagent_type: pm`).
2. PM 의 출력 JSON 에서 `spec_path` 와 `req_ids` 를 추출.
3. 사용자에게 다음을 보고:
   - 생성된 spec 파일 경로
   - 요구사항 개수 및 ID 목록
   - 다음 단계 안내: `/design-plan <slug>`

## 금지 사항

- 직접 spec 파일을 작성하지 말 것 (PM 에이전트가 전담).
- spec 디렉토리(`.artifacts/specs/`) 외 파일을 수정하지 말 것.
