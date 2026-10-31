# 운영 DB·배포 경로 확인 및 Actions 용량 복구

실행일: 2026-10-31 KST. 사용자 요청: PR #25 병합 후 운영 배포·migration005 확인, GitHub 푸시 실패 조사와 후속 작업.

## 확인 결과

- Git 푸시·PR #25 병합은 성공했다. 실패한 것은 기본 브랜치 `f6ee13f`의 CI `41186806073`에서 배포 이미지 artifact를 업로드하는 단계다.
- 최초 및 재실행(attempt2) 모두 보안·단위·DB 통합·브라우저·접근성·빌드·Docker 이미지 생성/내보내기는 통과했다. 업로드만 `Artifact storage quota has been hit`로 실패했다.
- 운영 앱은 `653a2f8db3016ea9bdea3253d55d533049b4f5df`, 실제 image ID `sha256:35c845ccff8df2fabcec95bc496b434df733c6dddeb5f604d85b742358796735`다. **f6ee13f 앱 배포는 미완료**다.
- 시작 시 DB는 migration001~004, 약9.1 MiB·계정2개였고 파일 테이블은 없었다. 서버 디스크 여유3.3GB, 가용 메모리857MiB를 관찰했다. 지속 용량 보장은 아니다.

## 직접 완료한 작업

### 운영 migration005

1. root 전용 `/opt/ghostmanual/rollback-005-20261031`(0700)에 기존 Compose·환경 파일과 PostgreSQL custom-format 백업을 보존했다. 파일 내용·비밀 값은 출력하거나 Git에 넣지 않았다.
2. 백업 목록을 검사하고 별도 임시 DB에 실제 복원했다. 복원된 계정2개·기존 migration4개를 확인한 뒤 그 임시 DB만 삭제했다. 운영 DB를 복원 대상으로 사용하지 않았다.
3. 검증된005 SQL을 단일 트랜잭션에서 실행했다. 기존 migration runner와 같은 advisory lock, lock_timeout5초·statement_timeout60초 및 ON_ERROR_STOP을 적용했다.
4. 적용 후 migration001~005, 새 테이블3개(source_files·change_groups·revision_questions), 기존 계정2개를 확인했다. 기존 앱은 그대로 유지했다.

이 백업은 같은 서버의 migration 복구본이다. 별도 저장소·정기 백업·재해 복구 체계를 완료한 것은 아니다. 복구본은 정책 확정 전 삭제하지 않는다.

### GitHub 산출물 정리

저장소의 과거 이미지32개가6,207,727,109바이트를 차지했다. 최신2개(ID12711000357·12709780641)를 보존하고 더 오래된 생성 산출물30개만 삭제했다. 소스·커밋·실행 로그·다른 저장소·서버 이미지·롤백 복구본은 삭제하지 않았다. 정리 후2개·388,320,259바이트다. 삭제한 정확한 ID 목록은 작업 공간 `.omo/evidence/deployment-recovery/artifact-cleanup-manifest.json`에 보존한다.

정리 후 실패 job을 재실행했으나 attempt2도 quota 오류였다. GitHub 로그는 사용량 재계산6~12시간을 안내한다. 계정 전체 Actions 청구 사용량 API는 현재 인증 범위로 조회하지 못했으며 인증 범위를 임의 확대하지 않았다. 따라서 계정 전체 여유 용량과 과금 설정은 미확인이다.

CI 수정은 기본 브랜치 이미지 artifact의 보관7일→1일, 파일 부재 시 명시적 실패 두 항목이다. SHA별 artifact 이름·기본 브랜치 push 조건·CI 성공·digest 검증 계약은 유지한다. 1일 보관은 누적 완화이며 계정 quota를 즉시 또는 영구 해결한다는 보장은 아니다.

### 배포 기록·타이머

이전 deployed.json은661e925를 가리켰지만 실제 앱은653a2f8이었다. 기존 JSON을 위 root 전용 복구 폴더에 보존하고, 실제 실행 중인 앱의 SHA·image ID와 observed_at을 기록하도록 정정했다. 새 앱을 배포했다고 기록하지 않았다.

활성화 설정은 enabled이나 중지돼 있던 ghostmanual-deploy.timer를 재가동했다. CI 실패에서는 기다리고, schema/Compose 변경에서는 기존 수동 검토 gate를 유지한다. migration005를 적용했다는 사실만으로 이 gate나 artifact 검증을 우회하지 않았다.

## 취소한 로컬 대안

Actions quota로 로컬 이미지 생성·전송을 대안으로 시도했으나 사용자가 로컬 작업을 원하지 않는다고 지적하여 중단했다. 운영 앱 교체는 실행하지 않았고 전송 프로세스와 서버 임시 이미지·배포 스크립트를 정리했다. 이후 배포는 GitHub CI 이미지 경로로 진행한다.

그 과정에서 로컬 Docker의 오래된 소켓 폴더를 삭제 없이 백업 이름으로 보존해 시작 오류를 복구했다. Docker 데이터 디스크·인증·모델 라우팅은 변경하지 않았다. 이 로컬 환경 변경을 운영 배포 성공 근거로 사용하지 않는다.

## 남은 실행 조건

- GitHub의 Actions 용량 집계가 갱신되고 실제 여유가 있는지 확인한 후 `41186806073` 실패 job을 재실행한다. 반복 재실행으로 quota를 해결했다고 간주하지 않는다.
- CI가 최종 성공하고 동일 SHA의 artifact와 digest가 실제 생성됐는지 확인한다.
- 005 적용 사실과 protected tree 차이를 수동 검토한 후 CI 이미지로 앱만 교체하고 health·다른 컨테이너·터널·DB 보존을 확인한다. 현재 운영 앱은 기존653a2f8이다.
- API·화면·AI·매뉴얼 연결은 별도 담당 통합 작업이다. 엔진 병합과005 적용만으로 파일 버전 사용자 흐름이 구현된 것은 아니다.
