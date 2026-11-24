# 대표 관리자014 강제 전환: 검토·실행서

## 현재 상태와 범위

이 문서는014 구현과 격리 검증의 실행 계약이다. **운영014·backfill·대표 지정은 아직 하지 않는다.** 현재 운영은 [프로젝트 가이드](../../../PROJECT_GUIDE.md)와 [#106 운영 기록](pr106-production-verification.md)을 따른다.013과 호환 백엔드를 먼저 반영한 상태와014 강제 전환은 별개다.

014는 NULL인 팀 대표만 기존 admin 중 `joined_at ASC, user_id ASC` 첫 사람으로 채운다. 이 사람을 최초 생성자라고 부르지 않는다. 유효한 기존 non-NULL 대표는 보존한다. admin 없는 팀·외부/일반 member를 가리키는 대표·개인 workspace의 대표 값은 자동 수정하거나 승격하지 않고 전체 migration을 중단한다.

사용자는 #98의 권한표만 채택했다.014 준비 후 팀 삭제·승격/강등은 대표 전용이며 부관리자는 일반 member만 내보낼 수 있다. 초대/취소·이름 변경·부관리자 본인 나가기는 유지한다. 대표는 다른 현재 admin/member에게 명시적으로 이양하며, 선택한 member만 같은 TX에서 admin으로 올린다. 양쪽은 admin으로 남고 이전 대표는 부관리자가 된다. backfill/가입/탈퇴의 자동 승격·자동 승계·개인 자료/공유 링크 폐기는 없다.013만 적용된 동안은 기존 admin 권한과 이양503을 유지한다. [정확한 권한·API 계약](team-lead-backend-contract.md).

## 운영 전 선행 조건

1.014 PR의 최신 기본 통합·전체 CI·독립 검토와 **별도의 운영014/backfill 지시**를 확인한다. 이번 격리 검증으로 운영 승인을 대신하지 않는다.
2. 모든 앱·큐 워커·예약/수동 writer가 **이번 PR107의 새 권한표·명시적 member 승격 이양·전체 소속팀 잠금 코드** 이상인지 CID·이미지·소스 영수증으로 대조한다. 현재 #106만으로는014 후 새 권한표를 충족하지 않는다. 새 정책 호환 앱을013 상태에 먼저 반영할 canonical 이미지·앱만 승격 경로·pending014 보호 해시를 별도로 검토한다.014 파일이 포함된 산출물을 무조건 금지/허용하지 않고 현재 고정 실행기 동작과 검토한 보호 목록을 대조한다. 구버전 이미지 존재와 실행 중 writer를 구분하고 구버전 writer가 남으면 진행하지 않는다.
3. 인프라 채팅과 작업 창을 조율하고 실제 deploy flock·복구/실행 마커·자동 배포·외부 DB writer·현재 자원을 확인한다. 공유 서버 빌드/부하 검증은 하지 않는다.
4. 업무 쓰기를 멈추거나 유입을 차단하는 승인된 짧은 점검 창을 준비하고 진행 중 트랜잭션을 배출한다. 대표 표시·이양 진입점·409 안내의 화면 계약도 확인한다. 화면이 아직 없으면 API 구현 완료를 일반 사용자용 기능 완료로 표시하지 않는다.
5. 새 S3 백업 업로드와 저장 checksum·복구 지점을 확인한다. 이번 SQL 전환과 백업 복원 시험은 별개다.
6. owner 연결로 DB001~013·014 미적용·nullable UUID 구조를 대조하고, NULL 팀 수/유효한 대표 수/admin 없는 팀 수/잘못된 대표 수를 확인한다. 업무 원문·개인 연락처·백업 key를 Git이나 출력에 남기지 않는다.
7. CI 산출물과 검토한014 파일 해시를 고정한다. CI 검증 명령(package.json) 변경은 별도로 검토하고, 현재 고정 실행기의 보호 목록에 실제로 포함된014 등 변경 파일의 해시만 갱신한다. package.json은 현재 protected_tree 항목이 아니다. fingerprint/여유 공간/검증 기준을 해제하는 우회는 하지 않는다.

## 원자적 실행 계약

기존 migrator는 advisory lock782401과 파일 이력을 같은 트랜잭션에서 처리한다. 수동 운영도 동일한 배타 경계·단일 트랜잭션을 지켜야 하며014만 검토한 상황에서 모든 pending SQL을 무조건 실행하지 않는다.

- owner 세션에서 BEGIN, lock_timeout5초·statement_timeout30초 등 검토한 제한을 설정한다. 이는 잠금/문장별 제한이며 전체 작업 시간 보장이 아니다. 외부 실행 시간 제한을 두고 비정상 종료 시 연결을 닫아 미커밋 TX를 rollback한다.
- 동일 advisory lock을 확보한 뒤 고정한014 원문을 실행하고 `schema_migrations`의 정확한 파일명을 같은 TX에 기록한다. SQL 파일 단독 autocommit 실행은 원자성을 보장하지 않는다.
- 첫 잠금은 workspaces ACCESS EXCLUSIVE, 다음은 workspace_members SHARE ROW EXCLUSIVE다. CHECK/FK DDL의 강한 잠금을 처음부터 명시하며 조회도 잠깐 대기할 수 있다.
- preflight→NULL backfill→개인 NULL CHECK→지연 NO ACTION composite FK→membership 변경 전 workspace 정렬 잠금·같은 값 UPDATE로 tuple 버전 갱신→두 테이블의 지연 최종 상태 검사 순서다.
- 적용 전후 업무 행 수/내용 지문을 대조하되 허용한 lead_user_id 변화와 ledger만 구분한다. 역할·자료·원본 bytes·질문 답/후속 이력·게시본·공유/Reader는 바꾸지 않는다.
- COMMIT에서 모든 살아 있는 팀이 같은 팀 admin 한 명을 대표 pointer로 가져야 한다. 중간 NULL이나 이양 중 이전 membership 정리는 같은 TX의 최종 상태가 유효하면 허용한다.
- timeout/deadlock/제약 오류면 전체 rollback과13 이력·기존 pointer/자료 보존을 확인한다. 원인을 해소한 뒤 새 트랜잭션으로 재시도하고 일부 DDL이나 ledger만 따로 진행하지 않는다.

기존 TX가 이미 workspace나 membership/user 행을 잡은 상태에서는 테이블 잠금 순서만으로 무 deadlock을 보장할 수 없다. 특히 직접 SQL은 row trigger 이전에 membership/user 행을 잠글 수 있다. DB가 한 TX를 중단하는 경우를 안전한 실패와 구분해서 기록한다.

## 적용 뒤 검증·복구 경계

- owner로014 이력·FK의 deferrable/initially deferred/NO ACTION·두 최종 검사 trigger·membership 잠금 trigger·개인 NULL CHECK와 대표 admin 수를 대조한다.
- 제한된 앱 역할의 기존 권한과 schema_migrations SELECT-only를 유지한다. 앱이 marker를 직접 쓰거나 임의 플래그로 활성화하지 않는다.
- 새 정책 호환 앱의 역할표(대표·부관리자·member), 명시적 member 승격 이양·pointer 저장 실패 시 승격 rollback, 대표 자기 강등/탈퇴/계정 삭제409·이양 후 이전 대표403, 부관리자 일반 member 내보내기/본인 나가기와 기존 공유·업무 이동·로그아웃을 합성 자료로 확인하고 정리한다. 실제 업무 자료를 삭제 테스트에 쓰지 않는다.
-014 COMMIT 뒤 복구 기준 앱은 이번 PR107의 **새 정책 호환 코드** 이상이다. #106으로 돌아가면 팀 삭제/역할 변경 권한과 member 이양 계약이 달라지므로014 뒤 복구 앱으로 사용하지 않는다. 구버전 앱으로 돌아가거나 대표 데이터·제약을 자동 삭제하는 방식은 복구 절차가 아니다. 이미 커밋한 DB 변경 복구는 별도로 검토한 백업/서비스 계획을 따른다.

## 격리 DB 검증 방식

기본 CI DB에는 실제014를 적용하고 일반 통합/E2E를 실행한다.013의 NULL·구버전/marker 모의 계약2파일만 별도 Vitest `integration-013` 프로젝트에서 실행한다. 고유 `gm_lead_<32hex>_test` DB를001~013 원문 SQL로 초기화하고 테스트 후 정확한 그 DB만 종료한다. 기본014의 제약·ledger를 지우거나 전역 비활성화하지 않는다.

이 분리는010~012 함수의 고정 public search_path 때문에 필요하다. 단순 TEMP schema/search_path를 전환해 같은 API를 검증했다고 주장하지 않는다. DB helper는 입력 _test 접미·생성/삭제 대상 prefix·연결의 current_database를 확인하고 FORCE DROP이나 다른 DB 삭제는 하지 않는다. 이는 GHA 전용이며 공유 운영 호스트에서 실행하지 않는다.

실제013→014 업그레이드 검사는 매번 별도 DB에서 source bytes·revision/질문·게시본·공유·Reader 보존, 결정적 NULL backfill/기존 대표 보존, 무admin/잘못된 대표의 전체 rollback, backfill 뒤 DDL 이름 충돌42710의 전체 rollback, 실제 COMMIT 위반, 중간 NULL→정상 이양, 명시적 계정/팀 삭제, 직접 SQL 경합과 REPEATABLE READ 양방향을 검사한다. 별도 실제 앱 전환 검사는014가 잠금을 선점한 동안 createTeam 대기→COMMIT 후 대표 완성·구버전 writer 거부·실제 POST 이양·두 이양을 확인한다.

## PostgreSQL 근거와 한계

- [PostgreSQL18 CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html): constraint trigger는 AFTER ROW이며 검사 시점을 transaction 끝으로 지연할 수 있다. 검사 함수는 오래된 NEW 값이 아니라 현재 살아 있는 workspace를 재조회한다.
- [CREATE TABLE](https://www.postgresql.org/docs/18/sql-createtable.html): deferred NO ACTION FK는 최종 검사 때 남아 있는 참조를 검증한다. SET NULL/CASCADE로 대표를 조용히 없애지 않는다.
- [명시적 잠금](https://www.postgresql.org/docs/18/explicit-locking.html)·[Repeatable Read](https://www.postgresql.org/docs/18/transaction-iso.html): 행 잠금과 변경된 행의 스냅샷 충돌을 함께 고려한다. serialization 실패는 전체 TX를 처음부터 재시도해야 한다. membership이 workspace를 잠그기만 하는 초안은 반대 방향 RR 경합에서 member 대표를 commit하는 문제가 실제로 재현됐다. 같은 lead 값 UPDATE로 논리 데이터를 보존하면서 workspace tuple 버전을 바꿔 stale RR을40001로 중단한다.

RED cbafa7e/CI45309706059에서 기존224건 통과·역방향 RR1건 실패를 확인했다. stale RR 이양이 member를 최종 대표로 commit해버렸으며 FK만으로는 역할 스냅샷을 보호하지 못했다. 이후 workspace tuple 버전 갱신을 보완하고30명 batch/전체 팀 cascade의 trigger 비재귀와 논리 내용 보존도 검사한다. 추가한 DDL 이름 충돌 검사는 backfill 다음 ALTER 실패를 유도하고 기존 대표 값·업무 내용·이력13개·기존 constraint 보존 및 새 FK/trigger 부재를 확인한다. 후속 권한표 검증은013 기존 admin 권한·이양503과014 대표/부관리자 경계를 분리해 검사한다. 일반 member 대상 이양의 승격/pointer 원자성, 개인 세션 계정 삭제의 모든 소속팀 첫 잠금,13/14 대문자 UUID 자기 탈퇴, 대기 중 이전 대표403과 역할 변경의 유효한 직렬 순서를 확인한다. 최종 CI·검토 결과는 PR107의 최신 head를 따른다. 실제 운영014·복원·서비스 전체 부하·대표 화면 검증을 이번 격리 검증으로 대신하지 않는다.
