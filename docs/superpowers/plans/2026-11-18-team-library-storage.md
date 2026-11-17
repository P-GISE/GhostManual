# 팀 문서함 저장 기반 구현 계획

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** migration 009와 자료 보존 기반을 구현하고, 팀 권한 및 업무 이동 연동 조건을 확정한다.

**Architecture:** 기존 workspace 격리를 사용한다. 개인 소유자와 팀을 구분하고 팀은 무기한 보존한다. 세션·권한 API는 박효민 담당이며 팀 기능 활성화 전 아래 이력 보존 조건을 충족해야 한다.

**Tech Stack:** PostgreSQL, TypeScript, Vitest.

**Spec:** docs/superpowers/specs/2026-11-17-team-library-design.md

## 저장 기반
- [x] 009에 team_name, workspace_members, workspace_invites, sources.created_by, manual_versions.published_by_name 추가.
- [x] 양식 삭제 권한에 필요한 manual_templates.created_by를 추가하고 기존 개인 자료·양식 작성자를 소유자로 채운다.
- [x] 팀은 user_id=NULL, expires_at=infinity를 DB CHECK로 강제한다.
- [x] cleanupExpired는 팀을 제외한다.
- [x] 계정 삭제는 개인 문서함만 지우고, 마지막 팀 관리자는 409로 차단한다.
- [x] 텍스트·XLSX·문서·양식 생성 경로에서 세션 사용자를 작성자로 기록한다.
- [x] 전체 격리 DB 통합 28파일 158건 통과. 타입·포맷 검사는 최종 결과 기록을 따른다.
- [ ] PR 검토·CI 후 별도 운영 반영 시 사전 백업과 앱 역할 권한을 확인한다.

## 박효민 연동 조건
- 세션 해석과 assertSession, 문서·양식 워커 모두 membership을 검사한다.
- 마지막 관리자 역할 변경·탈퇴·추방은 대상 workspace를 잠그고 검사한다. 여러 workspace 잠금은 UUID 오름차순이다.
- 세션 workspace_id만 바꾸면 question_runs 복합 FK에 걸린다. 전환 시 이전 이력과 세션 관계를 보존하는 설계가 필요하다.
- 계정 삭제는 sessions.user_id CASCADE로 질문·근거까지 삭제한다. 팀 세션에서 만든 질문을 보존하는 별도 이력 구조 또는 세션 생명주기 변경과 회귀 테스트를 팀 활성화 전에 구현한다.
- published_by_name은 실제 게시 INSERT에서 세션 사용자 이름을 복사해야 한다. 이번 저장 기반은 컬럼만 준비한다.
- 초대 재발송은 만료 미수락 행도 unique index에 걸리므로 기존 미수락 행을 제거하고 새 토큰 해시를 넣는다.
- 팀 용량은 100 MiB, 멤버 AI 허용은 요청 계정 기준이다. 공유 Reader 정책은 승인 설계를 따른다.

## 업무 이동의 DB 범위와 순서
원본은 source_files.content bytea이므로 외부 파일 경로 이동은 없다.
직접 연계 테이블은 sources, source_revisions, source_files, change_groups, revision_questions, document_results, document_jobs, manuals, manual_versions, shares이다.
공유에 묶인 Reader sessions, question_runs, evidence도 함께 보존한다. manual_templates는 문서함 자산이며 source 이동 대상이 아니다. 발생한 usage_counters를 옮겨 사용량을 초기화하지 않는다.

1. 두 workspace를 UUID 순서로 잠근 뒤 원본 개인 소유자·대상 팀 membership, 100 MiB 합산 용량과 진행 중 document/AI 작업을 검사한다.
2. 원본·대상 변경 전후의 연결 행 ID와 내용 해시를 기록해 테스트한다.
3. 001/005/007의 즉시 복합 FK를 이동 범위에 한해 지연 가능하게 바꾸는 후속 migration을 설계한다.
4. source_revisions, manual_versions, source_files, change_groups, document_results의 immutable trigger 및 revision_questions identity trigger는 현재 workspace UPDATE도 거부한다. 일반 내용 변경을 계속 거부하며 검증된 이동만 허용하는 DB 경계를 별도 검토한다.
5. operation_requests의 완료 결과 재조회가 이전 workspace에서 이동 자료를 노출하지 않도록 무효화 정책을 정한다.
6. 여러 source를 함께 인용한 owner question_runs/evidence는 한 source와 함께 단순 이동할 수 없다. Reader 이력과 구분해 보존 정책을 팀과 확정한다.
7. 단일 트랜잭션으로 이동하고 중간 오류·용량 초과·권한 철회·동시 업로드 시 전체 rollback을 검증한다.

업무 이동 함수는 세션 이력 보존과 교차 자료 질문 정책이 정해진 뒤 구현한다. 팀 API와 화면 없이 이동 경로를 활성화하지 않는다.
