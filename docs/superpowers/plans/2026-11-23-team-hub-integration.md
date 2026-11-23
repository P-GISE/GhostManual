# 팀 화면 단계적 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PR #99의 팀 탭·초대 흐름을 기존 자료와 공유 링크를 보존하며 보완·검증한다.

**Architecture:** 최신 기본6d58eef에 PR99 원본607e971의7파일을 별도 소유 브랜치로 통합한다. 기존 admin/member 서버 권한과 문서함 세션을 재사용하고, 대표 관리자 DB·여러 팀 개요·개인 문서함 숨김·공유 제거는 이번 화면 보완과 분리한다.

**Tech Stack:** Next.js·React·TypeScript·PostgreSQL·Playwright, 기존 Node24·기존 의존성을 유지한다. PR100의 의존성 업데이트는 미병합 별도 범위다.

**Spec:** [PR99 구현](https://github.com/P-GISE/GhostManual/pull/99)·[PR98 설계 제안](https://github.com/P-GISE/GhostManual/pull/98), 사용자 승인 ‘기존 자료·링크 유지하며 단계적 전환’이 원 설계의 제거 제안보다 우선한다.

## Global Constraints

- 운영 배포·SQL·migration 적용·실제 자료 이동·링크 폐기는 하지 않는다.
- 다른 작성자의 브랜치를 수정·닫거나 미지시 PR을 병합하지 않는다.
- 로컬 프로젝트를 수정하지 않고 원격 작업 저장소에서 편집한다. 공유 서버 설치·빌드·fixture 생성·부하 실행 없이 GitHub 격리 CI로 검증한다.
- 초대·역할·삭제 API의 서버 권한과 세션 토큰 폐기 규칙은 유지한다. 인증 자료를 기록하지 않는다.

## Review Focus

- 일반 팀원이 created=1을 붙여도 관리자 전용 초대·생성 안내가 보이지 않아야 한다.
- 팀 직접 진입은 목적 팀으로 전환하고 이전 토큰을 폐기해야 한다.
- 전환 실패 시 잘못된 문서함의 업무·양식을 표시하거나 올리는 길을 열지 않아야 한다.
- 새 탭의 역할·연결·방향키·포커스·터치 영역·좁은 화면 넘침을 검사한다.
- 기존 개인 자료·공유 링크·admin/member API·매뉴얼 이력을 보존한다.

## Task 1: 실패 회귀와 최소 표시 보완

**Files:** src/components/TeamPage.tsx, tests/e2e/teams.spec.ts.

- [ ] 실제 초대받은 일반 팀원의 created=1 접근 회귀를 먼저 추가한다. 관리자 생성 안내는 양성 대조로 유지한다.
- [ ] 변경 전 GitHub CI에서 초대 입력/생성 안내가 남아 있는 assertion 실패를 확인한다. 컴파일·타임아웃 실패를 RED 증거로 대신하지 않는다.
- [ ] created 안내 분기에 관리자 조건을 더하는 최소 수정으로 일반 팀원은 정상 탭을 보게 한다. 서버 권한을 바꾸거나 lint·검사를 끄지 않는다.
- [ ] 직접 팀 진입의 정확한 문서함·이전 토큰401, 전환403의 오류 표시·잘못된 목록 차단을 검사한다.

## Task 2: 새 탭 접근성과 전체 회귀

**Files:** tests/accessibility/team-hub.spec.ts, 기존 Playwright 설정.

- [ ] DB 없는 합성 GET 응답으로 관리자/팀원·일반/created 상태를 세 viewport에서 검사한다. 실제 권한 근거는 위 실제 DB E2E와 구분한다.
- [ ] 화살표 키·선택 탭·tabpanel 연결·44px 영역·가로 넘침을 검사한다. 실패가 나타나면 해당 UI 근거를 보고 최소 수정한다.
- [ ] 기존 전체 보안·lint·typecheck·단위·DB통합·E2E·세션·쿠키·접근성·파서46표본 CI를 통과시킨다.
- [ ] 독립 검토 후 검증 결과와 실행 한계를 PR에 정리한다. 운영 반영은 후속 지시까지 하지 않는다.

## Task 3: 대표 관리자 DB 후속 설계

- [ ] 기존 개인 문서함·자료·공유 링크 보존을 확정 기록한다.
- [ ] 대표 관리자·기존 admin 역할·정확히1명·계정 탈퇴·동시 변경·구버전 호환성을 소스와 대조해 별도 계획으로 남긴다.
- [x] 대표 권한을 다른 관리자에게 이양한 뒤 탈퇴하는 정책을 사용자에게 확인했다. 자동 승계는 제외한다.
- [ ] DB 모양·단계별 배포 계약을 검토한 뒤 별도 구현한다. 이 문서만으로 migration이나 기존 팀 backfill을 실행하지 않는다.
