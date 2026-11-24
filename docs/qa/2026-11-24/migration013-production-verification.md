# PR #105 운영 migration013 검증

- 실행: 2026-11-24 10:03 KST. 사용자 명시 승인·인프라 작업 창 조율 후 수행하고 창 반환.
- 소스: 병합20b824b66df7c7acd3c597de68d4ba447d98fa87, 병합 후 [CI45300404907 success](https://github.com/P-GISE/GhostManual/actions/runs/45300404907).
- SQL: `ALTER TABLE workspaces ADD COLUMN lead_user_id uuid;`, 파일 SHA256 `18d771d3948a2cc1b76d261b4248aa77afbffa9b2934924e35b7d5fb600de2ba`.
- 사전: 실제 deploy.lock flock 획득·배포/복구 마커 부재·배포 timer inactive·기존 이력001~012와 열 부재 확인. 신규 systemd S3 백업 성공과 저장 SHA256 checksum 대조. 이번에 복원 시험은 하지 않음.
- 원자성: REPEATABLE READ·migrator 공통 advisory lock·workspace 잠금·lock timeout5초/statement timeout30초 안에013과 ledger를 한 TX로 커밋. 검증 실패 시 rollback. 첫 검증 문자열 오류는 rollback 후12개 이력·열 부재 확인, 수정 재시도.
- 보존: ledger 제외 public26개 테이블의 행 수·행별 SHA256 정렬 집계가 전후 동일. workspaces는 새 lead_user_id 필드만 지문에서 제외. UUID nullable·default 없음과7workspace lead NULL 확인. 대표 지정/backfill 없음.
- 권한: 앱의 인증 이동 wrapper EXECUTE=true, 직접 이동 함수 EXECUTE=false, schema_migrations SELECT=true 유지.
- 런타임: 앱/문서 큐 워커070e649·이미지9fe95616…·컨테이너 ID·시작 시각·배포 영수증 불변. 공개 로그인200, 미인증 api/session401. 앱 배포·재시작·worker 교체·OCR·환경/Compose 수정 없음.
- 증거: 서버 root 전용 `/var/lib/ghostmanual-deploy/event/pr105-migration013-20261124/`의 backup.txt·reviewed-transaction.sql·transaction.txt·complete.json. 업무 내용·세션·백업 key/개인정보는 Git에 기록하지 않음.

013은 확장 완료이며 대표 기능 활성화가 아니다. Task2 코드는 별도 검증하며014·제약/backfill·구버전 writer 종료·새 앱 운영 반영은 수행하지 않았다. 이후 앱 배포 때 새 migration 파일의 보호 트리 해시를 별도 검토해야 하며 이번 SQL 적용으로 배포 보호 기준을 완화하지 않았다. 화면/E2E·서비스 전체 부하를 재실행하지 않았다.
