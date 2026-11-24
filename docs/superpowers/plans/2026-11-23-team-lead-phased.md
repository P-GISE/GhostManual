# 대표 관리자 DB 단계 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 기존 개인·팀 자료와 공유 접근을 보존하면서 팀마다 대표 관리자 한 명을 기록하고, 다른 현재 팀원(admin/member)에게 명시적으로 이양한 뒤 탈퇴하게 한다.

**Architecture:** nullable 확장 → 양쪽 상태를 지원하는 호환 앱 → 구버전 writer 종료 확인 → backfill·정확히 한 명 제약 → 역할 API 활성화 순서로 나눈다.013은 #105 병합·CI 후 운영 적용했고, 초기 Task2 호환 백엔드는 #106 병합·운영 반영했고, PR107에서 실제014와 사용자가 채택한 #98 권한표·명시적 member 승격 이양을 함께 검증한다.014 전에는 새 정책 코드의013 앱만 반영 경로를 별도로 검토해야 하며 #106만으로 새 권한표를 충족하지 않는다.014와 대표 기능 운영 활성화는 아직 하지 않는다.

**Tech Stack:** 현재 Node24·TypeScript·PostgreSQL18, 기존 account/session/workspace 잠금과 admin/member 역할을 재사용한다.

**Spec:** [PR98 제안](https://github.com/P-GISE/GhostManual/pull/98) 중 대표 관리자 부분. [사용자 결정](../../00_문서_가이드.md)의 보존·이양 정책이 원 제안의 제거·자동 승계보다 우선한다.

## 확정 정책과 제외 범위

- 기존 개인 workspace·업무·양식·원본·답변·게시본·공유 링크·Reader와 접근/관리 화면은 유지한다. 자동 이동·삭제·개인 업로드 차단은 하지 않는다.
- 대표는 다른 현재 admin/member에게 명시적으로 이양한 뒤 자기 탈퇴·계정 삭제를 할 수 있다. 선택한 member만 같은 이양 TX에서 admin으로 올리고 pointer를 변경한다. backfill·가입·탈퇴의 자동 승격이나 자동 승계는 하지 않는다.
- 기존 admin/member enum과 마지막 admin 보호를 유지한다. 대표 이양 후 이전 대표는 admin으로 남는다.
- 사용자가 #98의 권한표만 채택했다.014 준비 후 대표만 팀 삭제·승격/강등·다른 부관리자 내보내기를 하고, 부관리자는 일반 member 내보내기·초대/취소·이름 변경·본인 나가기를 할 수 있다.013에서는 기존 admin 권한과 이양503을 유지한다. DB 역할 enum은 admin/member 그대로이며 준비된 admin 중 대표가 아닌 사람을 부관리자로 계산한다.
- 현재013 확장과 초기 #106 호환 백엔드 운영 반영을 완료했고 실제014·새 권한표·명시적 member 승격 이양을 PR107에서 격리 검증 중이다.014·backfill·구버전 종료·대표 기능 운영 활성화는 아직 하지 않는다.

## 현재 코드에서 확인한 경계

- `src/lib/teams.ts` createTeam은 workspace INSERT→admin membership→014 준비 확인 후 대표 pointer를 같은 TX에서 만든다.013의 lead_user_id는 nullable이고 미준비 시 기존 NULL 생성 동작을 유지한다.
- `src/lib/accounts.ts` deleteAccount는 현재·개인·모든 현재 소속팀을 정렬 잠근다. member도 대표로 이양될 수 있으므로 admin 팀만 잠그지 않는다. 대표 보호와 기존 마지막 admin을 확인한 뒤 개인 workspace를 제거하고 users를 DELETE한다. membership은 사용자 삭제 시 cascade한다.
- `src/lib/session.ts`의 workspace 정렬 잠금 → 계정 → 세션 순서를 유지한다. 새 대상 계정을 먼저 잠가 이 순서를 뒤집지 않는다.
- `scripts/migrate.ts`는 미적용 SQL 전부를 순서대로 실행한다. 확장과 강제 migration을 첫 배포 산출물에 함께 싣지 않는다.

## 제안 DB 모양

`workspaces.lead_user_id uuid NULL`을 권장한다. 한 workspace 행의 pointer가 최대 한 명을 나타내고, 개인 workspace는 항상 NULL이다. membership의 lead boolean + partial unique만으로는 대표 0명을 막지 못한다.

강제 단계에서는 `(workspaces.id, lead_user_id)`가 같은 팀의 membership을 가리키는 지연 FK와 지연 constraint trigger를 둔다. 살아 있는 팀의 최종 COMMIT 상태에서 대표가 NULL이 아니고 같은 팀의 admin인지 확인한다. membership의 INSERT/UPDATE/DELETE와 workspace 변경을 모두 다루고, 팀 삭제로 workspace 자체가 사라진 경우는 허용한다. FK는 NO ACTION이며 대표 membership 삭제를 조용히 NULL로 바꾸지 않는다.

기존 팀 backfill은 NULL인 대표만 채운다. 이미 유효한 non-NULL 대표는 보존하고 잘못된 non-NULL 대표는 자동 교체하지 않고 중단한다. NULL 대표의 선택은 현재 admin 중 `joined_at ASC, user_id ASC` 첫 사람이다. 이 사람을 ‘최초 생성자’라고 주장하지 않는다. admin이 없는 기존 팀은 member를 자동 승격하지 않고 강제 전환을 중단해 점검한다.

## 단계와 구현 과제

### Task 1: 확장 migration과 구버전 호환성

**Files:** 후보 `db/migrations/013_team_lead_expand.sql`, 새 격리 DB 업그레이드 테스트.

- [x] 번호 점유를 다시 확인하고 nullable 열만 추가한다. 기존001~012를 수정하지 않는다.
- [x] 대표를 채우거나 기존 쓰기를 제한하지 않는다. 구버전의 createTeam·admin 변경·이양하지 않은 계정 삭제가 확장 직후 기존 의미대로 동작하는지 검사한다.
- [x] 개인/팀/기존 공유 fixture와 schema·데이터 보존을 대조한다. 이 단계에서 대표 API를 활성화하지 않는다.

### Task 2: 호환 backend와 명시적 이양 계약

**Files:** `src/lib/teams.ts`, `src/lib/accounts.ts`, 관련 API 응답·통합 테스트. 박효민 API/화면 담당과 함께 연결한다.

- [x] 강제 전환 전 NULL 상태에서는 기존 역할 동작을 유지하고 새 이양 API는 준비 안 됨을 명확히 반환한다. 준비 상태는 owner-managed schema_migrations의014 marker를 매 트랜잭션에서 확인한다.
- [x] `POST /api/workspaces/[id]/lead` 입력 `{userId}`는 세션·팀 소속을 잠금 후 재확인한다. actor는 대표, 대상은 같은 팀의 다른 현재 admin/member이다.
- [x] 대상이 member이면 같은 명시적 이양 TX에서 admin으로 올린 뒤 pointer를 바꾼다. pointer 실패 시 승격도 rollback한다. 두 사람은 최종 admin으로 남고 응답의 `lead`는 pointer에서 계산한다.
- [x] 대표 강등·팀 탈퇴·계정 삭제는 이양 전 거절한다. 계정이 대표인 팀이 하나라도 있으면 개인 자료를 지우기 전에 거절하고 전체 rollback한다.
- [x] 현재 workspace와 대상 팀을 정렬 잠근 뒤 역할을 다시 읽는다. 이양 vs 탈퇴/강등/계정 삭제와 두 동시 이양을 검증한다.

### Task 3: backfill·제약 강제와 전환 경합

**Files:** 별도 후보 `db/migrations/014_team_lead_enforce.sql`, 단계 전환/동시성 통합 테스트.

- [ ] 먼저 호환 앱을 모든 쓰기 주체에 반영하고 구버전 writer가 없음을 확인하는 실행서를 검토한다. 이번 문서 작성만으로 실행하지 않는다.
- [x] 제한된 잠금 시간 안에서 workspace→membership 쓰기를 잠그고 backfill·지연 FK·최종 상태 제약을 한 트랜잭션으로 반영한다. 실패하면 전체 rollback한다.
- [x] 호환 createTeam은 workspace INSERT 후 전환 상태를 재확인해, 전환 전 NULL로 판단한 요청이 강제 COMMIT 뒤 대표 없이 생성되는 경합을 닫는다.
- [x] 강제 후 새 팀은 workspace→admin membership→lead pointer를 같은 트랜잭션에서 만든다. 중간 NULL은 허용해도 COMMIT의 대표 0명·외부 팀원·member 대표·대표 강등은 거절한다.
- [x] 전환·이양·삭제 거절 시 원본·버전·게시본·공유 전체 보존을 확인한다. 직접 대표 사용자 삭제도 DB 제약으로 차단한다.
- [x] 명시적 계정 삭제 성공은 기존 개인 workspace 삭제 정책을 유지하되 팀 자료·게시본·공유와 다른 계정 자료를 보존한다. 명시적 팀 삭제 성공은 그 팀의 기존 삭제 범위만 정리하고 다른 개인·팀 자료·공유를 보존한다. 전환의 보존 정책을 기존 사용자의 명시적 삭제 금지로 확대하지 않는다.
- [ ] 014 이후 복구 기준은 이번 PR107의 새 권한표·member 승격 이양이 포함된 호환 앱 이상이다. 이전 #106은 새 정책의 복구 기준이 아니다. 구버전 앱 복귀나 대표 제약/데이터의 자동 삭제를 복구로 사용하지 않는다.

### Task 4: API·화면 통합과 전체 회귀

- [ ] 박효민과 lead 응답·대표만 가능한 동작·준비 전 오류·탈퇴 안내 계약을 확인한다. 전체 팀 개요/진행 현황/메뉴 제거는 별도 단계로 둔다.
- [ ] 대표/비대표 admin/member/Reader·비회원, 취소·실패·동시 변경과 데스크톱/모바일을 검사한다.
- [ ] GitHub 격리 DB와 실제 브라우저에서 기존 개인·팀·공유·업무 이동·로그아웃·계정 삭제 회귀를 통과한다. 공유 서버에서 빌드·QA 부하를 실행하지 않는다.
- [ ] 최신 CI·백업·복구·보호 목록과 별도 운영 지시를 확인하기 전 운영에 반영하지 않는다.

## 완료 기준과 미확정

정확히 한 명의 소속 admin 대표, 명시적 현재 admin/member 이양과 member 승격의 원자성, 대표 탈퇴 전 보호, 구버전 공존 안전성, 승인된 기존 자료·링크 접근 보존이 동시에 통과해야 한다. 대표 삭제 자동 승계와 backfill/가입/탈퇴의 member 자동 승격은 이번 범위가 아니다. 사용자가 선택한 member의 같은 TX 승격만 허용한다.

DB013/014·owner ledger 준비 신호·API 오류 코드·새 권한표의 코드/격리 검증은 PR107에서 확인한다. 화면 연결·안전한 새 정책 앱 선반영·운영014는 별도이며 정책 채택을 PR 병합/운영 실행 승인으로 혼동하지 않는다.

## 2026-11-24 Task2 계약·검증 갱신

[호환 백엔드·이양 API 계약](../../qa/2026-11-24/team-lead-backend-contract.md)에 readiness·응답·오류·동시성 경계를 정리했다.014 SQL은 이번 산출물에 없고 CI의 marker 모의는 실제 강제 제약 검증과 구분한다. Task2 구현과 격리 DB212건은 통과했다. 체크는 코드·DB 계약 기준이며 전체 GREEN CI·독립 최종 검토·새 앱 배포 완료를 대신하지 않는다. 전체 CI·PR은 최신 head로 별도 확인한다.


## 2026-11-24 Task3 코드·격리 검증

014 SQL과 실제 업그레이드/최종 COMMIT 제약·동시성 검사를 구현했다.70cd21e의 CI45310185330에서 단위·타입·DB226건이 통과했고 문서 갱신 시 전체 이미지/E2E 결과는 진행 중이다. 체크된 Task3 항목은 **코드·격리 검증**이며 운영014 실행이 아니다. 전체 최신 CI·PR은 해당 head에서 확인한다.

기존013 NULL/marker 프로토콜2파일은 고유 *_test DB의 별도 Vitest 프로젝트로 분리했다. 고정 public search_path를 바꾸어 검증을 흉내 내거나 기본014 제약/ledger를 지우지 않는다. 기존 저장/이동/종료 fixture에는 별도 admin 대표나 명시적 이양을 추가하고 마지막 admin·동시 계정 삭제의013 의미도 별도 검사로 유지했다.

검토 중 발견한 역방향 RR write-skew는 CI45309706059에서224건 성공/1건 실패로 재현했다. FK만으로 역할 스냅샷을 보호하지 못해 membership 변경 때 정렬 잠근 workspace를 같은 값으로 UPDATE하여 tuple 버전을 갱신했다. 논리 내용은 같고 stale RR은 전체 rollback한다.30명 batch/팀 cascade 검사로 지연 이벤트의 비재귀와 내용 보존을 확인했다. [전환 실행서·근거·한계](../../qa/2026-11-24/team-lead-enforcement-runbook.md).

추가로 backfill 뒤 DDL constraint 이름 충돌을 유도하는 rollback 회귀1건을 작성했다. 대표 값·업무 내용·기존 constraint/13개 이력 보존과 새 FK/trigger 부재를 확인하며, 이 추가 건의 실행 결과는 최신 PR CI를 따른다.


## PR107 후속: #98 권한표만 채택

신규31fb0ab/CI45326031071에서 기존227과 새3건 통과·정책/명시적 member 이양/UUID 자기 탈퇴/첫 소속팀 잠금/대기 중 이전 대표12건 실패를 확인한 뒤 최소 백엔드 guard를 반영했다.013 구버전 admin 권한과 이양503은 별도 DB에서 유지하고014 정책은 실제 제약이 있는 기본 DB에서 검사한다. 승격/강등이 먼저면 이양과 양쪽 성공이 가능하고, 이양이 먼저면 이전 대표의 역할 변경은403이다. 대상 자기 탈퇴/삭제 경합은 하나만 성공하고 다른 동작은409/422다.

모든 현재 소속팀의 정렬 잠금, 명시적 member 승격/pointer rollback,13/14 canonical UUID 자기 탈퇴와 세션 복귀, 거절 시 자료·게시본·공유·Reader·세션 보존을 검사한다. 정책 계약은 [대표/부관리자 API 계약](../../qa/2026-11-24/team-lead-backend-contract.md)을 따른다. 자료·공유·개인 화면 제거와 진행 현황 API/화면은 구현하지 않는다.

새 권한표 구현69e5af8/CI45326607263에서013/014 DB242건이 통과했다. 최종 문서 head의 전체 CI·검토 결과는 PR107을 따르며 운영·014 적용 완료를 뜻하지 않는다.
