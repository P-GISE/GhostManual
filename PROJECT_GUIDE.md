# GhostManual 프로젝트 가이드

## 2026-10-17 현재 확인 상태 (KST)

- 원격 배포 식별 확인 완료: 사용자 서버 출력에 근거. [이미지 ID·빌드 ID·상태 기록](docs/qa/2026-10-17/remote-deployment.md). 원격 build ID는 앞선 로컬 build ID와 다르며 동일 이미지로 단정하지 않는다.

- 사용자 인계: 최신 소스 단위41·PostgreSQL 통합40·desktop/mobile E2E24·build/typecheck/lint 통과. 이번 세션에서는 완료된 로컬 검증을 반복하지 않았다.
- 제품 검증 소스 `58d9ebd1eac5f80f7fb66364ece4950e87a25ebf`, 시작 시 작업 트리 깨끗함. 문서 필터·게시 버전 비교·운영자 문의가 포함된 정책 페이지가 구현되어 있다.
- 현재 실행 환경의 `/etc/codex/network-policy.json`에 `ghostmanual.pigs0516.com` 허용을 확인했고, 기존 프록시·TLS 검증을 유지한 공개 HTTPS 요청이 HTTP200을 반환했다. 이전 환경의 CONNECT403을 현재 장애로 취급하지 않는다.
- DNS 존재·`lostark-party-aws` healthy·로컬 ingress → `http://127.0.0.1:3200`은 사용자 인계 사항이다. 이번에는 DNS/터널 설정을 변경하지 않았다. 로컬 관리 방식을 유지한다.
- 공개 페이지 7곳에서 참조한 JS/CSS14개의 SHA-256이 현재 로컬 `.next`와 모두 일치했다. 최신 필터·버전 비교·10월6일 정책이 공개 서비스에 보인다. 이후 사용자 서버 실행 출력으로 최신 HEAD 태그·실제 이미지 ID·원격 build ID·앱/DB running 및 OOM=false·재시작0을 확인했다. 이미지 태그 외 소스 provenance는 별도 미검증이다. 정적 자산 일치를 서버 전체 소스의 동일성으로 확대하지 않는다.
- 공개 Chromium 검증 desktop5/mobile5 합계10/10 통과(종료0). 필터·버전 비교·검수·Reader 질문/근거·공유 취소·원본 수정/재검수·영속성 확인. 각 합성 공간 삭제200 및 후속401을 검증했다.
- 공개 API에서 비인증 매뉴얼 조회401·잘못된 Origin 생성 요청403을 확인했다. 실제 AI 호출·키/예산·한국어 품질 평가는 미검증이며 AI 완료로 표시하지 않는다.
- 상세 근거: [공개 HTTPS 검증](docs/qa/2026-10-17/public-https.md). 아래 날짜별 기록은 과거 상태다.


업데이트: 2026-10-05

## 제품과 기준

GhostManual은 개인의 업무 경험을 사람이 검수한 업무 매뉴얼로 남기고, 후임자가 실제 자료를 근거로 업무 방법을 확인하는 조직 지식 인수인계 플랫폼이다.
제품 정의와 작업 규칙은 [제품 프롬프트](docs/requirements/제품_정의_프롬프트.md), [개발 프롬프트](docs/requirements/개발_마스터_프롬프트.md)를 따른다.
Source(원본), Manual(검수 매뉴얼), Answer(근거 답변)를 구분한다. AI 초안을 회사 규칙처럼 확정하지 않으며 근거가 부족하면 답변을 보류한다.

## 승인된 방향과 현재 단계

- 사용자: 두 프롬프트로 신규 프로젝트 제작, 심사위원이 URL로 접속하는 웹 서비스.
- 보유 AWS·Cloudflare·Tailscale·GitHub P-GISE를 활용한다.
- 2026-10-03 사용자의 '프로젝트 가이드 업데이트 하고 계속해서 작업 진행'을 상세 설계 승인 및 구현 계획 진행 요청으로 반영했다.
- 상세 설계와 문서 기반 작성 완료. [구현 계획](docs/superpowers/plans/2026-10-03-ghostmanual-mvp.md)을 작성했다.
- 사용자의 “엉 굳 좋아 진행해”로 구현 계획과 직접 실행이 승인됐다. 입력·DB·세션·매뉴얼 버전·공유·검색·한국어 화면을 구현했다. 단위 41개·실제 PostgreSQL 통합 39개·Chrome E2E 20개(desktop10/mobile10)를 기존 CI에서 확인했다. 이후 모바일 한글 줄바꿈·터치 영역 수정의 production build는 성공했으며 전체 페이지27개 캡처·두 독립 화면 검증과 최종 CI의 단위41·통합39·브라우저20개·Docker 이미지 빌드가 모두 통과했다. AWS 비공개 갱신·롤백도 확인했다.
- 목표 주소는 ghostmanual.pigs0516.com이다. AWS 비공개 앱 배포와 런타임 흐름은 확인했으며 공개 DNS·HTTPS 연결은 아직 생성하지 않았다.

## 핵심 MVP

텍스트·TXT/Markdown 입력 → 업무 구조화 초안 → 담당자 수정·검수 → 불변 버전 저장 → 읽기·질문 전용 공유 → 후임자 질문 → 검수 Manual·원문 검색 → 답변·근거 위치 확인.
원본 변경 시 매뉴얼을 재검토 대상으로 표시하고 신규 답변에서 제외한다. 과거 답변은 당시 버전을 보존한다.
공개 시연은 방문자별 공간과 합성 자료를 사용한다. PDF/Office 파싱, 결제, 복잡한 조직 관리, 전체 외부 연동, Multi-Agent 제품 구조는 후순위다.

## 기술 방향

설계 기준: Node 24·npm, TypeScript·Next.js App Router·React·CSS Modules, PostgreSQL·pg·pg_trgm, Zod, OpenAI 공식 SDK, Vitest·Playwright.
클라이언트 HTTP 정책은 ky, lint/format은 Biome로 계획한다. 정확한 버전은 구현 때 확인해 lock file로 고정한다.
OpenAI gpt-4.1-mini는 초기 후보다. 사용자가 AI API 계정이 없다고 확인했으며 제공자 선택을 위임했다. 실 API 품질 평가 후 모델을 확정한다.
AI_ENABLED는 기본 false. 키 없는 fixture 검증과 실제 AI 실행을 구분하며 live 테스트 없이 AI 완료를 선언하지 않는다.

## 인프라 조사 결과

| 항목 | 실제 확인 결과 |
|---|---|
| Cloudflare | pigs0516.com 및 기존 AWS 터널 DNS 확인 |
| GitHub | [P-GISE/GhostManual](https://github.com/P-GISE/GhostManual) 비공개 저장소 생성; CI37217328340 전체 성공 |
| AWS 접속 | Tailscale SSH 추가 인증 갱신 후 읽기 전용 조사 성공 |
| 서버 | Linux, Docker 29.5.3, 메모리 약1906MB/비공개 앱 검증 후 가용725MB, 디스크 여유13GB |
| 기존 서비스 | 앱 포트3000·3100 사용 중. 3100은 EventOps |
| GhostManual 배포 | 127.0.0.1:3200, 별도 Compose 프로젝트·DB·볼륨, migration001·HTTP200 확인 |
| 로컬 | Node24.20.0/npm11.19.0 실행 확인; Docker 소켓 오류, 전용 native PostgreSQL18.4로 DB 검증 |

관찰 시점의 값이며 영구적인 가용 용량을 보장하지 않는다. 비공개 앱의 8개 동시 읽기 요청은 모두200(전체209ms), 앱·DB OOM=false를 확인했다. 지속 부하·AI 부하와 공개 접속은 별도 검증한다. [비공개 런타임 기록](docs/qa/2026-10-05/private-runtime.md)을 따른다.
서버에서 새 Next.js 빌드를 수행하기보다 로컬/CI에서 빌드한다. DB 공개 포트를 만들지 않는다. 기존 DB를 개발 테스트에 사용하지 않는다.

## 구현 순서와 검증

1. typed 입력 경계·실행 설정
2. PostgreSQL 저장·Owner 세션·자료
3. 초안 수정·검수·버전·재검토
4. AI 생성·schema/근거 검증·할당량·중복 요청
5. 검색·질문·근거 부족·과거 인용
6. Reader 공유·취소·삭제·만료
7. 실제 한국어 화면·별도 브라우저 공유·모바일·실패 상태
8. CI·독립 리뷰·AWS/Cloudflare 배포·실 AI 평가

각 기능은 RED → GREEN → 관련 suite 순서로 검증한다. 빌드 성공만으로 제품 완료를 선언하지 않는다.
[진행 기록](docs/구현_진행_기록.md)에 명령·결과·판단을 남기고 [파일 ledger](docs/10_파일_점검_현황.md)·[TODO](docs/99_해야할일.md)를 함께 갱신한다.

## 공개 전 필수 조건

AI API 계정·키와 금액 예산, 서버 부하 적합성, 운영자 연락처·실제 개인정보 안내, 공개 HTTPS의 전체 사용자 흐름 검증.
비밀 값은 채팅·문서·Git·클라이언트·일반 로그에 기록하지 않는다.

## 이어서 읽을 파일

[문서 가이드](docs/00_문서_가이드.md) → [MVP 상세 설계](docs/superpowers/specs/2026-10-03-ghostmanual-mvp-design.md) → [구현 계획](docs/superpowers/plans/2026-10-03-ghostmanual-mvp.md) → [진행 기록](docs/구현_진행_기록.md).
