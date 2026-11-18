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
- [x] PR #63 병합·CI 후 S3 사전 백업, 운영009·작성자 backfill·앱 역할 권한, 앱/워커 배포 및 합성 API 회귀를 확인했다. 배포44126435638, 운영44f262b.

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

## 2026-11-18 후속 계약 초안과 진행 상태

PR #63 및 #62 댓글에서 세션·권한·이동 계약의 추가 답변은 조회 시점에 없다. 아래는 박기성의 구현 제안이며 합의 완료로 표시하지 않는다.

### 제안할 세션·질문 이력 계약
- 문서함 전환은 기존 sessions.workspace_id를 변경하지 않고 대상 문서함용 새 세션/토큰을 발급한다. 전환 전후 요청은 각 요청이 검증한 workspace에 귀속된다.
- 기존 문서·양식 작업은 등록 때의 세션과 workspace를 사용하고, 완료 시 현재 membership을 재검사한다.
- 질문·근거 이력의 보존 기간은 인증 세션 만료와 분리한다. 현재 계정 삭제 외에 logout, 비밀번호 재설정, 만료 정리의 sessions DELETE도 question_runs/evidence를 CASCADE 삭제한다.
- 후속 migration은 question_runs의 workspace 소속을 독립 FK로 유지하고, 인증 세션 연결이 해제돼도 질문/근거를 보존할 구조를 설계한다. session_id의 nullable 여부, 조회 권한과 보존 기간을 박효민과 함께 확정한다.
- 로그아웃이 현재 문서함 세션만 종료할지 모든 문서함 세션을 종료할지도 맞춘다. 팀 질문만 보존할지 개인 질문에도 같은 보관 정책을 적용할지 확인한다.
- 마지막 관리자 변경은 모든 API에서 workspace 잠금 후 검사한다. 동시 계정 삭제 회귀는 2명 중 1명만 성공하고 남은 관리자를 보존하는 결과로 5/5 통과했다.

### 제안할 업무 이동 1차 계약
- 이동 전 검사에서 해당 업무와 다른 업무를 함께 인용한 Owner 질문을 발견하면 409로 안내하고 전부 보존한다. 여러 업무의 질문을 임의로 옮기거나 삭제하는 처리는 하지 않는다. 이 제한은 팀 확인이 필요하다.
- 판정은 evidence 테이블뿐 아니라 question_runs.result의 evidence와 searchResults를 모두 포함한다. JSON 결과에도 원문이 있어 이전 문서함 노출 여부를 검사해야 한다.
- 단일 업무 Reader 이력은 연결된 공유, Reader 세션, 질문, 근거와 함께 이관한다. 대상 membership과 Reader 공유 권한은 별도로 검사한다.
- 진행 중 AI 작업의 source 연관을 안전하게 식별하지 못하면 원본 workspace의 활성 AI 작업 동안 이동을 보류하는 구현안을 검토한다.
- AI 예약은 advisory lock 782402 후 workspace를 잠근다. 이동에서도 이 잠금을 사용하면 같은 순서를 유지한다.
- 완료된 operation_requests는 기존 workspace에서 이동 자료를 재조회할 수 없도록 처리한다. 실제 요청 idempotency 계약을 박효민과 맞춘다.
- 후속 migration 번호는 열린 작업과 대조해 확정한다. 운영009를 수정해 재적용하지 않는다.

### 박기성 남은 순서
1. 박효민의 세션·권한 계약 확인과 업무 이동 제한 확인.
2. 합의된 FK/불변 트리거 변경 및 DB 이동 함수 구현. 중간 실패 rollback과 복합 인용 차단·내용 보존·용량·동시성 테스트.
3. 박효민 팀/양식 화면 PR 통합 검토, CI·운영 반영. DOCX/HWPX 실제 브라우저 업로드→후보 확인 및 팀 권한 검증.
4. 서버·스토리지 비용 자료 갱신과 보안 패치 PR #64 운영 반영 상태 확인. #64는 기본 브랜치에 병합됐으며 이번 조회 시 운영 앱은 여전히44f262b다.
5. 새로 열린 박효민 작업 PR #65(빈 항목 패널), #66(양식 화면), #67(후보 확인·AI 정리·확정)의 통합 검토를 이어간다.
