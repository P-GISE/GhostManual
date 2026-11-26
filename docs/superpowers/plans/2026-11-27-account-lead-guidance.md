# Account Lead Transfer Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대표 권한 때문에 탈퇴가 차단되면 본인의 대표 팀 이양 화면으로 안내한다.
**Architecture:** 기존 목록 SQL의 본인 lead boolean과 AccountPage 특정409 상태를 연결한다. TeamPage의 권한 재확인/세션 전환/이양을 재사용한다.
**Tech Stack:** Node26.13.1, Next/React/TypeScript, PostgreSQL18, Zod4, Vitest/Playwright.
**Spec:** ../specs/2026-11-27-account-lead-guidance-design.md

## Global Constraints

- 운영 DB013/미적용014·자동 승계 없음·원본/공유 보존. 운영 배포 없음.
- 원격 전용 구현, GitHub 격리 CI 검증. 공유 S1 npm/build/테스트/fixture/부하 금지.
- PR117 브랜치/겹치는 Teams.tsx·accounts.ts·client.ts·기존 helpers 수정 없음.

## Review Focus

- 개인/다른 팀 선택에서도 본인 대표 팀만 표시하고014 이전에는 false.
- 일반409·401·조회503·불완전 응답은 오인/오래된 링크/자동DELETE 금지.
- 빠른 중복 클릭은DELETE1회, 재시도는GET만. 삭제 재확인 필수.
- 이양 링크 방문 시 실제 TeamPage의 권한/세션 재검사.
- 실제014 격리 E2E의 팀 자료·공유와013 호환 보존; 키보드·뷰포트 캡처.

### Task 1: 목록의 본인 대표 여부

**Files:** src/lib/teams.ts; tests/integration/account-lead-workspaces.test.ts; tests/integration/teams.test.ts; 필요 시 기존013 호환 검사.
**Interface:** listWorkspaces(ctx) returns existing fields + lead:boolean, same one SQL snapshot.

- [x] 실패하는 실제DB 검사를 작성하고 CI45861720971에서 기존255성공/신규3실패(missing lead boolean) RED를 확인했다.
- [ ] 같은 SELECT의 marker/admin/team/pointer boolean만 구현하고 기존 equality 기대값을 갱신한다.
- [ ] CI의 실제 DB014/013 회귀를 확인한다.

### Task 2: 특정409 안내와 안전 재시도

**Files:** src/components/AccountPage.tsx; tests/e2e/account-lead-guidance.spec.ts; tests/e2e/account-lead-transfer-flow.spec.ts; tests/accessibility/account-lead-guidance.spec.ts; docs/현재 가이드/진행 기록.
**Interface:** 기존 DELETE/GET만 사용, 새 write API 없음. 로컬 확장 목록 schema·명시적 링크·읽기 재시도.

- [ ] mock UI 실패검사를 먼저 CI에서 재현한다.
- [ ] 기존 panel/alert/링크 구성으로 최소 UI와 동기 중복 잠금·언마운트 가드를 구현한다.
- [ ] 실제 격리014 이양/삭제와013·계정/자료/공유 보존, 키보드/3뷰포트 검증을 추가한다.
- [ ] 전체CI·독립 검토 후 커밋/PR 보고와 가이드를 최신화한다. 병합/운영/014는 별도 지시 전 수행하지 않는다.
