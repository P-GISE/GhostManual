# PR #53 관리자 migration 검토·운영 적용 — 2026-11-05

사용자 요청으로 PR #53의 `006_admin.sql`을 검토하고 운영 DB에 적용했다. PR 코드 병합·관리자 계정 생성/승격·ADMIN_EMAILS 설정·앱 재배포는 이 작업에서 하지 않았다. DB 구조가 준비된 것과 관리자 화면 사용 가능 상태는 다르다.

## 고정 대상과 검토

- PR head `3f7284ecc970b3afdf6d2987388dff186a8c7a14`, SQL SHA256 `e0a2885d97b1d4fbcfc02ec35c74886106fe9632a6d0eedd4f439661b6e270a2`를 읽고 실행 직전 동일 head를 재확인했다.
- users에 is_admin=false, ai_allowed=true, nullable storage_limit_bytes(1MiB~1GiB)를 추가하고 admin_events 및 날짜 인덱스를 생성한다. 기존 사용자 승격·계정 생성 DML은 없다.
- 기존 소유자 ghostmanual과 앱 ghostmanual_app의 기본 ACL을 유지했다. 새 이력 표는 앱 CRUD 상속이므로 불변 보안 감사 로그라고 주장하지 않는다. 앱의 DDL·SUPERUSER·CREATEROLE·CREATEDB 권한은 없다.
- 문서 엔진 migration은 별도 `007_document_formats.sql`로 분리했다. PR #53의 브랜치/파일은 수정하지 않았다.

## 격리 검사와 백업

동일 PostgreSQL18.4 이미지의 무네트워크·포트/운영 볼륨 없는 tmpfs 컨테이너에서001~005와 동일 앱 역할 설정 후 정확한006을 적용했다. 트랜잭션 롤백·기존 사용자/기본값 보존·용량 check 경계·새 표 권한·앱 DDL 거부·FK SET NULL/CASCADE를 통과했다. 실제 업무 자료나 계정은 사용하지 않았다.

09:29 KST 기존 승인 백업 서비스를 새로 실행해 S3 backup OK·서비스 종료0을 확인했다. 덤프79539bytes, SHA256 `b2478b46a1d352db697472054ff00fb6ac2642062374d309a81b02a8ce9a6e8a`. 복원 방식/보존은 기존 백업 정책을 유지한다.

## 적용 결과

첫 실행은 추가한 보존 검증문의 변수명 충돌로 실패했다. 단일 트랜잭션이 전체 롤백되어 이력006·신규3컬럼·신규표가 모두 없는 원래 상태임을 확인했다. 수정한 전체 guarded SQL을 격리 DB에서 다시 통과시킨 뒤09:33 KST 정상 적용했다.

실행은 관리자 소유자로 advisory lock782401·lock_timeout3s·statement_timeout30s·단일 트랜잭션으로 했다. 동일 잠금 안에서 기존 사용자 JSONB 지문/건수를 전후 대조하고 추가 필드의 기본값과 앱 DDL 거부를 확인했다. 원문/개인 연락처/비밀번호를 로그에 기록하지 않았다. schema_migrations에006_admin.sql이 기록됐고007은 미적용이다. 앱 재시작 없이 홈200·미인증 /api/me401을 확인했다.

적용 전 트랜잭션 실패는 안전하게 롤백했지만, 정상 COMMIT 후 새 이력이 쓰인 상태에서 컬럼/표를 삭제하는 down 작업은 데이터 손실이 있어 별도 검토 대상이다. 이번에 수행하지 않았다.

## 실행 근거

원격 작업 트리 `.omo/multiformat/pr53-admin006-*`에 exact SQL/독립 검토·격리 검사·사전 백업·첫 롤백 상태·수정 batch 검사·운영 적용 결과를 보존한다. `pr53-admin006-production-result.json`과 `pr53-admin006-production-apply-green.log`가 최종 결과다. [PR #53](https://github.com/P-GISE/GhostManual/pull/53)의 향후 병합과 관리자 지정을 자동 완료로 해석하지 않는다.
