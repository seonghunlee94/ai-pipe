# Plan format (SSOT)

`.artifacts/plans/{slug}-plan.md` 의 정규 구조. **producer** 는 `architect` 에이전트, **consumer** 는 `execute-plan` skill. 양쪽이 이 문서를 단일 진실 원천으로 따른다. spec §4.2 패턴 A, §4.4.

`## Tasks` 표가 기계 판독용 SSOT 다 — execute-plan 은 이 표에서 task_id / agent / task_branch / depends_on / covers 와, plan 헤더의 feature_branch 를 읽는다. 나머지 섹션은 사람과 impl 에이전트를 위한 컨텍스트.

---

## 정규 템플릿

```markdown
# Plan: {slug}

- spec: .artifacts/specs/{slug}-spec.md
- feature_branch: feat/{slug}
- generated_by: architect

## Tasks

| task_id | agent        | task_branch                  | depends_on | covers        | title              |
|---------|--------------|------------------------------|------------|---------------|--------------------|
| T-1     | backend-eng  | task/{slug}-1-login-api      | -          | REQ-1, REQ-2  | 로그인 API         |
| T-2     | backend-eng  | task/{slug}-2-token-issue    | T-1        | REQ-3         | JWT 토큰 발급      |
| T-3     | frontend-eng | task/{slug}-3-login-form     | T-2        | REQ-4         | 로그인 폼          |

## Task details

### T-1 — 로그인 API
- covers: REQ-1, REQ-2
- agent: backend-eng
- acceptance: 이메일+비밀번호 검증, 실패 시 401, 성공 시 user 반환
- expected_outputs (architect 의 설계-시점 예측 — 다음 task 가 받을 정보): { "endpoints": ["POST /api/login"], "entities": ["User"] }

### T-2 — JWT 토큰 발급
- covers: REQ-3
- depends_on: T-1
- acceptance: 로그인 성공 시 access token 발급, 만료 15분
- expected_outputs: { "endpoints": ["POST /api/token/refresh"], "token": "access+refresh" }

### T-3 — 로그인 폼
- covers: REQ-4
- depends_on: T-2
- acceptance: 폼 제출 → /api/login 호출 → 토큰 저장

## Coverage

모든 REQ-N 이 최소 하나의 task 에 매핑돼야 한다 (concordance gate §11.2 의 사전 조건).

| REQ   | task(s) |
|-------|---------|
| REQ-1 | T-1     |
| REQ-2 | T-1     |
| REQ-3 | T-2     |
| REQ-4 | T-3     |
```

---

## 규칙

1. **task_id**: `T-<n>`, 1 부터 연속. impl-agent-input/output 스키마의 `^T-[0-9]+$` 와 일치.
2. **agent**: `backend-eng` | `frontend-eng` | `infra-eng` 중 하나 (impl 에이전트만). 비-impl 작업(리뷰/QA)은 plan 에 task 로 넣지 않는다 — execute-plan 이후 단계에서 처리.
3. **task_branch**: 기본 `task/{slug}-{n}-{kebab-title}`. GitHub 연동(project-ops Phase 1/2) 이 활성화되면 issue 번호를 포함한 `task/{short}-{issue}-{n}-{title}` (pipeline.json `task_branch_pattern`) 으로 재명명될 수 있다. 로컬 단독 실행에서는 slug 기반 이름을 그대로 쓴다.
4. **feature_branch**: 기본 `feat/{slug}`. 모든 task_branch 의 base.
5. **depends_on**: 쉼표 구분 task_id 목록, 없으면 `-`. 순환 금지 (DAG). execute-plan 이 위상 정렬해 의존 없는 task 부터 fan-out.
6. **covers**: 이 task 가 구현하는 REQ-N 목록. 모든 REQ 가 Coverage 표에서 ≥1 task 로 커버돼야 한다 — 누락 시 architect 는 plan 을 내지 말고 `DESIGN_GAP` 으로 escalate.
7. **story_number / issue_number**: plan 에는 없다. execute-plan 이 실행 시점에 GitHub Phase(있으면) 또는 로컬 기본값으로 바인딩해 impl-agent-input 을 완성한다.
8. 표의 컬럼 순서·헤더는 고정 (consumer 가 위치로 파싱). 셀 안에 `|` 금지.
