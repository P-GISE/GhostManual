# GhostManual 프로젝트 가이드

갱신일: 2026-10-19 (KST). 현재 단계는 **디자인·키보드 개선 GitHub 통합 완료, 기존 서버 배포는 연결 차단으로 미완료**다. AI는 비활성으로 유지한다.

## 현재 클라우드 직접 실행 — 2026-10-19 14:49 KST 이후

사용자 승인에 따라 현재 환경에서 서버 연결·이미지 다운로드·공개 상태를 직접 확인했다. 작업 시작 때 조회한 기본 브랜치는 `2580332719254f6b0c7f0c8c0faf2598beee016a`이며 PR #3/#4/#5 통합 이력을 확인했다. 해당 조회 기준으로 검증 제품 소스7efb284 이후 변경은 Markdown뿐이다.

**서버 앱 교체는 미실행**이다. `proxy:8088` CONNECT와 실제 SSH가 일반/권한 재시도 모두 연결 거부로 끝나 서버 인증 단계에 도달하지 못했다. VPN 설정은 있으나 TCP grant는 비어 있다. Tailscale SSH의 키/정책/추가 인증 문제라고 단정하지 않는다. 이미지 artifact 조회·다운로드는 API 프록시403으로 실패했으며 실제 만료 여부·새 이미지 ID는 미확인이다.

공개 Chromium4경로×desktop/mobile8화면은 HTTP200·가로넘침0이지만 Pretendard 미로딩, desktop main 폭1248px, 본문 이동 후 main 포커스0/8이었다. **새 디자인·글꼴·키보드 개선은 공개 화면에 미적용**이다. 이 공개 자산 관찰을 서버 이미지 ID·build ID 확인으로 확대하지 않는다.

`api.github.com`만 추가한 환경 설정 초안을 저장·재조회했다. 실행 환경 적용에는 설정 검토·저장과 게시가 필요하다. TCP `100.108.2.6/32` 허용은 현재 도구로 편집할 수 없다. 실패 명령·오류·확인 경계·측정값과 캡처는 [이번 직접 실행 기록](docs/qa/2026-10-19/deployment-check.md)을 따른다. DB·기존 서비스·DNS·터널·AI를 변경하지 않았다. 3000/3100·DB의 현재 정상 여부는 이번 SSH 차단으로 재확인하지 못했다.

## 이전 채팅의 배포 연결 재점검 — 2026-10-19 14:25 KST

사용자가 새 디자인의 서버 배포와 공개 확인을 요청해 현재 채팅의 클라우드 연결을 직접 재점검했다. **서버 앱 교체는 미실행이며 새 디자인 공개 적용은 미완료**다.

- `git ls-remote origin refs/heads/feat/ghostmanual-mvp`에서 기본 브랜치 `067b59edace52938e8e95bdbd488d845aaf2d2f4`를 확인했다. 아래 과거 미병합 표와 구분한다.
- 환경은 running/connected, observations_current=true다. 현재 상태 API의 network policy state는 unknown이므로 enforced로 단정하지 않는다. 실행 환경의 `/etc/codex/network-policy.json`은 version1, `vpn_configured=true`, TCP CONNECT proxy8088, `tcp_network_access.domains=[]`, `ip_ranges=[]`다. VPN 설정은 VPN 정상 동작/서버 접속 성공의 증거가 아니다.
- SSH agent 변수는 없고 사용자 홈의 `.ssh` 디렉터리도 없다. 상태 API에 서버용 runtime variable/secret/outbound identity는 없으며 Cloudflare API token만 unknown으로 표시된다. Tailscale SSH 사용 가능 여부·추가 인증·서버 상태는 확인하지 못했다. TCP 허용이 없어 우회 접속을 시도하지 않았다.
- GitHub 커넥터로 artifact12134456501의 `expired=false`, 만료2026-10-19 20:06:24 KST, source7efb284·ZIP digest46202fbd…를 직접 확인했다. 커넥터 다운로드는 성공해 파일 참조를 확보했지만191152491bytes로 실행 환경 전송 한도32MiB를 넘어 로컬 전송은 실패했다. 로컬 ZIP 해시·Docker image ID는 새로 검증하지 않았다. `gh api`는 `https://api.github.com` 요청에서 Forbidden으로 실패했다. 이미지 재빌드는 실행하지 않았다.
- 공개 HTTPS는 curl로 HTTP200, private/no-store·CSP font-src self를 확인했다. HTML에 font preload가 없고 현재 CSS `/_next/static/chunks/2hb3twf9u61xl.css`에도 Pretendard/@font-face가 없다. 새 글꼴 공개 반영은 확인되지 않는다. 서버 실행 이미지 ID·build ID·데스크톱/모바일 정렬·키보드 동작은 이번에 검증하지 못했다.
- 저장소 밖 `/workspace/ghostmanual-update-design.sh`는 현재 환경에 없다. DB·데이터·3000/3100 서비스·DNS·터널·AI 설정은 변경하지 않았다. 전체 QA는 반복하지 않았다.

재개에 필요한 연결 설정: TCP 허용 범위에 `100.108.2.6/32`를 추가한 교체 환경과, 해당 환경에서 동작하는 서버 인증(Tailscale SSH 정책/필요한 사용자 인증 또는 안전하게 연결된 SSH 인증)이 필요하다. HTTP 허용 목록의 IP 등록만으로 raw TCP 접속은 허용되지 않는다. 이미지 로컬 확보에는 GitHub Actions 다운로드가 가능한 CLI 인증/HTTP 정책 또는 대용량 파일 전달 경로도 필요하다. 비밀 값을 채팅이나 Git에 기록하지 않는다. 현재 도구에는 환경 설정을 수정하는 기능이 없어 변경을 적용하지 못했다.

연결 준비 후 [검증 이미지와 앱 단독 교체 절차](docs/qa/2026-10-18/release-update.md)를 따른다. 모든 Compose 명령은 `docker compose -f compose.yaml -f compose.no-logs.yaml --env-file .env`를 사용하고, 이전 이미지·설정을 서버 내부에 보존한 후 `up -d --no-deps app`으로 교체한다. 서버 빌드·migration·터널 재생성은 이번 디자인 배포에 필요하지 않다.

## 제품과 현재 범위

GhostManual은 업무 원본 자료를 사람이 검수한 매뉴얼로 남기고 후임자가 게시 버전과 원문 근거를 확인하는 한국어 웹 서비스다. Source(원본)·Manual(검수 매뉴얼)·Answer(근거 답변), 작성자·Reader 권한, 게시 revision을 구분한다.

텍스트/TXT/Markdown 입력 → 초안 편집·검수 → 불변 게시 버전 → Reader 공유·검색·근거 확인을 제공한다. 원본 수정 시 재검토하고 공유 취소·자료 삭제·보관 정책을 적용한다. 합성 예제와 실제 AI 출력을 구분한다.

## 작업 기준

| 항목 | 기준 |
|---|---|
| 저장소 | [P-GISE/GhostManual](https://github.com/P-GISE/GhostManual) |
| 기본 브랜치 | feat/ghostmanual-mvp |
| 가이드 인계 기준 commit | d493c8cd9170b304486230d1e891916a70cd459c |
| 키보드 수정·로컬 검증 소스 | 160a754f37f2c8fdc8314018bc602dcafe9c4fa4 |
| 디자인 통합 commit | 067b59edace52938e8e95bdbd488d845aaf2d2f4 |
| 새 검증 제품 소스·배포 대상 태그 | 7efb284ea0d4efbf428fbdebbd51f290fceb7ccd |
| 이전 서버 실행 태그 (2026-10-17 인계, 현재 SSH 재확인 불가) | 58d9ebd1eac5f80f7fb66364ece4950e87a25ebf |
| 공개 주소 | [ghostmanual.pigs0516.com](https://ghostmanual.pigs0516.com) |
| 제품 기술 | Node24·Next.js/React·TypeScript·PostgreSQL, Vitest·Playwright |
| AI | 비활성. 실제 연동·계정·예산·한국어 품질은 이번 완료 범위에서 제외 |

문서 commit과 실행 이미지 태그는 다르다. 문서 변경이 배포·이미지 갱신을 뜻하지 않는다. 예전 초기화/Windows Core 브랜치의 상태를 현재 웹 데모에 적용하지 않는다.

## 완료 근거와 출처

다음은 사용자 인계 및 저장소 QA 기록에 근거한다. 이번 문서 갱신에서 제품 검증을 반복하지 않았다.

- 공개 HTTPS HTTP200, desktop5/mobile5 합계10개 사용자 흐름 통과. 필터·버전 비교·검수·Reader 공유/검색/근거·공유 취소·원본 수정/재검수·저장 유지 확인.
- 검증용 합성 공간10개 삭제 후 접근 차단 확인. [공개 검증 기록](docs/qa/2026-10-17/public-https.md).
- 단위41·PostgreSQL 통합40·E2E24·빌드·타입 검사·린트 통과는 인계 결과다. 과거 단위41/통합39/E2E20 기록과 시점을 구분한다.
- 원격 식별은 사용자가 Tailscale SSH 추가 인증 후 ubuntu@lostark-party-aws에서 실행한 출력에 근거한다. 에이전트의 직접 원격 실행으로 표시하지 않는다. [원격 배포 기록](docs/qa/2026-10-17/remote-deployment.md).

## 배포 상태와 운영 경계

2026-10-17 인계의 앱 이미지 ID는 `sha256:419ee46b31617999150b7841ce6e7ccb650b6065441b4531cf115dceb4e33ca8`, 원격 Next build ID는 `x6zb-rufDOdAIMgz8oWRv`다. 당시 인계 출력에서 앱·DB running, OOM=false, 재시작0, DB healthy를 확인했다. 이번에는 SSH 차단으로 재확인하지 못했다. 유지할 구성은 앱127.0.0.1:3200 바인딩과 DB 호스트 포트 비공개다.

Cloudflare 터널은 기존 로컬 관리 방식을 유지한다. 완료된 DNS/터널 설정·배포·재시작·공개 검증을 이유 없이 반복하지 않는다. 로컬/원격 build ID는 다르며 전체 소스 동일성·CI 이미지 digest 일치는 미검증이다. 정적 자산 해시 일치나 이미지 태그만으로 이를 보증하지 않는다.

## 후속 작업: 키보드 접근성

가이드 기반 계속 진행 요청에 따라 UX-KEYBOARD를 수행했다. ‘본문으로 이동’이 대상 main에 포커스를 옮기지 못하는 문제를 재현하고, tabIndex=-1과 화면 안쪽 포커스 표시를 적용했다. 로컬 배포 모드4경로×2뷰포트8개·단위41·타입·빌드·lint 검사를 통과했다. 전체 접근성 인증·실 기기/화면 낭독기 평가는 미검증이며, 원격 배포 상태는 바꾸지 않았다. [직접 실행 근거](docs/qa/2026-10-17/keyboard-accessibility.md).

## GitHub 반영과 다음 순서

| 항목 | 2026-10-17 조회 기록 (이번 디자인 작업에서 재조회하지 않음) |
|---|---|
| 가이드 [PR #3](https://github.com/P-GISE/GhostManual/pull/3) | open·미병합, 대상 feat/ghostmanual-mvp |
| 키보드 수정 [PR #4](https://github.com/P-GISE/GhostManual/pull/4) | open·미병합, 대상 docs/public-demo-guide. PR #3에 의존 |
| 수정 소스 CI | [push 실행](https://github.com/P-GISE/GhostManual/actions/runs/38940775088)·[PR 실행](https://github.com/P-GISE/GhostManual/actions/runs/38940826573) 모두 in_progress. 완료 결과 미확인 |
| 공개 배포 | 기존58d9ebd 태그의 인계 상태 유지. 160a754 적용 여부를 확인/배포하지 않음 |

위 표는 2026-10-17 조회 이력이며 현재는 PR #3/#4/#5 통합을 기본 브랜치 Git 이력에서 확인했다. 남은 작업은 연결 복구 후 검증 이미지로 앱만 교체하고 새 이미지 식별과 공개 변경 동작을 확인하는 것이다. 기존 DNS/터널 재구성·전체 공개 QA 반복을 기본 단계로 넣지 않는다.

독립 리뷰의 모바일 테두리 비가시성 P2는 실패 테스트 후 inset offset으로 수정했고 최종8개 검사가 통과했다. 전체 lint는 종료0이지만 기존 warning1/info66은 남아 있다. 가이드의 로컬 성공을 원격 CI 성공이나 공개 적용으로 표시하지 않는다.

## 전체 디자인 개선 — 2026-10-18

사용자의 전체 개선·좌우 대칭·글꼴 요청에 따라 공통1200px shell과 가운데 읽기 열, 동일 폭 문서/검수 열, 자체 호스팅 Pretendard를 적용했다. 문서함·등록·편집·공유·정책 화면과 모바일 시작 버튼까지 정리했다. 로컬 화면42개·단위41개·타입·빌드·lint 검증을 통과하고 독립 리뷰를 마쳤다. 10개 화면×3크기 캡처30장을 남겼다. Docker의 public 자산/라이선스 복사를 추가했다. 검증 결과·이미지·합성 데이터의 경계는 [디자인 QA](docs/qa/2026-10-18/design-refresh.md)에 기록한다. 운영 서버에는 아직 반영하지 않았다. AI 보류·기존 공개 배포 기준은 유지한다.

## 디자인 업데이트 후속 — 2026-10-18

사용자의 업데이트 요청으로 실제 PostgreSQL을 포함한 CI를 실행했다. 원본 버전 표시의 옛 문구를 찾던 E2E 기대값을 현재 한국어 문구로 수정했다. 소스 `7efb284ea0d4efbf428fbdebbd51f290fceb7ccd`의 lint·타입·단위·DB migration/통합·빌드·E2E·디자인/접근성 단계는 통과했다. Docker 이미지 생성과 artifact 업로드도 성공했다. 단위41·통합40·E2E24·화면42개를 CI 로그에서 직접 확인했다. 이미지 식별과 통합 PR 상태는 [업데이트 기록](docs/qa/2026-10-18/release-update.md)을 따른다. 위 PR 표는 과거 조회 기록이다.

현재 작업 환경은 VPN·TCP 대상·서버 인증이 연결되어 있지 않아 원격 앱 교체와 공개 디자인 확인은 대기 상태다. 이전 환경의 접속 상태와 구분하며 DB·DNS·터널은 변경하지 않았다. GitHub 반영을 공개 배포 완료로 표시하지 않는다.

## 남은 범위

- 실제 AI는 사용자 지시로 제외·보류한다. 별도 작업 지시 전 키/예산 요구·실 호출·AI 활성화를 진행하지 않는다. 추후 활성화한다면 품질·비용·전송 정책을 함께 검토한다.
- 지속 부하·전체 접근성 인증·이미지 provenance는 별도 미검증이다. 현재 장애 또는 공개 데모 완료의 미충족 조건으로 단정하지 않는다.
- 다음 제품 작업은 [99 해야할일](docs/99_해야할일.md)의 남은 범위에서 정한다. PDF/Office·의미 검색·외부 연동을 임의로 착수하지 않는다.

## 문서 작업 절차

[AGENTS](AGENTS.md)와 [00 문서 가이드](docs/00_문서_가이드.md)를 진입점으로 01~10·99를 함께 프로젝트 가이드라 부른다. 상세 요구사항·설계와 과거 결과는 원문을 보존하고 날짜별 이력으로 구분한다.

[제품 정의](docs/requirements/제품_정의_프롬프트.md) · [상세 설계](docs/superpowers/specs/2026-10-03-ghostmanual-mvp-design.md) · [구현 계획](docs/superpowers/plans/2026-10-03-ghostmanual-mvp.md) · [진행 기록](docs/구현_진행_기록.md) · [점검 ledger](docs/10_파일_점검_현황.md)
