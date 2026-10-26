# 외부 네트워크의 새 방문자 시작 검사

## 범위와 현재 상태

**현재 변경은 offline-only 진단 준비이며 아직 push하지 않았다.** 최초 기준 소스는 `4dc281b8767169a5510f1b3681062fa72486d4f8`. 이전 검사 소스 `f92b811eafbf02e0003ed7770cb21a71d37b29d0`의 [일회성 실행](https://github.com/P-GISE/GhostManual/actions/runs/40300671950)은 부분 실패했다. Chromium 합성 예제는 생성201·쿠키·세션200·목록200·UI가 통과했지만 빈 공간은 생성 응답 미확인(status0)이며 POST는 0~1회로 불확실하다. WebKit은 공개 접속 전 합성 fixture에서 실패하여 공개 단계가 생략됐다. WebKit의 웹사이트/Safari 실패로 해석하지 않는다.

제품/API/운영 설정은 변경하지 않는다. 사용자 컴퓨터나 외부 Chromium의 성공을 지인의 성공으로 확대하지 않는다. 2026-10-26 13:58 iPhone Safari 오류는 최신 진단 배포 전의 관측이며 실제 기기의 iOS/Safari 버전은 미확인이다.

후속 offline 실행 `40303176102`(소스 `96265b8`)에서 Chromium은 통과했고 WebKit은 `reason=none resource=none attempts=0 approved_sent=0 fixture_allowed=0`이었다. 생성 POST가 route까지 도달하지 않아 이번 실패를 XHR resource 분류 차단으로 설명할 수 없다. 공개 job은 skipped였다. 이제 합성 fixture에만 ready/callable/called/wrapped, click 완료 여부, allowlist JS/action 오류 종류를 추가했다. 오류 원문을 읽거나 출력하지 않고 추측으로 fetch 제한을 완화하지 않는다.

그 다음 offline 실행 `40304445895`(소스 `e5f6b45`)은 WebKit `ready=yes callable=yes called=no wrapped=yes click=failed js_error=none action_error=timeout`이었다. 함수 준비·fetch wrapper 설치 표시는 있으나 2초 click이 완료되지 않아 생성 요청 전 멈췄다. 현재 추가 변경은 locator count(zero/one/many/unknown)·visible/enabled만 기록하고 click 제한만 공개 검사와 같은20초로 맞춘다. 응답이 없는 부정 시험은 여전히2초다. 원인이 label/표시/활성/실행 지연 중 어느 것인지 확정하지 않으며 force click·JS 함수 직접 호출을 사용하지 않는다.

GitHub 표준 `ubuntu-24.04` 호스팅 runner에서 Chromium 기본 데스크톱 프로필·고유 User-Agent와 WebKit의 iPhone 13 화면·터치 프로필을 각각 실행한다. Chromium을 Google Chrome 전체 제품과 동일하다고 부르지 않으며 WebKit도 **실제 iPhone Safari 또는 지인의 기기 재현은 아니다.** GitHub 호스팅 토폴로지를 근거로 사용자 PC와 다른 실행 네트워크를 사용한다. 외부 IP 확인 서비스를 호출하거나 IP·메일·전화번호를 수집하지 않는다. 우회 프록시·stealth·User-Agent 임의 변경은 사용하지 않는다.

## 현재 실행 차단과 후속 검토

- 다음 push 또는 수동 `phase=offline` 실행은 **preflight 두 엔진만** 실행한다. 공개 작업은 `needs: [preflight]`와 명시적 `if: false`로 비활성화했다. 해당 작업에는 공개 검사 실행 명령도 없다.
- CLI live 경로도 `workflow_dispatch`, `PUBLIC_ENTRY_PHASE=live-reviewed`, 기존 정확한 repo/branch/attempt/승인 값이 모두 필요하다. 현재 workflow는 live phase 또는 승인 값을 주입하지 않는다. 이후 공개 실행에는 두 offline 엔진 성공과 별도 예산 검토·소스 변경·검토가 필요하다.
- 최초 실행의 공개 공간 생성201 확인은 1회, 추가 미확인 POST는 최대1회다. 이전 최대4 승인값을 다음 실행에 자동 재사용하지 않는다. 새 공개 검사 대상과 잔여 예산은 담당자가 결과를 검토해 결정한다.

## 최초 검사의 요청 경계와 유지되는 안전 조건

- 정확한 `codex/ghost-public-entry-check-20261026` 브랜치만 사용하며 PR·정기 실행은 없다. 최초에는 push가 공개 검사를 시작했으나 현재는 그 경로를 제거했다. 재실행 attempt는 차단한다.
- 최초 실행은 엔진 2개 × 빈 공간/합성 예제 2개 = 최대4개 합성 공간 계획이었다. 각 경우 독립된 빈 브라우저 context이며 생성 버튼은 한 번만 누른다. route에서 해당 mode의 정확한 POST 한 번만 통과시키고 중복 POST·다른 쓰기 요청을 차단한다. 실패 시 생성 재시도나 DB 삭제는 하지 않는다.
- 고정 대상은 `https://ghostmanual.pigs0516.com`뿐이다. 다른 Origin 요청은 차단한다. Tailscale·로그인·사용자 인증 정보·업무 자료·메일 발송·AI 기능을 사용하지 않는다.
- API 요청은 문서의 native fetch에 `redirect: error`만 강제한다. 정확한 4개 API 경로의 fetch만 허용하고 POST navigation·XHR·worker 요청은 거절한다. API 응답·Set-Cookie는 APIRequestContext로 중계하지 않으므로 브라우저의 실제 쿠키 저장·전송 경로를 유지한다.
- 페이지·정적 자원 GET/HEAD는 요청마다 새로 만든 **브라우저와 별개인** APIRequestContext에서 `maxRedirects: 0`, `maxRetries: 0`로 읽는다. 3xx 또는 gm_owner/gm_reader Set-Cookie가 있으면 브라우저에 전달하지 않고 중단한다. 응답과 별도 cookie jar는 즉시 폐기한다. 이 경로는 브라우저의 페이지/자산 TLS 전송까지 그대로 재현하는 검사가 아니며 API 쿠키 흐름과 구분한다.
- 공간 생성 201→JSON 해석→gm_owner 쿠키 Secure/HttpOnly/SameSite=Lax/Path=/→session 200 및 owner/만료시각 일치→`/manuals` 이동→manuals/sources 200 및 배열→정상 UI를 별도로 확인한다. blank는 빈 목록, example은 합성 목록을 확인한다.
- 오류 메시지·응답 본문·URL 식별자·쿠키 값·session ID·문서 내용은 출력하지 않는다. 고정 engine/mode/stage/status/pass-fail만 로그로 남긴다. screenshot·trace·video·HAR·storageState·다운로드·artifact 업로드는 없다. 런타임 메모리의 응답/쿠키는 context 종료로 폐기한다.
- 추가 진단은 allowlist의 guard reason·resource type 및 attempts/approved_sent/fixture_allowed 정수뿐이다. attempts는 생성 POST가 route에 들어온 횟수, approved_sent는 native API 전송을 허용한 횟수로 **서버 수신/DB 생성 확정 수가 아니다.** fixture_allowed는 합성 응답 허용 횟수이며 공개 요청 수가 아니다. 생성 시도0과 guard 차단을 구분한다. 현재 fetch 이외 API resource는 계속 차단하며, WebKit의 실제 분류는 offline CI 증거를 확인하기 전 추정으로 남긴다.

## 실행 환경 고정 근거

lock의 `playwright`, `@playwright/test`는 1.63.0이다. 공식 [Playwright Docker 안내](https://playwright.dev/docs/docker)는 브라우저/시스템 의존성이 이미지에 포함되며 Node 패키지는 별도로 설치하고 버전을 맞추라고 명시한다. 따라서 apt 또는 `--with-deps` 설치를 실행하지 않는다.

2026-10-26 공식 [MCR v1.63.0-noble manifest](https://mcr.microsoft.com/v2/playwright/manifests/v1.63.0-noble)를 직접 GET하고 Docker-Content-Digest 및 응답 원문의 SHA256을 대조했다.

- OCI index: `sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`.
- linux/amd64 child: `sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7`.
- workflow는 tag+불변 index digest로 고정한다. Node24.20.0과 checkout/setup-node는 기존 저장소의 정확한 commit pin을 유지한다. 기존 런너/무료 공개 CI 범위이며 새 유료 자원을 만들지 않는다.
- 기본 root 컨테이너에서 신뢰하는 본인 사이트를 검사하므로 Chromium sandbox 제약을 수용한다. 전용 일회성 runner에 별도 서비스 비밀을 주입하지 않고 checkout 자격을 저장하지 않는다.

## 로컬 검증과 한계

`node scripts/public-entry-check.mjs --self-test chromium`은 실제 로컬 Chrome에서 두 종류의 검사를 한다. 첫 7개는 route 합성 응답으로 빈 공간·합성 예제 성공, 쿠키 없음, session401, manuals401, 생성 JSON 오류, 중복 POST 차단을 확인한다. 이어 실제 loopback HTTP 서버 두 개로 307/308×동일/다른 Origin의 POST 4개와 정적 자원/페이지 이동 8개에서 후속 요청 0을 확인한다. 비API 응답의 쿠키 주입 차단, 실제 native POST201→HttpOnly 쿠키→session200, 중복 POST 및 XHR POST 차단도 확인한다. 후자의 테스트는 실제 HTTP이며 HTTPS Secure 쿠키 검증으로 확대하지 않는다.

합성 fixture 진단 회귀 2개를 더해 총9개가 됐다. 의도적 script 구문 오류는 ready/callable/called=no·wrapped=yes·js_error=syntax, click handler 누락은 ready/callable=yes·called=no·wrapped=yes·js_error=none으로 구분하고 둘 다 attempts0을 확인한다. 진단은 click을 재시도하거나 준비될 때까지 추가 대기하지 않으므로 원래 시점을 숨기지 않는다. 정상 공개 페이지에는 fixture flag를 주입하거나 읽지 않는다.

최신 합성 시험은 기존9개에 2.5초 뒤 활성화되는 버튼1개를 더한 총10개다. 이 시험은 기존2초 click에서 실패하고 새20초 click에서 성공한다. 응답 listener는 click 전에 등록해 이미 수신된 응답 Promise를 보존하되, 대기 제한2초는 click 완료 후 각 응답을 await할 때 시작한다. context 종료 후 대기 Promise가 모두 정리되고 response listener0임을 매 fixture에서 확인한다. 버튼 지연은 시험 fixture에만 존재하며 실제 페이지에 임의 sleep이나 대기용 DOM 변경을 넣지 않는다. 이는 검사 타이머 검증이며 WebKit의 실제 timeout 원인이 해결됐다는 결과는 아니다.

CI에서는 `--self-test chromium`과 `--self-test webkit`만 각 preflight matrix 엔진에서 실행한다. 양쪽 성공 이후에도 현재 공개 job은 비활성화되어 있다. 로컬 WebKit은 미실행이다. 이번 offline-only 수정 과정의 사이트 요청은 0회이며 실제 앱 UI/DB/TLS를 검증한 것으로 표시하지 않는다. 초기 RED, 리디렉션 결함의 실제 HTTP RED 및 수정 후 전체 GREEN, 추가 진단의 RED/GREEN은 작업 폴더 `.omo/evidence/public-entry/`에 보존한다.

공개 실행은 독립 검토 후 담당자가 수행한다. 로컬 proof의 성공과 외부 public 성공은 별개다. 공개 결과가 모두 성공하더라도 실제 지인의 Safari에서 해결됐다고 판정하지 않는다. 실패한 stage/status만 이용해 다음 조사를 결정한다.
