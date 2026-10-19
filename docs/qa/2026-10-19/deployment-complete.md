# 디자인·글꼴·키보드 개선 배포 확인 — 2026-10-19 KST

**검증된 제품 소스7efb284의 앱 단독 교체와 공개 변경 범위 확인을 완료했다.** 서버 명령은 사용자가 Windows의 Tailscale SSH 터미널에서 실행하고 출력을 제공했다. 공개 HTTPS·자산 해시·Chromium 검사는 에이전트가 현재 클라우드에서 직접 실행했다. 두 실행 주체를 구분한다. 제품 코드·DB schema·AI 설정은 변경하지 않았으며 기존 CI 전체 QA는 재실행하지 않았다.

## 접속 경로 정정과 이미지 확보

- 사용자 `tailscale status` 출력에서 **lostark-party-aws = 100.97.248.52, Linux**를 확인했다. 초기 인계 IP100.108.2.6은 Windows 장비로 식별됐다. 앞으로 Windows IP를 서버 허용 대상으로 안내하지 않는다.
- 사용자는 `tailscale ssh ubuntu@lostark-party-aws`로 Check mode 추가 인증을 마치고 Ubuntu24.04.4에 접속했다. 인증 URL·개인 계정 정보는 기록하지 않는다. SSH 키가 반드시 필요하다는 가정 없이 실제 인증 성공을 확인했다.
- 현재 클라우드에서는 올바른100.97.248.52에 대한 SSH도 `proxy:8088` 연결 거부로 인증 전 실패했다. GitHub API도 프록시 Forbidden이었다. 이 플랫폼 경로 자체가 복구됐다고 표시하지 않는다. [초기 실패 명령](deployment-check.md)은 당시 이력으로 보존한다.
- 사용자의 PC 브라우저에서 GitHub 로그인 전에는404와 Sign in이 표시됐고, 로그인 후 기존 artifact를 다운로드했다. 만료로 단정하거나 새 CI/이미지 빌드를 실행하지 않았다. 이미지 재준비는 이번에 필요하지 않았다.

| 식별 항목 | 확인 값·근거 |
|---|---|
| 제품 소스 | `7efb284ea0d4efbf428fbdebbd51f290fceb7ccd` |
| 기존 검증 CI | [39121617674](https://github.com/P-GISE/GhostManual/actions/runs/39121617674) |
| 다운로드 artifact | [12134456501](https://github.com/P-GISE/GhostManual/actions/runs/39121617674/artifacts/12134456501) |
| ZIP SHA256 | `46202fbd2c3225d42b7a0d5f70692141e755300db92ce0a8c8cff0b223a395e7` — 사용자 PC 출력, 인계 digest와 일치 |
| 내부 tar.gz SHA256 | `54e109ce880f51c71f1ef7a828187e8d56371e2ff6e490eadfc7f684c4b3329b` — PC와 서버 `sha256sum --check: OK` 일치 |
| 앱 태그 | `ghostmanual:7efb284ea0d4efbf428fbdebbd51f290fceb7ccd` |
| OCI manifest digest·서버 표시 image ID | `sha256:87e67bb88bd4e7a0f83a3abc8906810f010f36e9cb80e7127eb1b1deea4d19c8` |
| OCI config digest | `sha256:5a71fdca04de1d055ff82ce316c3435b0331c8746e9f71886a6aac708fecb69c` |
| 실행 Next build ID | `5y9UxUDQ-Nt-MqGbXQUOK` |

사용자는 기존 인증된 Tailscale SSH 경로의 바이너리 stdin으로 archive를 `/tmp/ghostmanual-7efb284.tar.gz`에 전송했다. 서버에서 해시 대조 후 `docker load`를 실행했다. 처음에는 인계의 ‘이미지 ID’5a71…와 서버87e67…가 달라 교체를 보류했다. 아카이브 `index.json`의 참조 blob을 실제 SHA256으로 검증한 사용자 Python 출력은 **REF87e67… → CONFIG5a71…**였다. 서로 다른 산출물이 아니라 동일 OCI 이미지의 manifest/config라는 관계를 확인하고 진행했다. 과거의 ‘이미지 ID5a71…’ 표기를 config digest로 정정한다. 이 검증을 재현 빌드·서명/attestation 검증으로 확대하지 않는다.

## 사전 상태와 롤백 보존

사용자 출력에서 가용 메모리702MB, 디스크8.2GB, 기존 앱58d9ebd·DB healthy와 기존 서비스 컨테이너 실행을 확인했다. 앱83.68MiB/384MiB, DB38.69MiB/128MiB를 관찰했다. 지속 부하 용량 보장은 아니다. 3000·3100·3200은 교체 전 모두 HTTP200이었다.

- 서버 내부 백업: `/opt/ghostmanual/rollback-20261019-7HCVGJ` (root 전용 디렉터리).
- `.env`, `compose.yaml`, `compose.no-logs.yaml`, 이전 이미지 식별·DB container ID·전체 컨테이너 ID 목록과 HTTP 사전 응답을 보존했다. 비밀 설정 사본은 서버 내부에만 있다. DB dump·데이터 snapshot은 만들지 않았다.
- 이전 이미지는 `ghostmanual:rollback-20261019T065254Z`로 추가 태깅했다. 이전 실행 태그는58d9ebd이며 이전 image ID도 서버 백업의 `previous-image-id`에 기록했다. 그 파일의 값은 이번 대화에서 별도 출력받지 않았으므로 과거419ee… 인계 값을 새 조회값으로 쓰지 않는다.
- 첫 교체 시도는 `.env` 소유자가ubuntu이고 모드600인 상태에서 root 소유자 검사에 걸렸다. 이미지 교체 전에 중단했고 기존 설정이 복원됐으며, 구 앱이 running인 것을 사용자 출력으로 확인했다. 현재 파일과 보존본의 소유자를root로 수정한 뒤 `mode=600 owner=root:root type=regular file`을 확인하고 재실행했다.

## 앱 단독 교체와 서버 사후 확인

모든 Compose 명령은 아래 구성을 사용했다. config는 `--quiet`로만 검증했다.

```sh
docker compose -f compose.yaml -f compose.no-logs.yaml --env-file .env
```

`.env`의 `GHOSTMANUAL_IMAGE` 한 항목만 바꾸고 원자적으로0600 파일을 교체했다. `up -d --no-deps app`을 실행했다. Docker/Next 서버 빌드·migration·DB 재생성·`down -v`·전체 prune·터널/DNS 재구성은 수행하지 않았다. 최초 권한 검사 실패의 복원은 확인했지만, 성공한 새 앱을 구 앱으로 되돌리는 추가 롤백 리허설은 하지 않았다.

사용자는 새 앱 Started, `AI_ENABLED=false`, 위 build ID를 제공했다. 마지막 `DEPLOY_OK` 문구는 수신하지 못해 그 문구를 성공 근거로 쓰지 않았다. 대신 다음 별도 읽기 전용 사후 검사 출력을 받아 실제 상태를 확인했다.

| 항목 | 사용자 서버 출력 |
|---|---|
| 앱 | 새7efb284 태그·image ID87e67…, running, OOM=false, restarts=0 |
| 앱 포트 | `127.0.0.1:3200 → 3200/tcp` |
| DB | image ID882236b…, running, healthy, OOM=false, restarts=0 |
| DB 포트 | `ports={}` — 호스트 바인딩 없음 |
| DB identity | `DB_CONTAINER_UNCHANGED=True` — 백업의 container ID와 동일 |
| 기존 컨테이너 | `OTHER_CONTAINERS_PRESERVED=True` — 사전 목록 중 앱을 제외한 모든 ID가 실행 중 |
| 기존3000·3100과 앱3200 | 각각 HTTP200 |

이 검사는 기존 DB 컨테이너·저장 구성을 보존한 근거다. 방문자 원문을 읽거나 새 게시/공유·데이터 저장 흐름을 반복하지 않았으므로 데이터 전체의 비트 단위 동일성/새 DB 기능 QA를 주장하지 않는다.

서버 출력의 비밀 값 없는 식별·상태 필드는 [정제 서버 근거](server-deployment-evidence.json)에 보존한다. 인증 URL·계정 연락처·비밀 설정 본문은 포함하지 않는다.

## 공개 변경 범위 직접 검증 — 16:19 KST

`node /tmp/ghostmanual-public-check/check-public.mjs after`로 실제 공개 `/`, `/sources/new`, `/ask`, `/terms`를1440×900·390×844에서 확인했다. 최종 권한 실행 종료0, **8화면 모두 HTTP200**이다. GET/HEAD·동일 origin만 허용했고 비GET 요청0건, 사용자 공간/자료 생성0건이다.

| 항목 | 직접 측정 결과 |
|---|---|
| Pretendard | 실제 FontFace `pretendard` loaded8/8, computed font의 첫 글꼴과 폰트 resource 확인 |
| 공통 정렬 | header/main/footer 기준선 차이≤2px, 좌우 여백 차이≤2px. desktop main 최대1200px·좌우120px |
| 모바일 | 가로 넘침0/8, 홈 시작 버튼 desktop/mobile 모두 viewport 안에 완전히 노출 |
| 본문 이동 | 첫 Tab의 링크에서 Enter 후 main 포커스8/8, tabindex=-1, outline solid3px·offset -3px |
| HTTPS·헤더 | curl HTTP200·TLS verify=0, private/no-store·CSP font-src self·no-referrer 유지 |

실제 공개 WOFF2 `/_next/static/media/PretendardVariable-s.p.0ztvx5mb7lxp4.woff2`는2057688bytes·`wOF2` signature와 SHA256 `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`가 원본과 일치한다. 공개 `/fonts/Pretendard-LICENSE.txt`도 HTTP 성공이며 저장소 원문과 바이트가 동일하다. CSS `/_next/static/chunks/1r1cnh6vkqe5v.css`는10882bytes·SHA256 `87c1b32e32c46eefbb1493233243dd692efd29e718a5fbf73e3cce3ce2790ac0`, font-face와 Pretendard 선언을 포함한다.

일반 Chromium 실행은 `ERR_CERT_AUTHORITY_INVALID`로 실패했다. 같은 명령의 권한 실행은 상속 프록시와 `ignoreHTTPSErrors=false`를 유지해 완료했다. 인증서 검증을 끄지 않았다. Cloudflare beacon CSP 차단과 종료 시 GET prefetch 취소는 별도 관찰이다. CSS의 `src:local(Arial)`인 `pretendard Fallback` FontFace는 검사 환경에서error였으며, 실제 사용한 Pretendard loaded8/8·WOFF2 검증과 구분한다. 이번에 제품 글꼴 코드를 추가 변경하지 않았다.

- [정제된 공개 사후 측정·자산 digest](public-after-results.json)
- [desktop 홈](public-after-home-1440x900.png) · [mobile 홈](public-after-home-390x844.png) — 본문 이동 후 포커스 테두리를 표시한 캡처
- [사전 측정·실패 경로](deployment-check.md)

전체 단위41·DB통합40·E2E24·디자인/접근성42개는 기존 CI 근거이며 이번에는 반복하지 않았다. 실제 휴대폰/화면 낭독기·전체 WCAG 인증·지속 부하·실제 AI는 이번 범위가 아니다. AI 비활성·DB·데이터·Cloudflare 로컬 관리 터널·DNS·기존 서비스 경계를 유지했다.

## 기록 검증

변경15파일(Markdown11·JSON2·PNG2)의 내부 링크126개, 코드 블록 경계, 공개8화면 측정의 집계/개별값과 서버 식별의 일치, PNG signature/해상도, 새 기록의 비밀 URL/계정 연락처 미포함과 `git diff --check`를 검사했다. 제품 코드·테스트·workflow 변경은 없다.

독립 reviewer가15개 변경의 출처 구분, 원본 측정/자산 해시/캡처 일치와 링크126개를 읽기 전용 검토해 중요 지적 없음으로 보고했다. 이 문서 검토를 서버 직접 실행이나 추가 제품 QA로 집계하지 않는다.
