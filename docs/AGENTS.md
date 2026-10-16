# GhostManual 작업 지침

이 문서 안의 코드 경로는 별도 설명이 없으면 저장소 루트 기준이다.
먼저 docs/PROJECT_GUIDE.md와 docs/00_문서_가이드.md를 읽고, 구현 작업은 상세 설계·구현 계획·docs/구현_진행_기록.md를 함께 확인한다.
사용자 지시와 승인 이력은 파일의 기본 절차보다 우선한다. 완료된 작업을 기억만으로 재실행하지 말고 파일·실행 결과·Git 이력을 확인한다.
현재는 승인된 구현 계획 실행 단계다. 제품 기능이 존재한다고 가정하지 않는다. source·manual·answer, 검수 여부·revision·workspace 권한을 구분한다.
기존 서비스·다른 작업자의 변경을 되돌리지 않는다. 비밀 값·토큰·개인 연락처는 문서·로그·Git에 기록하지 않는다.

## 문서별 작업 라우팅

작업을 시작할 때 `docs/00_문서_가이드.md`의 작업 종류 표로 주관 문서와 연결 문서를 선택하고 `docs/99_해야할일.md`에 작업 ID·범위·완료 조건을 정한다.
01=범위·시스템, 02=기능, 03=DB, 04=API, 05=업무 흐름, 06=프런트, 07=백엔드, 08=운영·배포, 09=위험·결함, 10=조사·검증 근거, 99=할 일·진행 상태다.
해당 문서의 “이 문서로 작업하기”를 읽고 실제 코드와 기존 Git·검증 이력을 확인한다. 최초 설계의 미구현 상태를 현재 상태로 복사하지 않는다. 미확인 항목을 추정으로 채우지 않는다.
새 동작은 Superpowers 설계·계획, 결함은 원인 조사, 구현은 관련 회귀·리뷰·실행 검증을 적용한다. 오탈자·문서 연결 변경만 있으면 내용·링크 검증을 수행한다.
작업 종료 시 주관/연결 문서, `docs/10_파일_점검_현황.md`, `docs/구현_진행_기록.md`, 99의 상태와 다음 행동을 갱신한다. 코드 작성·검증·PR·병합·배포를 별도로 기록한다.
`docs/99_해야할일..md`는 사용자 요청 파일명의 연결 문서다. 실제 목록은 한 점 파일명 `docs/99_해야할일.md` 한 곳에서 관리한다.

## 개발 도구

[개발 도구 가이드](개발_도구_가이드.md)와 `make -f tools/Makefile help`를 참고한다.
기본 작업 절차는 Superpowers, 기획은 PM Skills, 재사용·간소화 검토는 Ponytail을 사용한다. 저장소·사용자 지시가 plugin 기본값보다 우선하며 필수 검증·권한 확인을 줄이지 않는다.
LazyCodex는 사용자가 선택한 작업에서 대체 오케스트레이터로 사용한다. 같은 작업에 Superpowers와 LazyCodex 계획·반복 루프를 중복 실행하지 않는다.
Iron Laws 전체 점검의 기존 지적과 PR 변경 파일 점검을 구분한다. 도구의 오탐을 확인 없이 규칙 비활성화·baseline 등록으로 숨기지 않는다.
OmniRoute와 Headroom은 개발자 도구이며 제품 AI 제공자 설정이 아니다. 압축은 한 계층부터 평가하고 두 도구의 압축을 중복 활성화하지 않는다.
`.dev-tools/`, `.codegraph/`, `strix_runs/`는 로컬 산출물이다. 실제 업무 원문·키를 테스트 입력이나 보고서에 넣지 않는다.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
