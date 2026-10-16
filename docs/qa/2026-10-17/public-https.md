# 공개 HTTPS 검증 — 2026-10-17 KST

대상: https://ghostmanual.pigs0516.com
로컬 HEAD: `58d9ebd1eac5f80f7fb66364ece4950e87a25ebf` (검증 전 작업 트리 깨끗함).
실행 시각: 2026-10-16 16:13~16:17 UTC / 2026-10-17 01:13~01:17 KST.

## 네트워크와 공개 응답

- 환경 상태 spec revision4와 실행기의 `/etc/codex/network-policy.json` 모두 대상 호스트 허용을 표시했다. API의 network state는 unknown이므로 목록만으로 적용 성공을 단정하지 않고 실제 요청을 확인했다.
- `curl --silent --show-error --max-time 30 https://ghostmanual.pigs0516.com/`: 종료0, HTTP200. TLS 검증과 상속 프록시를 유지했다. CONNECT403 재현 없음.
- 공개 응답: Cache-Control private/no-store/max-age=0, Referrer-Policy no-referrer, X-Content-Type-Options nosniff, X-Frame-Options DENY, CSP frame-ancestors none, cf-cache-status DYNAMIC.
- 비인증 GET /api/manuals →401 unauthorized. 잘못된 Origin의 POST /api/workspaces →403 invalid_origin (공간 생성 안 됨).
- Python urllib 경로의 보조 조회는 HTTP403을 반환했다. 동일 대상의 curl 및 Chromium 경로는 성공했다. 이를 터널 장애로 판단하지 않았고 프록시 우회도 하지 않았다.

## 공개 배포 식별 범위

`/`, `/privacy`, `/terms`, `/manuals`, `/sources/new`, `/share`, `/ask`가 참조하는 JS/CSS14개를 curl로 받아 로컬 `.next/static`과 SHA-256 비교: 14/14 일치, 비교 명령 종료0. 개별 결과는 [public-assets.json](public-assets.json).
공개 정책 적용일10월6일·AI 비활성 안내, 매뉴얼 제목/상태 필터, 게시 버전 비교를 실제 확인했다.

로컬 build ID: `0bYd-CJQ4c0aA4_VrAuRQ`.
원격 관리 접속이 없어 컨테이너 image ID·배포 commit SHA·서버 전용 코드 전체 일치는 직접 확인하지 못했다. 클라이언트 자산 일치와 공개 API 동작은 확인했으나 이를 원격 이미지 digest 증명으로 간주하지 않는다.
DNS 존재·터널 healthy·로컬 ingress 구성은 사용자 인계 사실이다. 이번에는 해당 설정 조회/변경이나 관리 방식 전환을 하지 않았다.

## 공개 브라우저 사용자 흐름

실제 Chromium `/usr/bin/chromium`, 기존 HTTPS 프록시 사용, TLS 검증 유지. Playwright workers1/retries0, desktop1280×900 및 mobile390×844. 전용 로컬 DB reset/globalSetup/webServer를 사용하지 않고 공개 서비스에서 방문자별 합성 공간만 생성했다. CF-Connecting-IP를 위조하지 않았다.

기존 `tests/e2e/manual-flow.spec.ts` 3개와 `manual-extensions.spec.ts` 2개 시나리오를 임시 공개 설정으로 실행했다. extensions의 로컬 전용 IP 헤더 beforeEach를 제거하고 각 테스트 후 본인 공간 DELETE와 삭제 후401을 검증했다. 토큰/공유 URL이 포함될 수 있는 trace·screenshot은 저장하지 않았다.

명령: `npx playwright test --config test-results/public-suite/playwright.config.ts`
결과: 종료0, **10 passed (1.6m)** = desktop5 + mobile5.
임시 설정·사본은 Git 제외 경로에 있으며 운영 DB 초기화 기능은 포함하지 않는다.

각 화면 크기에서 다음을 확인했다:

1. 제목·검수 상태 필터 조합, 검색 결과 없음, 원본 목록 유지.
2. 버전1→2 게시와 변경 필드 비교, 잘못된 버전 순서 안내, 미게시 초안 Reader 비노출.
3. 합성 예제 검수→공유→별도 Reader→질문→AI 이용 불가 및 검색 근거→공유 취소→Reader 재접속 차단. URL fragment 토큰 제거와 읽기 전용 UI도 확인.
4. 빈 공간에서 원본 등록→HTML 문자열 안전 표시→reload 후 영속성.
5. 원본 수정 revision2→재검토 표시→수정·확인→재검수 게시 버전2.

10개 검증용 공간 모두 삭제200 및 후속 매뉴얼 조회401 확인. 기존 방문자의 공간은 접근·삭제하지 않았다. 기존 시나리오에 포함된 가로 넘침·페이지 오류 검사를 유지했다.

## 완료와 남은 조건

공개 HTTPS와 위 AI 비활성 데모 흐름은 이번 실행으로 확인했다. 사용자 인계의 로컬 단위41·통합40·E2E24·lint/typecheck/build는 반복하지 않았고 이번 실행 결과와 구분한다.

실제 AI 호출·계정/키/예산·한국어 품질 평가, 원격 컨테이너 이미지 식별, 지속 부하와 완전한 접근성 인증은 미검증이다. 서버 메모리·정리 타이머·기존3000/3100 서비스 상태도 이번 공개 검증에서 재측정하지 않았다.
