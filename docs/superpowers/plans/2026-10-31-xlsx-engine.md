# 엑셀 분석 엔진·DB 검토 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 작업별 RED → GREEN을 기록한다.

**Goal:** 박기성 담당의 안전한 xlsx 읽기·결정적 비교·규칙 질문과 검증된 로컬 migration을 제공한다.
**Architecture:** DB·HTTP를 모르는 순수 엔진. API 담당은 엔진 결과의 groupIndexes를 change_groups.position으로 저장한다. 기존 텍스트 흐름은 수정하지 않는다.
**Tech Stack:** 기존 Node24/npm·TypeScript·Vitest·PostgreSQL, fflate 0.8.3, fast-xml-parser 5.11.2.
**Spec:** PR #23 head `06b38b3`, `docs/superpowers/specs/2026-10-30-xlsx-version-detail.md` 3·6·7·11절 및 `docs/superpowers/plans/2026-10-30-xlsx-versions.md` Task0/E1~E4. 해당 PR의 원문은 다른 작업자 소유로 수정하지 않는다.

## 범위와 설계 검토
- 사용자 2026-10-31 요청으로 설계 검토 후 박기성 담당 구현을 진행한다. API·화면·AI 호출은 박효민 담당으로 유지한다.
- 영향 파일: src/lib/xlsx/**, tests/unit/xlsx*, tests/fixtures/xlsx/**, db/migrations/005_file_versions.sql, tests/integration/file-version-schema.test.ts, package/lock, 이 계획 및 QA/진행 문서.
- 불변식: 파일 5 MiB, 해제 합계 20 MiB, XML 10 MiB, 시트20·셀50000. 초과는 원본 보관용 limit_exceeded, 악성·손상은 unsafe_file. 해제 한도를 초과하도록 메모리를 할당하지 않는다.
- source_files의 size_bytes=octet_length(content), 동일 workspace/revision의 질문-변경 연결, history 최소 구조를 보강한다. 기존자료 삭제·변경·운영 migration은 하지 않는다. 최신 계획에서 005 파일 작성은 박효민 담당이므로 여기서는 검토·로컬 검증용 제안본으로만 준비한다.
- 용량 SUM은 API 담당이 기존 workspace 행 잠금을 획득한 동일 transaction 안에서 확인해야 한다. 파일만의 100 MiB는 DB 전체·WAL·스냅샷·백업 용량 보장이 아니다.
- AI 요약은 불변 file INSERT 전에 확정한다. 엔진은 AI 호출·네트워크·로그를 하지 않는다.

## Review Focus
1. ZIP 크기 위조·중복 경로·DTD·매크로·외부 관계: 안전 거부, 실제 해제량 제한.
2. 공유/절대/혼합 참조·문자열 안 A1: 잘못된 수식 비교 금지.
3. 셀 캐시 값·삽입 순서·정확히10개 변경: 안정정렬·질문 상한.
4. 기존 자료·다른 workspace·계정 삭제: migration 보존·FK·CASCADE.
5. 운영 용량/백업: 측정 없이 승인하지 않음, 로컬 합성 데이터만 검증.

### Task 1: xlsx 읽기
- [x] 위험·정상·한도·공유 수식 테스트 작성 및 RED 확인.
- [x] readXlsx(Uint8Array) → compared+snapshot | limit_exceeded(snapshot 속성 없음) 구현.
- [x] 합성 정산_1029.xlsx/정산_1030.xlsx와 실행 가능한 생성 근거 작성.
- [x] 관련 단위 테스트 GREEN 확인.

### Task 2: 비교·규칙 질문
- [x] 변경 종류·수식 grouping·질문 0/10/11개·행재정렬 테스트 RED.
- [x] compareSnapshots, buildQuestions, 초기/한도 질문 구현.
- [x] 안정정렬·셀 값 비노출·공유수식 이동 GREEN.

### Task 3: migration·용량·백업
- [x] 기존 001~004와 제안 schema 비교 및 회귀 테스트 RED.
- [x] 005 additive migration 및 로컬 실제 PostgreSQL 테스트 GREEN.
- [x] 용량 조건부 검토·백업 제안·API 통합 필수 계약 기록.

### Task 4: 통합 검증·인계
- [x] npm test, typecheck, lint, build, 로컬 schema 통합 검사.
- [x] Iron Laws 시도(허용 경로 밖 거절 기록), 독립 코드 리뷰의 P1 두 개 수정 및 회귀.
- [x] 실제 명령·결과·미검증 경계와 호출 예제를 QA/진행 기록에 반영.

사용자가 구현 결과를 확인한 뒤 최종 검사·커밋·PR을 요청했다. 재검증과 독립 최종 리뷰 통과 후 엔진·DB·문서를 나누어 커밋하고 PR로 제출한다. 원격 PR 병합·운영 배포는 이번 작업에서 실행하지 않는다.
