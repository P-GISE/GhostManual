# PR #23 파일 버전 DB 검토

검토일: 2026-10-31 KST. 기준: 기본 브랜치 `131a709`, PR #23 `06b38b3d247adaf9e9bd443027e4213579376eba`의 상세 설계와 구현 계획. 새 로컬 작업 공간에서 검토했다. 운영 DB·서버 설정·배포는 변경하지 않았다.

## 결론과 담당 경계

`005_file_versions.sql`과 통합 테스트는 **박기성의 로컬 제안·검증본**이다. PR #23의 최신 구현 계획은 실제 migration 반영을 박효민 담당으로 지정하므로, 이 파일을 공유 구현에 반영하기 전에 박효민 구현과 하나로 합쳐야 한다. 기존 PR이나 다른 사람의 브랜치는 수정하지 않았다. 조회 시 열린 PR 중 `005_file_versions.sql`을 변경하는 PR은 없었다.

기존 001~004 schema, 불변 트리거, migration runner, workspace 쓰기 잠금을 확인했다. 새 열·테이블은 기존 텍스트 자료와 계정을 보존한다. 기존 `source_revisions.text`의 DB 최소 길이는 설계대로 100자에서 1자로 완화한다. 텍스트 입력의 100자 검증은 기존 앱 schema가 유지한다. 단독 migration만으로 파일 업로드 API가 구현되는 것은 아니다.

## 설계·계획의 불일치와 보강

| 항목 | 검토 결과와 반영 |
|---|---|
| 질문과 변경 묶음 연결 | 상세 설계는 `change_group_ids uuid[]`, 최신 계획 Task 1은 `group_positions integer[]`다. 엔진 `groupIndexes`와 연결되는 최신 계획을 채택했다. API는 변경 묶음을 먼저 INSERT한 뒤 질문을 INSERT한다. |
| 배열 참조 무결성 | 배열에는 일반 FK를 걸 수 없다. 질문 INSERT/UPDATE 트리거가 동일 workspace·revision의 실제 position만 허용하고 NULL position도 거부한다. 직접 DB에서 변경 묶음만 삭제하는 작업은 지원하지 않는다. 삭제 API는 원본·계정 CASCADE를 사용해야 한다. |
| 질문 수정 범위 | 질문의 id·소속 revision·위치·종류·연결 position·문구·생성 출처는 고정하고 답변·건너뛰기·답변 시각만 수정한다. 게시 이력은 기존 `manual_versions` 불변 트리거로 고정된다. |
| 파일 용량 | `size_bytes = octet_length(content)`를 강제한다. 선언 크기를 줄여 용량 집계를 속이는 행과 5 MiB 초과 행을 거부한다. SHA-256 실제 계산은 저장 API가 담당한다. |
| JSON 형식 | snapshot은 `{v:1,sheets:[],names:[]}`, history는 `{v:1,revisions:[]}`의 최상위 형식을 DB에서 검사한다. 세부 셀·질문 계약은 앱 경계 검증이 필요하다. |
| AI 요약 | `source_files`가 불변이므로 AI 요약·대체 결과를 확정한 다음 INSERT해야 한다. INSERT 후 비동기 UPDATE는 실패한다. |
| 용량 경쟁 | 100 MiB는 DB CHECK로 전역 합산하지 않는다. 기존 `assertSession`이 잠그는 workspace 행의 동일 트랜잭션 안에서 원본 합계·신규 크기·revision을 재확인하고 INSERT해야 한다. AI 호출 후에도 재확인해야 한다. 이 저장 API 구현은 박효민 담당이다. |
| 날짜·개인정보 | 소속·이름은 업로드 당시 값으로 revision에 고정된다. 개인 값·실제 업무 파일·키는 이번 테스트에 사용하지 않았다. |

## 용량 판단

파일당 5 MiB·계정 원본 합계 100 MiB는 로컬 중간평가를 위한 상한으로 유지한다. 운영 서버에 충분하다는 승인은 아니다. 예를 들어 최대 사용 계정 10개는 원본만 약 1 GiB, 100개는 약 10 GiB다. 실제 필요한 공간에는 snapshot JSON, TOAST·인덱스, WAL, 임시 처리 공간, 백업이 추가된다. 압축 파일보다 JSON 스냅샷이 훨씬 커질 수 있어 원본 100 MiB만으로 계정의 전체 DB 사용량이 묶이지 않는다.

운영 배포 전에는 현재 디스크 여유·DB 크기·동시 처리 메모리·예상 계정 수를 실측하고 서비스 전체 저장 예산과 중단 기준을 정해야 한다. 기존 서버의 과거 가용 메모리를 이번 안전성 근거로 재사용하지 않았다. 압축 해제 한도는 엔진에서 실제 해제량을 기준으로 지켜야 하며, API의 동시 업로드 제한은 별도다.

## 백업·복구 제안 (미설치)

기존 데모의 본문 백업 없음 정책과 영구 계정 데이터 정책을 구분해야 한다. 다음은 운영 전 팀이 확정할 안이며 이번에 실제 데이터를 복제하거나 예약 작업을 설치하지 않았다.

- 일 1회 일관된 PostgreSQL 논리 백업을 암호화한 별도 저장소에 보관하고, 우선 7일 보관을 검토한다. 이 경우 목표 복구 시점은 최대 24시간 전이다.
- DB 운영 디스크와 백업을 분리하고 접근 주체·암호키 관리·보관 비용을 정한다. 백업 성공만으로 복구 가능을 판단하지 않는다.
- 별도 복구용 DB에서 계정·파일 원본 해시·버전·답변·게시 이력을 복원해 확인하고 복구 소요 시간은 측정 후 기록한다.
- 계정/자료 삭제가 백업 잔존 기간과 일치하도록 개인정보 안내를 수정하고, 복구 시 삭제한 자료가 다시 서비스되지 않게 삭제 반영 절차를 정한다.
- migration 실패는 기존 runner의 트랜잭션으로 전체 롤백한다. 005 적용 후 앱 롤백은 추가 열·테이블을 보존하는 이전 앱 복귀를 우선하며 파괴적 down migration은 만들지 않는다.

## 직접 검증

로컬 PostgreSQL 18.4의 새 전용 DB `ghostmanual_xlsx_engine_test`만 사용했다. 테스트는 트랜잭션 안에 임의 schema를 만들고 001~004 적용 → 기존 자료 삽입 → 005 적용 순서를 실행한 뒤 롤백한다. 따라서 기존 자료 보존을 실제 이전 schema에서 검증한다.

| 시나리오·명령 | 관찰 결과 | 실행 기록 |
|---|---|---|
| 005 작성 전 `npx vitest run --project integration tests/integration/file-version-schema.test.ts` | 종료 1. 005 파일 부재로 suite 실패, 8개 미실행. 기능 구현 전 RED이며 개별 assertion 실패는 아님 | `.omo/evidence/xlsx-schema/red.log` |
| 같은 명령, 005 추가 후 | 종료 0, 8/8 통과. 기존 자료·5 MiB 경계·크기 위조·workspace 격리·JSON 형식·불변성·그룹 참조·답변 상태·CASCADE 검증 | `.omo/evidence/xlsx-schema/green.log` |
| `npm run db:migrate` | 종료 0, 005 적용 성공 | `.omo/evidence/xlsx-schema/migrate.log` |
| `npm run test:integration` | 종료 0, 14파일·83테스트 통과 | `.omo/evidence/xlsx-schema/integration.log` |
| `npx biome check --write tests/integration/file-version-schema.test.ts` | 종료 0. 형식 정리, 기존 코드와 같은 env 인덱스 접근에 info 1개 | `.omo/evidence/xlsx-schema/biome.log` |
| `npm run typecheck` | 종료 0 | `.omo/evidence/xlsx-schema/typecheck.log` |

실제 API 저장·동시 업로드·Reader 다운로드·AI 호출·백업 복원·운영 용량은 이 schema 테스트의 검증 범위에 포함하지 않는다.
