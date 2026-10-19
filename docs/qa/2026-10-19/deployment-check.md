# 디자인 배포 접속·공개 상태 직접 확인 — 2026-10-19 KST

**이 문서는 배포 전 실패 경로와 사전 공개 상태 이력이다.** 이후 사용자의 Windows Tailscale SSH에서 AWS100.97.248.52 접속·검증 이미지 확보·앱 단독 교체를 완료했다. 사용자 서버 사후 출력과 에이전트 공개8화면 검증은 [최종 배포 보고서](deployment-complete.md)를 따른다. 아래 미확인/미적용 문장을 현재 상태로 해석하지 않는다.

## 후속 정정: 인계 IP는 Windows 장비로 식별됨

사용자가 Windows에서 `tailscale ssh ubuntu@100.108.2.6`를 실행한 출력은 대상 이름을 `lostark-party-windows`로 식별했으며 `dial tcp 100.108.2.6:22` timeout과502를 반환했다. 배포 대상은 `lostark-party-aws`이므로 해당 IP를 AWS 서버 주소로 전제한 이전 TCP 허용 권고를 정정한다. 이는 사용자 실행 출력 근거이며 에이전트 직접 서버 실행이 아니다. 실제 AWS Tailscale IP는 아직 미확인이다. Windows에서 `tailscale status`로 AWS 장비의 IP·상태를 확인하고 `tailscale ssh ubuntu@lostark-party-aws`로 대상을 먼저 검사한다. 허용 목록의 다른 IP를 AWS 주소라고 추정하지 않는다.

아래 명령/오류는 실제 실행 당시 기록으로 보존한다. cloud proxy8088 연결 거부는 목적지 연결 전의 실패여서 당시에도 IP와 AWS 장비의 일치를 증명하지 못했다. Windows에서의 목적지22번 timeout은 이 cloud proxy 거부와 별개의 경로 관찰이다. Tailscale 인증 정책 거부·SSH 키 부재·앱 장애의 증거로 확대하지 않는다.

## 최초 직접 실행과 범위

사용자가 기존 서버 접속과 공개 사이트 업데이트를 승인하여 현재 클라우드에서 직접 실행했다. **서버 인증 전 TCP 경로가 차단되어 이미지 전달·앱 교체는 실행하지 못했다.** 아래는 이전 데스크톱 관찰을 재사용한 결과가 아니다. 단위·DB통합·E2E·전체 디자인 CI는 반복하지 않았다.

## GitHub 기준과 이미지

- 14:49 KST `git ls-remote`와 `git fetch origin feat/ghostmanual-mvp` 성공. 작업 시작 조회의 기본 브랜치는 `2580332719254f6b0c7f0c8c0faf2598beee016a`다. 이번 결과 문서·측정값·캡처를 추가하는 후속 commit은 배포 제품 소스와 구분한다.
- PR #3/#4/#5의 merge commit과 디자인 통합 `067b59edace52938e8e95bdbd488d845aaf2d2f4`가 기본 브랜치 이력에 있다. 제품 소스 `7efb284ea0d4efbf428fbdebbd51f290fceb7ccd`부터 기본 브랜치까지 차이는 Markdown 7개뿐이다.
- 검증 CI·이미지 태그/ID·ZIP digest는 [기존 이미지 기록](../2026-10-18/release-update.md)을 따른다. 이번에는 다운로드하지 못했으므로 ZIP 해시·Docker image ID를 새로 검증했다고 표시하지 않는다.
- `gh api repos/P-GISE/GhostManual/actions/artifacts/12134456501` 및 CI 조회는 종료1, `Get "https://api.github.com/...": Forbidden`으로 실패했다.
- `gh run download 39121617674 --repo P-GISE/GhostManual --name ghostmanual-image-7efb284ea0d4efbf428fbdebbd51f290fceb7ccd --dir /tmp/ghostmanual-artifact`도 artifact 목록 API에서 같은 오류로 종료1이다. 웹 artifact 주소의 GET은 HTTP404였으며, 이것만으로 만료·삭제·권한 문제를 구분하지 않는다.
- 14:51 KST 일반 HTTPS curl에서도 `curl: (56) CONNECT tunnel failed, response 403`, 프록시 응답 `HTTP/1.1 403 Forbidden`을 확인했다. Git HTTPS 조회 성공은 GitHub API 접근 성공을 뜻하지 않는다. API 자격 증명이 없다고 단정하거나 키 교체를 요구하지 않았다.
- 인계 만료 시각은 **2026-10-19 20:06:24 KST**다. 이번 조회는 그 전이지만 실제 `expired` 값은 API 차단으로 미확인이다. 만료를 근거로 CI를 재실행하지 않았으며, 다운로드/재실행 API 경로도 아직 사용할 수 없다. 추후 만료가 확인되면 같은 제품 SHA의 CI 이미지를 다시 준비하고 서버에서는 Next 빌드를 하지 않는다.

## 클라우드와 실제 SSH 경로

현재 상태 API는 running/connected, `observations_current=true`, network policy state는 `unknown`이다. 네트워크가 enforced 또는 VPN이 정상이라고 해석하지 않는다. 실행 환경의 지원 정책 파일은 version1, `vpn_configured=true`, TCP proxy `http://proxy:8088`, `tcp_network_access.domains=[]`, `ip_ranges=[]`다. HTTP 허용 목록에는 서버 IP가 있지만 raw TCP grant는 없다.

실행 명령과 비밀 값을 제거한 실제 결과:

```sh
curl --silent --show-error --verbose --connect-timeout 8 --max-time 12 \
  --proxy http://proxy:8088 --proxytunnel telnet://100.108.2.6:22
# 종료7: connect to 172.31.11.221 port 8088 ... failed: Connection refused
# curl: (7) Failed to connect to proxy port 8088 ... Could not connect to server
```

`lostark-party-aws:22`도 같은 CONNECT 경로에서 연결 거부였다. IP 요청은 `require_escalated` 실행에서도 동일했다. 실제 SSH도 다음과 같이 시도했다.

```sh
ssh -F /dev/null -o ConnectTimeout=10 -o ConnectionAttempts=1 \
  -o StrictHostKeyChecking=yes -o BatchMode=yes \
  -o 'ProxyCommand=curl --silent --show-error --no-buffer --connect-timeout 8 --max-time 15 --proxy http://proxy:8088 --proxytunnel telnet://%h:%p' \
  ubuntu@100.108.2.6 true
# 일반/require_escalated 모두 종료255:
# curl: (7) Failed to connect to proxy port 8088 ... Could not connect to server
# Connection closed by UNKNOWN port 65535
```

첫 SSH 실행은 로컬 `/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf`의 소유권/권한 오류로 중단됐다. 시스템 파일을 변경하지 않고 `-F /dev/null`로 그 로컬 설정을 제외한 뒤 위 실제 프록시 오류를 확인했다. SSH 호스트 키 검증은 끄지 않았다. 서버 SSH 배너·호스트 키·Tailscale 인증 단계에는 도달하지 못했다. 따라서 SSH 키 부재, Tailscale SSH 정책 거부 또는 Check mode 추가 인증 필요 여부를 실패 원인으로 단정하지 않는다. 인증 URL도 수신하지 못했다.

HTTP 프록시를 사용한 `curl --connect-timeout 8 --max-time 15 http://100.108.2.6:3200/`은 일반/권한 재시도 모두 **HTTP503**, `upstream connect error or disconnect/reset before headers. reset reason: connection timeout`이었다. 앱 바인딩이 loopback인 기존 구성에서 이 결과는 서버 내부 `127.0.0.1:3200` 점검을 대신하지 않으며, 앱 장애의 증거로 단정하지 않는다. HTTP 경로를 raw TCP 우회로 사용하거나 별도 VPN을 설치하지 않았다.

## 공개 HTTPS·글꼴·정렬·키보드 직접 점검

14:51 KST부터 실제 공개 origin을 Chromium 154로 검사했다. `/`, `/sources/new`, `/ask`, `/terms` 각각 **1440×900·390×844 총8화면**이다. GET/HEAD와 같은 공개 origin만 허용하고 공간 시작·자료 등록 등 쓰기 동작을 하지 않았다. 비GET 요청은0건이다. 전체 사용자 흐름 QA를 반복한 결과가 아니다.

| 항목 | 이번 직접 결과 |
|---|---|
| HTTPS | 8/8 HTTP200. curl TLS verify result=0, Chromium 인증서 검증 유지 |
| 가로 넘침 | 0/8 |
| 공통 정렬 | header/main/footer 왼쪽 기준선 차이0px. desktop main 폭1248px·좌우96px, mobile 폭390px·좌우0px이며 내부 여백은 별도다. 신규 최대1200px shell은 미적용 |
| 글꼴 | 8/8 computed font `Arial, "Malgun Gothic", sans-serif`. 로드된 FontFace·폰트 resource0, Pretendard 미로딩 |
| 키보드 | 첫 Tab은 ‘본문으로 이동’ 링크. Enter 후 `#main`으로 이동하지만 activeElement는 BODY, main 포커스0/8·tabindex 없음 |

공개 CSS `/_next/static/chunks/2hb3twf9u61xl.css`는 HTTP200·4465bytes, SHA256 `489d9755012c92af6bf0e21e383df3a88b738d44c199ca317842d2b40bbe932b`다. `@font-face`·Pretendard가 없다. 이 결과로 **새 글꼴·디자인·키보드 변경은 이번 공개 화면에 적용되지 않았음**을 확인했다. CSS 해시는 공개 자산 식별이며 서버 이미지 ID/전체 제품 소스의 암호학적 증명은 아니다. 실제 서버 build ID는 확인하지 못했다.

직접 실행은 `node /tmp/ghostmanual-public-check/check-public.mjs before`이며 최종 권한 재시도에서 종료0으로8화면 측정·캡처를 완료했다. `document.fonts.ready`, computed style·bounding rect, 실제 Tab/Enter 및 `document.activeElement`를 검사했다. 첫 일반 Chromium 실행의 `ERR_CERT_AUTHORITY_INVALID`는 실패로 구분했다. 최종 실행은 관리 CA 신뢰를 확인한 권한 실행 경로에서 상속 프록시·`ignoreHTTPSErrors=false`를 유지했다. 인증서 무시 인자를 사용하지 않았고 NSS 최종 목록도 기존4항목으로 유지됨을 확인했다. 실행 경로에 따른 인증서 오류 차이의 정확한 원인은 미확인이다.

Cloudflare Insights beacon의 CSP 차단과 context 종료 시 일부 Next GET prefetch 취소를 관찰했다. 이를 navigation 실패에 합산하거나 새로운 제품 장애로 단정하지 않는다. 로그인·DB 저장·공유·AI·실기기·전체 접근성 인증은 이 검사 범위가 아니다.

- [개인 본문/연락처·요청 token을 제외한 측정 결과](public-results.json)
- [공개 홈 desktop 캡처](public-home-1440x900.png) · [공개 홈 mobile 캡처](public-home-390x844.png)

## 변경하지 못한 서버 항목과 재개 조건

서버 셸 명령·Compose 명령을 실행하지 못했다. 여유 자원, 현재 앱/DB image ID·build ID·상태, 기존3000/3100 응답, 정리 타이머는 이번 직접 확인이 아니다. 서버 내부 롤백 이미지/설정 보존도 미실행이다. 기존58d9ebd 이미지 정보는 [2026-10-17 사용자 출력 기록](../2026-10-17/remote-deployment.md)으로만 남긴다.

DB·데이터·DNS·Cloudflare 로컬 관리 터널·3000/3100 서비스·AI 설정을 변경하지 않았다. 서버 변경이 없다는 사실과 각 서비스가 현재 정상이라는 보장은 구분한다. `/workspace/ghostmanual-update-design.sh`는 현재 환경에 없다.

확인된 설정 조치:

- 현재 draft를 읽고 기존 HTTP custom hosts와 preset을 보존하여 `api.github.com`만 추가했다. 저장 응답 `status=saved`, `requires_publish=true`; 재조회에서도 revision2와 해당 호스트를 확인했다. 초안 저장은 실행 환경 적용이 아니다. 환경 설정에서 검토·저장한 뒤 게시해야 하며, 적용 후 API 요청과 인증을 다시 확인한다. 비밀 바인딩/설치 스크립트/저장소/시작 지침은 변경하지 않았다.
- TCP 허용 대상은 `lostark-party-aws`의 실제 IP를 확인한 뒤 결정한다. 기존 `100.108.2.6/32` 권고는 위 사용자 Windows 실행 출력에 따라 철회한다. 현재 제공된 설정 도구의 스키마는 HTTP 도메인만 편집하며 TCP grant를 편집하는 기능은 없다. 올바른 TCP grant를 반영한 환경과 실제 `proxy:8088` listener가 필요하다. 설정이 반영된 환경에서도 연결 거부가 계속되면 운영자가 sidecar listener/VPN readiness를 조사해야 한다. 환경 삭제나 전체 인터넷 허용은 요구하지 않는다.
- Tailscale SSH 인증은 TCP가 열린 뒤 실제 응답으로 판단한다. Check mode 인증 URL이 나오면 그 URL과 절차를 안내한다. 새 SSH 키가 반드시 필요하다고 가정하지 않는다.

연결과 이미지가 확보되면 모든 Compose 명령에 `docker compose -f compose.yaml -f compose.no-logs.yaml --env-file .env`를 사용한다. 서버 내부에 이전 image ID/태그·compose·0600 설정을 보존하고 새 이미지 식별을 검증한 뒤 `up -d --no-deps app`으로 앱만 교체한다. 이번 변경에 migration은 없으며, 서버 빌드·`down -v`·전체 prune·터널 재생성은 실행하지 않는다.

## 기록 검증

이번 변경12파일의 Markdown 내부 링크80개·code fence 경계, JSON8측정과 집계의 일치, PNG2개의 signature/해상도와 `git diff --check`를 확인했다. 독립 reviewer가 원본 측정과 정제 JSON·CSS 해시·캡처를 대조하고 중요 지적 없음으로 보고했다. 이는 배포 성공 인증이 아니다. 제품 소스·테스트·workflow를 바꾸지 않았으며 기존 CI 전체 검사는 재실행하지 않았다. 이번 문서·공개 증거 추가를 이미지 생성/배포 완료로 해석하지 않는다.

위12파일 검증은 최초 기록commit5834d91의 범위다. 후속 IP 정정은PROJECT_GUIDE·99·이 기록에서 AWS 실제 주소를 먼저 확인하도록 반영하며, 제품이나 서버 설정을 변경하지 않는다.
