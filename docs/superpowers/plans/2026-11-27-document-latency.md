# 문서함·파일 등록·읽기 지연 단축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권한·원본 보존을 유지하면서 사용자 대기 시간을 구간별로 측정하고 가장 작은 개선부터 선택한다.

**Architecture:** 현재 인증/RR/단일 문서 작업 경계를 유지한 채 요청 수·응답 바이트·DB/큐/파서/화면 시간을 분리한다. 계측 뒤 한 병목씩 독립 PR로 수정하고 같은 fixture·자원 조건에서 비교한다. 이 문서는 준비안이며 아래 성능 구현과 벤치는 아직 실행하지 않았다.

**Tech Stack:** Node26.13.1, Next16.4.6, PostgreSQL18, Playwright, 기존 문서/격리 엔진. 새 의존성은 우선 추가하지 않는다.

**Spec:** [지연 단축 범위](../specs/2026-11-27-document-latency.md)

## Global Constraints

- 운영 앱/워커·DB014·backfill·대표 지정·공유 서버 부하 시험은 실행하지 않는다.
- 버전 문서5MiB·TXT/Markdown256KiB·원본/버전·용량 합산·검사 전 게시 차단·Owner/Reader·완료 시 권한 재확인·AI 전송 범위를 유지한다.
- metadata 캐시·요청 병렬화는 권한 판단을 대체하지 않는다. 쿠키/문서함 전환과 늦은 응답을 구분한다.
- 기존 파서46표본은 전체 HTTP/DB/UI 지연의 실측 자료가 아니다.
- 실제 사용자 자료·토큰·연락처·외부 AI/메일을 사용하지 않는다.

## Review Focus

- 이전 소속/Reader/로그아웃 응답이 새 화면에 표시되지 않는가.
- 202 접수를 추출 완료로 표시하거나 검사 전 게시 가능하게 만들지 않는가.
- 큰 소속/업무/추출 블록에서도 목록을 조용히 자르거나 카운트를 허용되지 않은 자료로 계산하지 않는가.
- 실패·권한 회수·네트워크 지연이 재시도 중복 저장이나 잘못된 성공 표시를 만들지 않는가.
- 큐 병렬/폴링 변경이 공유 메모리·DB 잠금·기존 서비스 자원을 악화시키지 않는가.

### Task 1: 격리 기준선과 계측 경계

**Files:** 제안 tests/performance/measure-user-flows.ts, 기존 tests/performance/measure-native-documents.ts·tests/fixtures/documents/native/build.ts·tests/e2e/helpers.ts 재사용 검토. 보고서는 docs/qa에 둔다.

- [ ] 합성 로그인/팀/문서 fixture와 case별 구간·샘플 수·워밍업·이미지/자원 manifest를 설계한다.
- [ ] 요청 수·바이트·클릭→접수·큐→claim·파서→저장·저장→화면과 SQL 잠금 대기를 기록하는 가장 작은 격리 harness를 작성한다.
- [ ] 중복 요청/202 후 reading/권한 회수/오류 응답을 포함해 계측이 실제 상태 경계를 구분하는지 실패 사례로 검증한다.
- [ ] native 대표 사례 smoke 후 최소30회 비교 표본으로 p50/p95·실패율·RSS/CPU/OOM을 기록한다. 전체 큰 행렬은 별도 예산으로 실행한다.
- [ ] 기존 전체 권한/세션/문서 검증과 함께 CI 확인 후 독립 검토·작은 PR로 반영한다.

### Task 2: 현재 문서함 메타데이터와 초기 자료 왕복

**Files:** src/components/Teams.tsx, SourceForm.tsx, SourceDetail.tsx, FileVersions.tsx, src/lib/teams.ts, src/app/api/session/route.ts·workspaces/route.ts 및 관련 통합/E2E.

- [ ] Task1에서 metadata/순차 요청의 실제 기여 시간을 확인한다.
- [ ] 현재 문서함 전용 응답 또는 동일 요청 범위 중복 제거 중 작은 안을 선택한다. 세션 role을 먼저 확정하고 새 DTO의 노출 범위를 정한다.
- [ ] 실제 rename→CSR, Owner/Reader 선택, logout/문서함 전환·권한 회수·지연 응답을 RED로 고정한다.
- [ ] 최소 구현 후 요청 수·바이트·p50/p95를 동일 조건으로 비교한다. 데이터 노출·오류율 악화 시 채택하지 않는다.
- [ ] CI·검토·PR 단위로 완료하며 전환 reload 자체를 임의 제거하지 않는다.

### Task 3: 개요 SQL와 집계 비용

**Files:** src/lib/overview.ts, teams.ts, session.ts, 관련 tests/integration/overview*.test.ts. 실제 기존 테스트 파일명을 착수 시 확인한다.

- [ ] 팀/업무 행렬에서 counts·팀 통계·페이지 SQL의 실행 계획·읽은 행·실행/잠금 대기를 나눈다.
- [ ] 인덱스 또는 같은 RR 내 중복 집계 축소 중 근거 있는 최소안을 선택한다. 인덱스가 필요하면 별도 migration 검토로 분리하며014 실행과 섞지 않는다.
- [ ] 소속 회수 경합·페이지 경계·검색/상태 전체 수·개인 자료/공유 보존을 먼저 회귀로 검증한다.
- [ ] 실제 개선과 자원 상한을 비교한 뒤 CI·독립 검토·PR로 반영한다. 잠금을 근거 없이 제거하지 않는다.

### Task 4: 처리 상태 응답과 큰 상세 읽기

**Files:** src/components/FileVersions.tsx, TemplateDetail.tsx, DocumentChanges.tsx, src/lib/document-sources.ts·template-extraction.ts 및 해당 GET route.

- [ ] 처리 중 상세 재수신 바이트와 완료→화면 감지 시간을 측정한다.
- [ ] status만 받는 작은 응답→완료 시 상세1회, 또는 블록 페이지/펼칠 때 읽기 중 한 변경만 선택한다.
- [ ] 오래된 revision·완료 직전 권한 회수·폴링 실패/재시도·Reader 원문 비노출을 RED로 고정한다.
- [ ] 기존 상태 머신·게시 차단·요청 취소를 보존하며 구현하고 바이트·SQL·화면 지연을 비교한다.
- [ ] 폴링 간격 단축·SSE는 결과를 보고 별도 판단한다.

### Task 5: 큐와 외부 변환/OCR

**Files:** src/lib/document-jobs.ts, scripts/document-jobs.ts, src/lib/document-extractor.ts, services/document-extractor의 기존 격리 설정·테스트.

- [ ] 전용 격리 환경과 합성 원본 대조를 준비한 뒤 native/외부 변환/OCR의 큐 대기와 실제 처리 시간을 나눈다.
- [ ] 긴 OCR 앞뒤의 짧은 문서·양식 공정성을 확인한다. 기존1초 idle/2초 UI polling의 실제 기여를 별도 계산한다.
- [ ] 완료 시 권한 회수·job 실패/재시도·중복 claim·OOM 시 복구를 먼저 검증한다.
- [ ] 병렬 수/스케줄 변경은 전체 자원 예산과 새 격리 검증 후 별도 설계·승인한다. 운영 자원 증설과 실배포는 이 계획의 자동 실행 대상이 아니다.

## 완료 기준

구간별 근거와 같은 조건의 변경 전후 결과가 있고, 권한·원본·안전 거부·실패 보존 회귀가 유지돼야 한다. 현재는 성능 목표 수치·서비스 지연을 실측하지 않았으며, 기준선 뒤 상대 개선 목표를 정한다.
