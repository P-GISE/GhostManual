# 디자인 공개 업데이트 준비 — 2026-10-18 KST

2026-10-19 후속: 기본 브랜치2580332에서 PR #3/#4/#5 통합을 확인했다. 현재 클라우드의 실제 SSH는 proxy8088 연결 거부로 인증 전 실패했고 artifact API도 프록시403이다. 공개 Chromium8화면은 HTTP200이지만 새 글꼴·키보드 변경 미적용이다. 새 이미지를 확보/검증하거나 서버 앱을 교체하지 못했다. [최신 직접 실행·오류·측정·재개 조건](../2026-10-19/deployment-check.md)을 따른다. 아래 연결 상태는 10월18일 당시 이력이다.

사용자의 ‘업데이트 해’ 요청에 따라 디자인·키보드 개선의 GitHub 통합과 기존 서버의 앱 이미지 교체를 준비한다. AI는 비활성으로 유지하고 DB·DNS·Cloudflare 로컬 관리 터널은 변경하지 않는다.

## 소스와 CI

- 제품 소스: `7efb284ea0d4efbf428fbdebbd51f290fceb7ccd`.
- [CI 실행](https://github.com/P-GISE/GhostManual/actions/runs/39121617674).
- 첫 디자인 CI는 원본 버전 표시의 옛 영문 문구를 찾는 두 테스트가 desktop/mobile에서 각각 실패했다. 실제 표시인 ‘원본 자료 · 버전 2’로 기대값을 고쳤다. 저장·재검수·기존 초안 이동 검사는 그대로 유지한다.
- 위 CI 전체 success. 직접 조회한 job 로그에서 단위41/41·PostgreSQL 통합40/40·E2E24/24·디자인/접근성42/42와 lint·타입·빌드·Docker 이미지 생성 성공을 확인했다.
- 배포 이미지: `ghostmanual:7efb284ea0d4efbf428fbdebbd51f290fceb7ccd`.
- CI 이미지 ID: `sha256:5a71fdca04de1d055ff82ce316c3435b0331c8746e9f71886a6aac708fecb69c`.
- [이미지 artifact](https://github.com/P-GISE/GhostManual/actions/runs/39121617674/artifacts/12134456501):191152491bytes. ZIP artifact digest는 `sha256:46202fbd2c3225d42b7a0d5f70692141e755300db92ce0a8c8cff0b223a395e7`이며 Docker image ID와 구분한다. 만료2026-10-19 11:06:24 UTC.
- PR #3/#4는 기본 브랜치 `feat/ghostmanual-mvp`에 순서대로 merge했다. PR #5도 같은 기본 브랜치를 대상으로 통합한다. 이 기록을 포함하는 후속 문서 변경은 제품 소스를 바꾸지 않는다.

## 서버 연결 상태

이번 환경 상태 조회: observations_current=true, network policy=enforced/restricted, outbound identities·secrets·runtime variables 없음. 로컬 정책에는 vpn_configured=false, TCP 허용 대상 없음. SSH agent와 SSH 키도 연결되어 있지 않다. 공개 도메인은 현재 HTTP 허용 목록에 없다. 이전 환경의 연결/권한 준비 상태를 현재 상태로 재사용하지 않는다.

따라서 이번에는 아직 서버 접속·이미지 교체·공개 화면 검증을 실행하지 않았다. 기존 실행 이미지58d9ebd와 원격 상태는 [이전 인계 기록](../2026-10-17/remote-deployment.md) 기준이며 이번 직접 조회가 아니다.

## 연결 후 앱만 교체

1. 성공한 위 CI의 `ghostmanual-image-7efb284ea0d4efbf428fbdebbd51f290fceb7ccd` artifact를 내려받고 압축 해제한 `ghostmanual-image.tar.gz`를 서버로 전달한다. artifact 보관 기간은 현재 CI 설정상 1일이다. 만료되면 같은 소스의 검증 실행/이미지를 다시 준비한다.
2. 기존 `ubuntu@lostark-party-aws` 접속으로 `/opt/ghostmanual`에서 여유 자원·기존 앱/DB·3000/3100 서비스 상태를 확인한다. `.env` 값과 인증 정보는 출력하지 않는다.
3. 현재 앱 컨테이너의 image ID와 앱 이미지 이름을 서버 내부 롤백 기록으로 보존한다. 전달한 archive의 이미지가 위 소스 태그인지 `docker load`와 `docker image inspect`로 확인한다. 서버에서 소스를 빌드하지 않는다.
4. root 전용 `.env`의 `GHOSTMANUAL_IMAGE`만 검증된 새 이미지로 바꾼다. 다른 값과 파일 권한0600을 유지한다. 모든 Compose 명령에 `-f compose.yaml -f compose.no-logs.yaml --env-file .env`를 적용한다.
5. Compose config는 `--quiet`로 확인하고 `up -d --no-deps app`으로 앱만 교체한다. 디자인 변경에는 DB migration이 없으며 DB 서비스를 재생성하지 않는다.
6. loopback3200 응답, 새 컨테이너 image ID·build ID, 글꼴 응답, 공개 desktop/mobile 정렬·키보드 이동을 확인한다. 기존3000/3100 서비스와 DB 상태도 전후 비교한다. 실패하면 보존한 이전 앱 이미지로 같은 방식으로 되돌린다.

원격 완료 근거를 확보하기 전 공개 업데이트 완료로 표시하지 않는다. `down -v`, host-wide prune, 터널 재생성은 실행하지 않는다.
