# GhostManual 프로젝트 가이드

## 2026-11-05 PR #53 관리자 DB 준비

사용자 지시로 PR #53의 정확한006_admin.sql을 검토·격리 검사·신규 S3 백업 후09:33 KST 운영에 적용했다. 기존 사용자·앱 권한·200/401 응답을 보존했으며 관리자 승격/계정 생성·ADMIN_EMAILS·PR #53 병합·앱 배포는 하지 않았다. [실행 근거와 경계](docs/qa/2026-11-05/pr53-admin-migration.md). 문서 엔진은007로 번호를 분리하고 PR #55에서 최신 기본 통합·CI와 운영 실행 구성을 준비 중이다.

## 2026-11-05 외부 엔진 격리 보완·50GiB 확장

사용자 승인으로 암호화 EBS와 ext4를40→50GiB 온라인 확장했다. 재부팅·기존 이미지/백업 삭제 없이 컨테이너와 앱 응답을 보존했다. 외부 엔진은 최종 무캐시 이미지 `bec10606…`·새 rootfs·오버레이 없는 전용 RootDirectory/cgroup/AppArmor 실행에서 격리5/5·추출10/10을 통과했다. **격리 검증 종료 당시 운영 앱·문서 migration·gateway/worker 활성화·커밋/PR은 미실행이었다. 이후 최신 기본 통합·커밋·PR #55 작성은 완료했으며 현재 진행 상태는 위 항목을 따른다.** [현재 실행·검증 경계](docs/qa/2026-11-05/external-engine-runtime.md)를 우선한다.

## 2026-11-04 다중 형식 엔진 구현·검증 중

사용자 승인 설계로 DOCX·HWPX·PPTX·CSV 직접 추출, HWP v5·구형 DOC/PPT·PDF/스캔 PDF 외부 변환·OCR, 비동기 작업·소유자 전용 비교·검사 전 게시 차단을 별도 작업 트리에 구현했다. **11/4 당시 미커밋 검토 단계였고 운영 배포·문서 migration·외부 엔진 활성화는 미실행이었다. 현재 커밋·PR #55와 문서 migration007 상태는 위11/5 기록을 따른다.** 11/4 당시 외부 실제 파서 회귀20/20 통과·격리5건 FAIL/BLOCKED였으며, 이 차단은 위11/5 검증으로 해소했다. 합성 4형식 각각 2버전·390px·DOCX 검수/게시·별도 Reader 권한을 실제 확인했다. 부모 revision/최신 선택 동기화의 단일 수정과 범위 재검토 승인을 마쳤고, 최신 단위 232/232·DB 통합 146/146을 통과했다. 최종 타입 검사도 통과했다. 최신 lint·분리 빌드와 두 대기 버전의 실제 처리 순서/최신 재선택·최신 원본 작성 회귀도 통과했으며 아래 과거의 형식 확장 미구현 기록과 구분한다. [구현 범위·검증과 남은 조건](docs/qa/2026-11-04/multi-format-engines-implementation.md), [승인 설계](docs/superpowers/specs/2026-11-04-multi-format-engines-design.md), [실행 계획](docs/superpowers/plans/2026-11-04-multi-format-engines.md).

> 11/4 후속: 문서 PR #47 병합·자동 배포 완료(현재 `6b5406f`/image `0096babc…`). [최신 확인·남은 작업](docs/qa/2026-11-04/park-gise-followup.md)을 우선하며, 아래 PR #46 운영 식별은 11/3 당시 기록이다. 03:20 정규 백업은 확인 시각 기준 실행 전이다.

## 2026-11-03 현재 기준과 박기성 남은 일정

엔진·migration 005·DB 관리자 분리·S3 정기 백업/격리 복원·백업 실패 알림 연결·EBS 암호화와 40 GiB 확장은 완료했다. PR #45 문서 반영과 `0258483` 운영 배포를 마친 뒤, PR #44 원문을 최신 기본에 통합·보완한 PR #46도 병합·CI·운영 배포까지 완료했다. 현재 운영 SHA는 **`437f4e6`**, image는 `5788e112…`이며 11/3 22:14 KST 실제 앱·배포 영수증 일치, DB 3개·기존 설정·공개 8호스트 정상과 다른 서비스 17개 보존을 확인했다. 운영 합성 카드에서 미게시 변경·할 일 필터·검수 CTA와 필터 3개의 실제 높이 44px를 DOM 가시성/치수로 확인했다. 캡처는 시간 초과로 저장하지 못했으므로 화면 이미지·픽셀 검증으로 확대하지 않는다.

현재 남은 우선순위는 **11/4 03:20 KST 정규 백업 결과 확인 → 중간결과물 공동 통합·11/6 23:59 제출 확인 → 11/10 복구본 보존 검토 → 2단계 기능 하나 선택·설계**다. 박기성의 엔진·DB·보안·운영 원고는 준비됐으며 박효민의 비용 실측·한국어 품질·시연 영상과의 공동 통합 및 제출은 남아 있다. Owner 합성 텍스트 PDF 렌더 검증은 완료했지만 Reader·엑셀 고정 이력·모바일·운영체제 인쇄 창 저장·실물 프린터·장기 부하는 미검증이다. 시험 메일 수신 확인과 추가 이미지·복구본 삭제는 계속 보류한다.

[박기성 남은 작업·권장 일정](docs/qa/2026-11-03/park-gise-remaining-schedule.md) · [현재 작업 목록](docs/99_해야할일.md) · [PR #46 통합 보완 근거](docs/qa/2026-11-03/pr44-integration-fixes.md) · [최신 CI](https://github.com/P-GISE/GhostManual/actions/runs/41641300313) · [운영 배포](https://github.com/P-GISE/GhostManual/actions/runs/41642115347). 11/3 대회 제출 화면과 [공개 홈페이지](https://aion2026.vercel.app/)에서 중간결과물 마감 **11/6 23:59**를 확인했다(시간대 별도 표시 없음). 2단계는 선발 시 **11/13~12/11의 4주 활동 기간**이다. 공개 홈페이지의 현재 운영계획(안)에는 **12/11 최종보고서 제출 마감**도 명시돼 있다. 일정은 변경 가능하며 최종 마감 시각은 표시되지 않아 최신 공지를 재확인해야 한다. [제출 문안·자료 체크리스트](docs/qa/2026-11-03/park-gise-submission-handoff.md)를 따른다. PR #1·#2는 사용자 지시로 병합 없이 닫았고, 원 PR #44는 내용이 PR #46에 포함됐지만 작성자 브랜치·대상·열림 상태를 보존했다. 아래 날짜별 미배포·미암호화·백업 미확인 문구는 당시 이력이다.

## 2026-11-03 공유 호스트 루트 EBS 암호화 전환 완료

운영 루트를 동일 사양의 암호화 EBS로 교체하고 새 부팅·ZRAM·DB 3개·기존 컨테이너와 설정 보존·공개 8호스트·새 S3 백업 및 격리 복원을 검증했다. 앱 재배포·migration·IAM 확대·공간 정리는 하지 않았다. 미암호화 원본/스냅샷은 별도 승인 전 보존하며 쓰기 재개 후 원본 단순 복귀는 금지한다. [실행 근거·비용·한계](docs/qa/2026-11-03/ebs-encryption-cutover.md).

## 2026-11-02 PR #37 운영 반영 완료와 후속

PR #37은 전체 CI 후 사용자 승인으로 병합했고 PR #39 포함 6e02ae6을 자동 배포41436801029 attempt2로 운영에 반영했다. 실제 이미지·개인정보 백업 안내·앱 최소권한·백업 타이머·원본 설정 보존을 확인했다. [중간보고서 공동 편집본](docs/qa/2026-11-02/park-gise-interim-report.md), [운영 후속 계획](docs/superpowers/plans/2026-11-02-operations-followup.md), [보관 정책 제안](docs/qa/2026-11-02/data-retention-proposal.md)을 따른다. 디스크 여유 약1.26 GiB·EBS 미암호화·첫 예약 백업 미확인은 후속이며 제안만으로 데이터 삭제를 실행하지 않는다.

## 2026-11-02 운영 DB 권한·외부 백업 적용

앱 최소 권한 역할 전환과 실제 HTTP 검증, S3 암호화 백업·재다운로드·격리 복원, 매일 03:20 KST/30일 보관을 적용했다. EBS는 콘솔에서 미암호화로 확인했고 전환은 후속이다. 첫 예약 실행과 검토용 PR의 CI·병합 상태는 별도 확인한다. [운영 상태와 복구 절차](docs/운영_DB권한_외부백업_2026-11-02.md).

## 2026-11-02 PR #32 수정 검증

사용자 요청으로 최신 PR #32(689502a)를 다시 확인하고 보안/권한/동시성 결함을 별도 통합 브랜치에서 수정 중이다. 이전 셀 값은 소유자만 보도록 사용자가 확정했다. [검증 및 박기성 작업](docs/qa/2026-11-02/pr32-fixes.md). 이전 AI 비활성/배포 대기 문단은 당시 이력이며, 후속 사용자 요청으로 운영 AI 설정·최소 실제 호출을 확인했다. 이번 변경의 최종 CI·운영 적용 식별은 통합 PR의 실행 결과를 따른다. 현재 키 값은 문서에 기록하지 않는다.


## 2026-11-01 PR #27 통합 검증

파일 업로드·버전 비교·질문·매뉴얼/Reader·프로필 기능과 운영 설정 수정을 하나의 PR로 통합 검증 중이다. Anthropic 키 추가·실제 AI 호출은 제외하고 운영 AI는 비활성으로 유지한다. 아래 f6ee13f는 통합 이전 운영 기준이며 최종 배포 식별과 공개 검증은 통합 PR 실행 결과를 따른다. [수정 범위·검증 근거](docs/qa/2026-10-31/pr27-integration.md).


## 2026-10-31 현재 운영: f6ee13f·migration005

사용자의 직접 배포 요청으로 서버에서 빌드한f6ee13f 앱을 배포했다. 실제image da30626e…·DB001~005, 기존 계정·다른 서비스·터널 보존과 공개5경로200을 확인했다. 로컬 이미지는 사용하지 않았다. Actions 이미지 업로드 quota는 별도 미해결이며 서버 빌드 배포와 CI 성공을 구분한다. [운영 복구·배포 근거](docs/qa/2026-10-31/deployment-recovery.md)를 현재 기준으로 삼는다. 파일 버전 API·화면·AI 연결은 아직 별도 담당 통합 범위다.

## 2026-10-31 엑셀 엔진 작업

사용자의 PR #23 검토·박기성 담당 진행 요청에 따라 최신 설계/계획 `06b38b3`의 엔진 계약으로 `src/lib/xlsx/`와 합성 파일을 구현했다. DB `005`는 박효민 담당 구현과 통합할 **로컬 검토·검증용 제안본**이다. API·화면·AI 호출·운영 적용 완료를 뜻하지 않는다. [설계 검토](docs/qa/2026-10-31/pr23-review.md), [구현 계획](docs/superpowers/plans/2026-10-31-xlsx-engine.md), [DB·용량·백업 검토](docs/qa/2026-10-31/xlsx-schema-review.md)를 따른다. 아래 AI 보류·배포 상태는 날짜별 이력이며, 최신 PR의 로컬 AI 시연 추가와 실제 운영 AI 활성화는 구분한다.

갱신일: 2026-10-22 (KST). 현재 단계는 **제품 방향 A(작업 완료 파일 업로드·버전 비교·변경 질문) 확정과 설계 작성**이다. 공개 데모는 2026-10-19 배포 상태를 유지하고, AI는 비활성으로 유지한다.

## 제품 방향 확정 — 2026-10-22

사용자는 Windows 자동 수집(B, PR #1·#2) 대신 **A. 작업을 마친 업무 파일을 같은 자료의 새 버전으로 올리면 버전과 이유를 기록하고, 지원 형식(`.xlsx`부터)은 이전 버전과 비교해 바뀐 부분을 질문하며, 답변·버전을 매뉴얼에 쌓는 방식**으로 확정했다. 기존 웹 앱을 확장한다. 근거는 팀원 의견(작업 마무리 시 업데이트, 이전 버전을 불러와 확인)과, 앱 전환만 기록하는 B 설계로는 파일 안의 작업을 알 수 없다는 검토 결과다.

- 설계: [작업 파일 버전 비교·변경 질문 설계](docs/superpowers/specs/2026-10-22-file-version-questions-design.md). 방향은 사용자 확정, 세부 설계는 제안·미구현이다.
- 두 단계 구조다(2026-10-22 사용자 확정). 1단계는 허용 목록의 모든 업무 파일을 버전으로 저장하고 올린 사람·팀·시각과 기본 질문을 남긴다. 2단계는 내용 비교·변경별 질문이며 첫 지원 형식은 `.xlsx`다. Word·한글·PowerPoint 비교는 후속, 실시간 수집·클라우드 편집 기록 연동은 범위 밖이다.
- 질문은 AI 없이 정해진 틀로 만든다. OpenAI 저가 모델 연동은 사용자가 구상 중이며 보류 상태다.
- PR #1·#2는 현재 웹 앱 코드를 삭제하므로 그대로 병합하지 않는다. 닫거나 참고용으로 둘지는 팀 결정으로 남긴다.
- 이번 작업은 문서만 변경했다. 제품 코드·schema·배포·공개 서버는 바꾸지 않았다.

## 작업 방식 확정 — 2026-10-19 16:59 KST 이후

사용자는 Codex 클라우드의 직접 SSH/TCP 연결 문제를 이번 작업에서 제외하고 진행하기로 결정했다. 연결 복구를 프로젝트 후속 작업의 선행 조건으로 요구하지 않는다. 서버 명령이 필요한 경우 에이전트가 명령을 준비하고 사용자가 Windows Tailscale SSH에서 실행하며, 제공된 출력을 검토한다. 원격 실행 주체와 에이전트의 직접 공개 검증을 구분한다.

- 사용자 제공 접속 출력(2026-10-19 16:59:50 KST)에서 `tailscale ssh ubuntu@100.97.248.52`로 Ubuntu 24.04.4의 ubuntu 셸 접속 성공을 확인했다. PC→서버 VPN/인증 성공이며 Codex→서버 경로의 복구 증거는 아니다. 이 출력으로 앱/DB의 현재 상태를 새로 검증했다고 표시하지 않는다.
- 이번 새 클라우드 환경은 running/connected로 시작됐고 정책 파일은 `vpn_configured=true`, `tcp_network_access.domains=[]`, `ip_ranges=[]`였다. 상태 API의 HTTP policy state는 unknown이며 VPN 정상 동작을 보증하지 않는다. 이번에는 SSH를 재시도하지 않았다.
- 사용자 설정 화면에는 저장된 Tailscale 인증 키와 추가 허용 도메인100.97.248.52가 있다. 별도 TCP/CIDR 설정 UI는 확인되지 않았다. 과거의 ‘TCP 메뉴에100.97.248.52/32 입력’ 안내는 확인되지 않은 안내로 정정한다. 키 재발급·AWS SSH 포트 공개·Cloudflare/DNS 변경을 해결 절차로 요구하지 않는다. 향후 직접 연결 복구는 플랫폼의 지원/설정 적용 확인이 필요한 별도 작업이다.
- GitHub 기본 브랜치 `9b9d120bd99c06dc0ef9f3deb5ba0c13ea935576`에서 배포 완료 기록을 재확인했다. 이번 공개 GET은 HTTP200이며 WOFF2·CSS·라이선스 SHA256이 [최종 공개 측정](docs/qa/2026-10-19/public-after-results.json)과 모두 일치했다. 브라우저8화면·원격 image ID는 이번에 재검사하지 않았고 재배포도 하지 않았다.

디자인 배포 완료와 AI 비활성 상태를 유지한다. 서버 로그인 배너의 재시작/패키지 업데이트 안내는 이번 변경 범위에 포함하지 않으며 재부팅·패키지 업데이트를 실행하지 않았다.

## 현재 배포 — 2026-10-19

검증된 소스7efb284 이미지로 앱만 교체했다. 서버 명령은 사용자가 Windows Tailscale SSH로 실행하고 출력을 제공했으며, 공개 HTTPS·자산·Chromium 검사는 에이전트가 직접 수행했다. 클라우드의 SSH 프록시 자체가 복구된 것은 아니다.

| 항목 | 현재 확인 결과 |
|---|---|
| 서버 | ubuntu@lostark-party-aws, Tailscale100.97.248.52 |
| 실행 태그 | ghostmanual:7efb284ea0d4efbf428fbdebbd51f290fceb7ccd |
| manifest digest·서버 image ID | sha256:87e67bb88bd4e7a0f83a3abc8906810f010f36e9cb80e7127eb1b1deea4d19c8 |
| config digest | sha256:5a71fdca04de1d055ff82ce316c3435b0331c8746e9f71886a6aac708fecb69c |
| Next build ID | 5y9UxUDQ-Nt-MqGbXQUOK |
| 앱·DB | running, OOM=false, 재시작0; DB healthy·동일 container ID |
| 기존 서비스 | 사전 목록의 앱 외 container ID 모두 유지,3000·3100·3200 HTTP200 |
| 공개 확인 | 4경로×desktop/mobile8화면 HTTP200·Pretendard loaded8/8·본문 main 포커스8/8·가로넘침0 |

ZIP/전달 archive 해시와 OCI manifest→config 관계를 대조했다. 과거 ‘이미지 ID5a71…’는 config digest이며 서버 표시87e67…와 구분한다. 공개 WOFF2 해시는 원본과 일치하고 라이선스도 정상 제공된다. root 전용 롤백 설정과 이전 이미지 태그를 서버에 보존했다. DB migration·서버 빌드·DNS/터널 변경·전체 QA 재실행은 하지 않았다. [최종 실행 주체·오류 해결·서버 상태·공개 측정과 캡처](docs/qa/2026-10-19/deployment-complete.md)를 따른다. 아래의 미완료/미적용 표기는 각 시점의 배포 전 이력이다.

## 후속 정정: 서버 IP와 장비 이름 불일치

사용자가 Windows에서 `tailscale ssh ubuntu@100.108.2.6`를 실행한 출력은 대상 장비를 **lostark-party-windows**로 식별했다. 이후 `tailscale status`와 실제 SSH 성공으로 **lostark-party-aws =100.97.248.52**를 확인했다. 이전100.108.2.6/32 서버 허용 안내를 정정한다. 서버 식별/인증은 사용자 실행 출력 근거이며 에이전트 직접 서버 조회가 아니다. 클라우드 proxy8088 연결 거부는 목적지 인증 전의 별도 관찰이다.

## 배포 전 클라우드 직접 실행 — 2026-10-19 14:49 KST 이후

사용자 승인에 따라 현재 환경에서 서버 연결·이미지 다운로드·공개 상태를 직접 확인했다. 작업 시작 때 조회한 기본 브랜치는 `2580332719254f6b0c7f0c8c0faf2598beee016a`이며 PR #3/#4/#5 통합 이력을 확인했다. 해당 조회 기준으로 검증 제품 소스7efb284 이후 변경은 Markdown뿐이다.

**서버 앱 교체는 미실행**이다. `proxy:8088` CONNECT와 실제 SSH가 일반/권한 재시도 모두 연결 거부로 끝나 서버 인증 단계에 도달하지 못했다. VPN 설정은 있으나 TCP grant는 비어 있다. Tailscale SSH의 키/정책/추가 인증 문제라고 단정하지 않는다. 이미지 artifact 조회·다운로드는 API 프록시403으로 실패했으며 실제 만료 여부·새 이미지 ID는 미확인이다.

공개 Chromium4경로×desktop/mobile8화면은 HTTP200·가로넘침0이지만 Pretendard 미로딩, desktop main 폭1248px, 본문 이동 후 main 포커스0/8이었다. **새 디자인·글꼴·키보드 개선은 공개 화면에 미적용**이다. 이 공개 자산 관찰을 서버 이미지 ID·build ID 확인으로 확대하지 않는다.

`api.github.com`만 추가한 환경 설정 초안을 저장·재조회했다. 실행 환경 적용에는 설정 검토·저장과 게시가 필요하다. TCP 허용 설정은 현재 도구로 편집할 수 없으며, 대상은 위 후속 정정에 따라 AWS의 실제 IP 확인 뒤 결정한다. 실패 명령·오류·확인 경계·측정값과 캡처는 [이번 직접 실행 기록](docs/qa/2026-10-19/deployment-check.md)을 따른다. DB·기존 서비스·DNS·터널·AI를 변경하지 않았다. 3000/3100·DB의 현재 정상 여부는 이번 SSH 차단으로 재확인하지 못했다.

## 이전 채팅의 배포 연결 재점검 — 2026-10-19 14:25 KST

사용자가 새 디자인의 서버 배포와 공개 확인을 요청해 현재 채팅의 클라우드 연결을 직접 재점검했다. **서버 앱 교체는 미실행이며 새 디자인 공개 적용은 미완료**다.

- `git ls-remote origin refs/heads/feat/ghostmanual-mvp`에서 기본 브랜치 `067b59edace52938e8e95bdbd488d845aaf2d2f4`를 확인했다. 아래 과거 미병합 표와 구분한다.
- 환경은 running/connected, observations_current=true다. 현재 상태 API의 network policy state는 unknown이므로 enforced로 단정하지 않는다. 실행 환경의 `/etc/codex/network-policy.json`은 version1, `vpn_configured=true`, TCP CONNECT proxy8088, `tcp_network_access.domains=[]`, `ip_ranges=[]`다. VPN 설정은 VPN 정상 동작/서버 접속 성공의 증거가 아니다.
- SSH agent 변수는 없고 사용자 홈의 `.ssh` 디렉터리도 없다. 상태 API에 서버용 runtime variable/secret/outbound identity는 없으며 Cloudflare API token만 unknown으로 표시된다. Tailscale SSH 사용 가능 여부·추가 인증·서버 상태는 확인하지 못했다. TCP 허용이 없어 우회 접속을 시도하지 않았다.
- GitHub 커넥터로 artifact12134456501의 `expired=false`, 만료2026-10-19 20:06:24 KST, source7efb284·ZIP digest46202fbd…를 직접 확인했다. 커넥터 다운로드는 성공해 파일 참조를 확보했지만191152491bytes로 실행 환경 전송 한도32MiB를 넘어 로컬 전송은 실패했다. 로컬 ZIP 해시·Docker image ID는 새로 검증하지 않았다. `gh api`는 `https://api.github.com` 요청에서 Forbidden으로 실패했다. 이미지 재빌드는 실행하지 않았다.
- 공개 HTTPS는 curl로 HTTP200, private/no-store·CSP font-src self를 확인했다. HTML에 font preload가 없고 현재 CSS `/_next/static/chunks/2hb3twf9u61xl.css`에도 Pretendard/@font-face가 없다. 새 글꼴 공개 반영은 확인되지 않는다. 서버 실행 이미지 ID·build ID·데스크톱/모바일 정렬·키보드 동작은 이번에 검증하지 못했다.
- 저장소 밖 `/workspace/ghostmanual-update-design.sh`는 현재 환경에 없다. DB·데이터·3000/3100 서비스·DNS·터널·AI 설정은 변경하지 않았다. 전체 QA는 반복하지 않았다.

재개에 필요한 연결 설정: TCP 허용 범위에 `100.108.2.6/32`를 추가한 교체 환경과, 해당 환경에서 동작하는 서버 인증(Tailscale SSH 정책/필요한 사용자 인증 또는 안전하게 연결된 SSH 인증)이 필요하다. HTTP 허용 목록의 IP 등록만으로 raw TCP 접속은 허용되지 않는다. 이미지 로컬 확보에는 GitHub Actions 다운로드가 가능한 CLI 인증/HTTP 정책 또는 대용량 파일 전달 경로도 필요하다. 비밀 값을 채팅이나 Git에 기록하지 않는다. 현재 도구에는 환경 설정을 수정하는 기능이 없어 변경을 적용하지 못했다.

위 문단은 당시 안내 이력이다. 후속 Windows 출력에서 해당 IP가 Windows 장비로 식별됐으므로, 실제 AWS IP를 확인하기 전에는 이 IP로 TCP 허용을 설정하지 않는다.

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
| 현재 검증 제품 소스·실행 태그 | 7efb284ea0d4efbf428fbdebbd51f290fceb7ccd |
| 이전 서버 실행 태그 (이번 사용자 사전 출력에서도 확인) | 58d9ebd1eac5f80f7fb66364ece4950e87a25ebf |
| 공개 주소 | [ghostmanual.pigs0516.com](https://ghostmanual.pigs0516.com) |
| 제품 기술 | Node24·Next.js/React·TypeScript·PostgreSQL, Vitest·Playwright |
| AI | 비활성. 실제 연동·계정·예산·한국어 품질은 이번 완료 범위에서 제외 |

문서 commit과 실행 이미지 태그는 다르다. 문서 변경이 배포·이미지 갱신을 뜻하지 않는다. 예전 초기화/Windows Core 브랜치의 상태를 현재 웹 데모에 적용하지 않는다.

## 완료 근거와 출처

다음은 이전 공개 데모와 CI의 인계·저장소 QA 기록이다. 이번 디자인 배포의 직접 공개 검사는 위 현재 배포와 최종 보고서에서 구분한다. 전체 제품 QA는 반복하지 않았다.

- 공개 HTTPS HTTP200, desktop5/mobile5 합계10개 사용자 흐름 통과. 필터·버전 비교·검수·Reader 공유/검색/근거·공유 취소·원본 수정/재검수·저장 유지 확인.
- 검증용 합성 공간10개 삭제 후 접근 차단 확인. [공개 검증 기록](docs/qa/2026-10-17/public-https.md).
- 단위41·PostgreSQL 통합40·E2E24·빌드·타입 검사·린트 통과는 인계 결과다. 과거 단위41/통합39/E2E20 기록과 시점을 구분한다.
- 원격 식별은 사용자가 Tailscale SSH 추가 인증 후 ubuntu@lostark-party-aws에서 실행한 출력에 근거한다. 에이전트의 직접 원격 실행으로 표시하지 않는다. [원격 배포 기록](docs/qa/2026-10-17/remote-deployment.md).

## 배포 상태와 운영 경계

현재는 위7efb284 태그·manifest87e67…·config5a71…·build5y9Ux…를 확인했다. 앱127.0.0.1:3200 바인딩, DB 호스트 포트 비공개와 동일 DB 컨테이너를 유지했다. 이전58d9ebd 태그는 이번 사용자 사전 출력에서 확인했다. 그 이전 image ID419ee…와 build x6zb…는2026-10-17 인계 값이며 현재 새 앱 식별과 구분한다.

Cloudflare 터널은 기존 로컬 관리 방식을 유지한다. 완료된 DNS/터널 설정·배포·재시작·공개 검증을 이유 없이 반복하지 않는다. 이번 CI artifact ZIP·서버 전달 해시·OCI 식별과 실행 이미지는 대조했지만, 재현 빌드나 서명/attestation 검증으로 확대하지 않는다.

## 2026-10-17 키보드 접근성 수정 (배포 전 이력)

가이드 기반 계속 진행 요청에 따라 UX-KEYBOARD를 수행했다. ‘본문으로 이동’이 대상 main에 포커스를 옮기지 못하는 문제를 재현하고, tabIndex=-1과 화면 안쪽 포커스 표시를 적용했다. 로컬 배포 모드4경로×2뷰포트8개·단위41·타입·빌드·lint 검사를 통과했다. 전체 접근성 인증·실 기기/화면 낭독기 평가는 미검증이며, 원격 배포 상태는 바꾸지 않았다. [직접 실행 근거](docs/qa/2026-10-17/keyboard-accessibility.md).

## GitHub 반영과 다음 순서

| 항목 | 2026-10-17 조회 기록 (이번 디자인 작업에서 재조회하지 않음) |
|---|---|
| 가이드 [PR #3](https://github.com/P-GISE/GhostManual/pull/3) | open·미병합, 대상 feat/ghostmanual-mvp |
| 키보드 수정 [PR #4](https://github.com/P-GISE/GhostManual/pull/4) | open·미병합, 대상 docs/public-demo-guide. PR #3에 의존 |
| 수정 소스 CI | [push 실행](https://github.com/P-GISE/GhostManual/actions/runs/38940775088)·[PR 실행](https://github.com/P-GISE/GhostManual/actions/runs/38940826573) 모두 in_progress. 완료 결과 미확인 |
| 공개 배포 | 기존58d9ebd 태그의 인계 상태 유지. 160a754 적용 여부를 확인/배포하지 않음 |

위 표는2026-10-17 조회 이력이다. 현재는 PR #3/#4/#5 통합,7efb284 이미지의 앱 단독 교체와 공개 변경 확인을 완료했다. 추가 제품 작업은99의 남은 범위에서 정하며 DNS/터널 재구성·전체 공개 QA를 이유 없이 반복하지 않는다.

독립 리뷰의 모바일 테두리 비가시성 P2는 실패 테스트 후 inset offset으로 수정했고 최종8개 검사가 통과했다. 전체 lint는 종료0이지만 기존 warning1/info66은 남아 있다. 가이드의 로컬 성공을 원격 CI 성공이나 공개 적용으로 표시하지 않는다.

## 전체 디자인 개선 — 2026-10-18

사용자의 전체 개선·좌우 대칭·글꼴 요청에 따라 공통1200px shell과 가운데 읽기 열, 동일 폭 문서/검수 열, 자체 호스팅 Pretendard를 적용했다. 문서함·등록·편집·공유·정책 화면과 모바일 시작 버튼까지 정리했다. 로컬 화면42개·단위41개·타입·빌드·lint 검증을 통과하고 독립 리뷰를 마쳤다. 10개 화면×3크기 캡처30장을 남겼다. Docker의 public 자산/라이선스 복사를 추가했다. 검증 결과·이미지·합성 데이터의 경계는 [디자인 QA](docs/qa/2026-10-18/design-refresh.md)에 기록한다. 운영 서버에는 아직 반영하지 않았다. AI 보류·기존 공개 배포 기준은 유지한다.

## 디자인 업데이트 후속 — 2026-10-18

사용자의 업데이트 요청으로 실제 PostgreSQL을 포함한 CI를 실행했다. 원본 버전 표시의 옛 문구를 찾던 E2E 기대값을 현재 한국어 문구로 수정했다. 소스 `7efb284ea0d4efbf428fbdebbd51f290fceb7ccd`의 lint·타입·단위·DB migration/통합·빌드·E2E·디자인/접근성 단계는 통과했다. Docker 이미지 생성과 artifact 업로드도 성공했다. 단위41·통합40·E2E24·화면42개를 CI 로그에서 직접 확인했다. 이미지 식별과 통합 PR 상태는 [업데이트 기록](docs/qa/2026-10-18/release-update.md)을 따른다. 위 PR 표는 과거 조회 기록이다.

현재 작업 환경은 VPN·TCP 대상·서버 인증이 연결되어 있지 않아 원격 앱 교체와 공개 디자인 확인은 대기 상태다. 이전 환경의 접속 상태와 구분하며 DB·DNS·터널은 변경하지 않았다. GitHub 반영을 공개 배포 완료로 표시하지 않는다.

## 남은 범위

- 실제 AI는 사용자 지시로 제외·보류한다. 별도 작업 지시 전 키/예산 요구·실 호출·AI 활성화를 진행하지 않는다. 추후 활성화한다면 품질·비용·전송 정책을 함께 검토한다.
- 지속 부하·전체 접근성 인증·이미지 provenance는 별도 미검증이다. 현재 장애 또는 공개 데모 완료의 미충족 조건으로 단정하지 않는다.
- 다음 제품 작업은 [99 해야할일](docs/99_해야할일.md)의 남은 범위에서 정한다. 2026-10-22 결정으로 파일 버전 기록(모든 허용 형식)과 `.xlsx` 내용 비교(FILE-VERSION)를 앞당겼으며, 다른 형식의 내용 비교·의미 검색·외부 연동은 임의로 착수하지 않는다.

## 문서 작업 절차

[AGENTS](AGENTS.md)와 [00 문서 가이드](docs/00_문서_가이드.md)를 진입점으로 01~10·99를 함께 프로젝트 가이드라 부른다. 상세 요구사항·설계와 과거 결과는 원문을 보존하고 날짜별 이력으로 구분한다.

[제품 정의](docs/requirements/제품_정의_프롬프트.md) · [상세 설계](docs/superpowers/specs/2026-10-03-ghostmanual-mvp-design.md) · [파일 버전 설계](docs/superpowers/specs/2026-10-22-file-version-questions-design.md) · [구현 계획](docs/superpowers/plans/2026-10-03-ghostmanual-mvp.md) · [진행 기록](docs/구현_진행_기록.md) · [점검 ledger](docs/10_파일_점검_현황.md)
