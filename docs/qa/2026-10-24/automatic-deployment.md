# GhostManual 자동 앱 배포

상태: 2026-10-24 구현·로컬 검증 중. 서버 설치와 GitHub CI·실제 배포 성공은 후속 실행 근거로 구분한다.

## 변경·영향·비용

- 운영 브랜치 `feat/ghostmanual-mvp`의 push CI 전체 성공 뒤 서버가 약 2분 간격으로 정확한 HEAD의 이미지를 확인한다. PR·실패·진행 중 CI는 배포하지 않는다.
- 서버의 기존 ubuntu GitHub 인증으로 읽기 API만 사용한다. 새 SSH 사용자·키·Tailscale/Cloudflare 정책·방화벽 변경은 없다. 기존 인증은 저장소 관리 권한도 가진 것으로 확인됐으므로 향후 읽기 전용 자격증명 분리는 별도 접근 정책 작업이다.
- 기존 `/opt/ghostmanual` Compose·환경설정·DB·볼륨·공유 터널은 유지한다. `.env`의 `GHOSTMANUAL_IMAGE`만 고정 이미지 ID로 갱신하고 app만 `up --no-deps --no-build --pull never` 한다. 교체 순간 짧은 재접속이 발생할 수 있다.
- 신규 유료 자원을 만들지 않는다. 기존 GitHub Actions 실행·artifact 7일 보관량, 서버의 이미지 저장공간·소량의 GitHub API 트래픽은 사용한다. 잔여 요금제·실제 청구 증가는 별도 청구 확인 대상이다.

## 검증 경계

CI에서 단위·DB통합·브라우저·접근성·빌드와 배포기 회귀를 통과한 이미지에 소스 revision label을 붙인다. 서버는 artifact ZIP SHA256을 GitHub API digest와 비교하고, 정확한 이미지 태그·revision·실행 사용자·CMD·runtime 파일 읽기를 확인한다. GitHub 공식 [artifact API](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10)와 [workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2026-03-10)의 필드를 사용한다.

현재 배포 SHA와 대상 SHA의 `db/`, `scripts/migrate.ts`, `compose.yaml` Git blob이 달라지면 앱 교체 전에 중단한다. 자동 경로는 migration·seed·cleanup을 실행하지 않는다. 앱 교체 후 두 홈페이지 HTTP200과 컨테이너 내부 `SELECT 1`만으로 실행 준비 상태를 확인하며, 전체 기능·실제 iPhone 성공의 증거로 확대하지 않는다. DB를 포함한 다른 컨테이너 식별·시작 시각·재시작·OOM과 공유 터널 PID/시작 시각도 보존 여부를 비교한다.

## 설치와 롤백

root 소유의 `/usr/local/libexec/ghostmanual-deploy-poll`에 검토된 `scripts/deploy-poll.py`를 설치하고, `/var/lib/ghostmanual-deploy`를0700으로 생성한다. `deployed.json`은 현재 실제 실행 SHA·image ID로만 초기화한다. 파일은0600, 실행 파일0750이며 unit/timer만 systemd에 설치한다. 사용자·sudoers·네트워크 접근 설정은 변경하지 않는다. 저장소 코드 변경이 서버 신뢰 배포기를 자동으로 교체하지 않는다.

앱 교체·health·상태 기록 중 오류가 발생하면 이전 이미지와 환경설정으로 app만 복귀한다. 실패 SHA는 반복 배포하지 않는다. 수동 복구는 새 timer를 비활성화하고 서버 내부 `previous-environment` 또는 `deployed.json`의 `previous_image`를 대조한 뒤 이전 앱 이미지로 `up --no-deps` 한다. DB 복원은 실행하지 않는다. timer 제거만으로 현재 실행 앱은 중지되지 않는다.

## 구현 검증

`scripts/test_deploy_poll.py`는 실패/PR/다른 SHA CI 거절, schema변경 차단, 동일SHA no-op, 실패SHA 재배포 차단, 환경설정의 이미지 항목만 갱신, 부분교체·health·보존 검사 실패 시 앱 복귀, no-deps 범위를 합성 대역으로 검증한다. 실제 서버 교체/rollback 실험과는 구분한다. Iron Laws 검사에서 오류를 숨기는 재시도·lock 처리를 안전한 상태 로그로 수정했다. 남은 낮은 심각도 지적은 이 서버 전용 고정 경로/URL과 배포 절차 함수 길이이며, 임의 설정 확장을 추가하지 않았다. Python LSP는 기존 미설치 상태로 설치하지 않았다.
