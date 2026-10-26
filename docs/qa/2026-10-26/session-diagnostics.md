# 시작 오류 진단과 실제 HTTPS 쿠키 회귀

기준 f2b44d208415a355a6272c8a8d1f2e33de0935f8. 같은 영향 기기의 빈 공간·합성 예제 장애는 **미해결**이다. 이번 변경은 원인 구분을 돕는 진단이며 운영 원인 제거를 주장하지 않는다.

후속 사용자 증거: 오늘13:58 KST **iPhone Safari**에서 업무 문서함을 눌렀을 때 ‘작업 공간을 다시 시작하세요. 시작 화면에서 새 작업 공간을 열어 주세요.’가 표시됐다. 앞선 사용자 답변에는 시작 버튼을 누른 흐름이 있다. 카카오 WKWebView로 확정하지 않는다. 이 시각은16:25경 확인된 f2b 배포보다 이르므로 f2b에서 실패했다고 판정하지 않는다. 최신 배포의 같은 Safari 재검증은 미확인이다.

오류가 있을 때만 펼칠 수 있는 ‘오류 진단’에 create/session/manuals/sources 단계, 실제 HTTP status 또는 no-response, 고정 category(success/http/timeout/network/response/unknown), retry/check만 표시한다. 예외 메시지·본문·URL·Cookie·토큰·세션 ID·개인정보는 진단으로 복사하지 않는다. 기록은 React 메모리에 최대 단계별 1건으로 유지하며 새 시작에 초기화한다. 닫힌 이전 페이지의 비동기 응답이 새 시도의 진단에 섞이지 않도록 unmount 경계를 확인한다. 진단은 외부 전송·영구 저장하지 않는다. 정상 UI에는 표시하지 않는다.

원래 Owner 쿠키·Origin·API·DB 정책은 변경하지 않았다. 생성201 뒤 세션401, 세션503, 세션 timeout, 세션200 뒤 문서함401을 별개로 표시한다. 재확인은 기존과 같이 GET만 실행한다. 모든 성공 응답 status는 실제 Response에서 읽으며 예상200/201로 대체하지 않는다.

## 직접 검사

- `npm test`: unit43/43.
- `npm run build`: 타입 검사 포함 production build 성공.
- `npx playwright test --config playwright.session.config.ts --reporter=line`: 기존 모의 UI11/11.
- `npx playwright test --config playwright.transport.config.ts --reporter=line`: 실제 HTTPS7/7.
- 소유 파일 Biome·`git diff --check`: exit0. lint 정보1건은 테스트 config의 process.env 접근 표기 제안이다.

HTTPS 검사는 production Next UI를 localhost에 실행하고 임시 자체서명 인증서를 사용하는 loopback proxy를 거친다. 브라우저는 실제 Set-Cookie를 받고 CookieJar에서 자동 재전송한다. 실제 cookie formatter/parser와 `/api/session` GET은 사용하지만 workspace 생성·목록·DB 행은 격리된 메모리 합성 fixture다. 실제 PostgreSQL/Cloudflare/iOS E2E라고 주장하지 않는다. API route.fulfill과 addCookies로 인증 성공을 주입하지 않는다. TLS 키·쿠키 값·토큰을 trace/HAR/로그에 저장하지 않는다.

두 시작 버튼 각각 익명 Next Link prefetch + `/manuals` 방문을 먼저 수행한다. cookie 없는 RSC prefetch를 관측하고, 시작 후 session/manuals/sources200에 owner cookie가 실려 온 boolean을 확인한다. **수정 전에도 두 정상 시나리오는 성공**했다. Next prefetch를 원인으로 단정하거나 강제 새로고침으로 바꾸지 않았다. 나머지 진단3건은 수정 전 실패→수정 후 성공, 실제10초 timeout 검사도 성공했다.

실행 환경은 Chrome/Windows다. WebKit·실 iPhone 앱 내 브라우저·원래 영향 기기는 아직 검사하지 않았다. CI에 기존 Chromium 설치를 쓰는 별도 HTTPS 검사 한 단계만 추가했고, GitHub push/CI 실행/배포는 독립 검토 후 별도다.

인프라 증거: `C:/코덱스/인프라_통합점검/.omo/evidence/ghost-same-device-20261026/IMPLEMENTATION.md`와 그 폴더의 RED/GREEN 로그.
