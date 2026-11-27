# 팀 이름 변경 후 상단 경로 갱신 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 이름 저장 후 CSR로 업무 화면에 진입할 때 정확한 현재 문서함 이름을 표시한다.

**Architecture:** 기존 useCurrentWorkspace 훅과 권한 API는 유지한다. 영속 wrapper가 표시 대상 경로에서만 pathname-key 자식을 렌더해 조회 수명과 화면 수명을 맞춘다.

**Tech Stack:** React19.3.1, Next16.4.6, 기존 Playwright/GitHub CI. 새 의존성 없음.

**Spec:** [원인·설계·실행 근거](../../qa/2026-11-27/workspace-crumb-refresh.md)

## Global Constraints

- 기본47168fc·기존 개인 자료/공유·Owner/Reader 구분과 훅의 loading/failure 계약을 유지한다.
- 운영 배포·migration014·운영 부하·로컬 프로젝트/공유 서버 빌드·테스트는 하지 않는다.
- full reload로 회귀를 우회하지 않는다. 문서함 자체를 전환하는 기존 full reload 보안 경계는 유지한다.

## Review Focus

- 저장 성공 후 이전 이름이 남거나 다른 문서함 이름이 표시되지 않는가.
- 늦은 응답/조회 실패에서 이전 이름을 재사용하지 않는가.
- 개인 name=null 표시와 공유 독자 경계가 유지되는가.
- 표시 대상 사이 경로 이동과 팀 화면을 거친 같은 경로 재진입이 새로 조회되는가.
- 새로고침으로 회귀를 숨기거나 단순 H1 로딩 화면만 확인하지 않는가.

### Task 1: 회귀·수정·문서

**Files:** src/components/Teams.tsx, tests/e2e/workspace-crumb-refresh.spec.ts, PROJECT_GUIDE.md, docs/00_문서_가이드.md, docs/99_해야할일.md, docs/구현_진행_기록.md, 위 QA 기록.

- [x] 현재 caller·TeamPage 저장/Link·입력 준비 조건을 읽고 독립 검토한다.
- [x] 실제 rename→CSR와 조회 실패 회귀를 먼저 추가한다. marker로 문서 reload 부재를 확인한다.
- [x] 동일 테스트의 실제 실패를 CI에서 확인하고 원인과 무관한 실패는 먼저 정정한다.
- [x] 표시 대상 경로의 자식만 최소 수정하고 기존 훅/cleanup/권한을 보존한다.
- [x] 가이드·할 일 목록에서 #118/#119 완료와 운영 보류를 분리하고 지연 준비안 링크를 추가한다.
- [ ] 전체 CI·같은 head의 코드 검토·접근성/캡처를 확인한다. 실제 상태는 PR #120과 QA 기록을 따른다.

계획의 체크는 이 구현 커밋 작성 시점이며, 최종 CI·검토 결과는 PR #120을 따른다.
