# GhostManual 프로젝트 가이드

갱신일: 2026-10-17 (KST). 현재 단계는 **AI 비활성 공개 데모 배포·검증 완료, 후속 작업 대기**다.

## 제품과 현재 범위

GhostManual은 업무 원본 자료를 사람이 검수한 매뉴얼로 남기고 후임자가 게시 버전과 원문 근거를 확인하는 한국어 웹 서비스다. Source(원본)·Manual(검수 매뉴얼)·Answer(근거 답변), 작성자·Reader 권한, 게시 revision을 구분한다.

텍스트/TXT/Markdown 입력 → 초안 편집·검수 → 불변 게시 버전 → Reader 공유·검색·근거 확인을 제공한다. 원본 수정 시 재검토하고 공유 취소·자료 삭제·보관 정책을 적용한다. 합성 예제와 실제 AI 출력을 구분한다.

## 작업 기준

| 항목 | 기준 |
|---|---|
| 저장소 | [P-GISE/GhostManual](https://github.com/P-GISE/GhostManual) |
| 기본 브랜치 | feat/ghostmanual-mvp |
| 이번 문서 작업 시작 commit | d493c8cd9170b304486230d1e891916a70cd459c |
| 검증된 제품 소스·실행 앱 태그 | 58d9ebd1eac5f80f7fb66364ece4950e87a25ebf |
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

앱 이미지 ID는 `sha256:419ee46b31617999150b7841ce6e7ccb650b6065441b4531cf115dceb4e33ca8`, 원격 Next build ID는 `x6zb-rufDOdAIMgz8oWRv`다. 인계 출력에서 앱·DB running, OOM=false, 재시작0, DB healthy를 확인했다. 앱은127.0.0.1:3200에 바인딩되고 DB 호스트 포트는 공개하지 않는다.

Cloudflare 터널은 기존 로컬 관리 방식을 유지한다. 완료된 DNS/터널 설정·배포·재시작·공개 검증을 이유 없이 반복하지 않는다. 로컬/원격 build ID는 다르며 전체 소스 동일성·CI 이미지 digest 일치는 미검증이다. 정적 자산 해시 일치나 이미지 태그만으로 이를 보증하지 않는다.

## 남은 범위

- 실제 AI는 사용자 지시로 제외·보류한다. 별도 작업 지시 전 키/예산 요구·실 호출·AI 활성화를 진행하지 않는다. 추후 활성화한다면 품질·비용·전송 정책을 함께 검토한다.
- 지속 부하·전체 접근성 인증·이미지 provenance는 별도 미검증이다. 현재 장애 또는 공개 데모 완료의 미충족 조건으로 단정하지 않는다.
- 다음 제품 작업은 [99 해야할일](docs/99_해야할일.md)의 남은 범위에서 정한다. PDF/Office·의미 검색·외부 연동을 임의로 착수하지 않는다.

## 문서 작업 절차

[AGENTS](AGENTS.md)와 [00 문서 가이드](docs/00_문서_가이드.md)를 진입점으로 01~10·99를 함께 프로젝트 가이드라 부른다. 상세 요구사항·설계와 과거 결과는 원문을 보존하고 날짜별 이력으로 구분한다.

[제품 정의](docs/requirements/제품_정의_프롬프트.md) · [상세 설계](docs/superpowers/specs/2026-10-03-ghostmanual-mvp-design.md) · [구현 계획](docs/superpowers/plans/2026-10-03-ghostmanual-mvp.md) · [진행 기록](docs/구현_진행_기록.md) · [점검 ledger](docs/10_파일_점검_현황.md)
