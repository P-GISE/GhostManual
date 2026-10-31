# PR #23 설계 검토와 실행 범위

검토일: 2026-10-31 KST. 기본 소스 `131a709`, PR #23 head `06b38b3`. 사용자 요청: 설계부터 검토하고 박기성 담당 작업을 우선 진행.

## 결론

엑셀 엔진을 HTTP·DB·AI와 분리하는 접근과 `.xlsx` 한정 범위를 유지한다. API·화면 작업과 동시에 진행할 수 있도록 최신 구현 계획 Task0의 정확한 계약을 따른다. UI·AI 호출은 이번 구현 범위에서 제외한다. 원격 설계 PR을 임의 수정하거나 병합하지 않는다.

## 발견한 차이와 결정

| 발견 | 이번 처리 |
|---|---|
| 상세 설계는 질문의 change_group_ids uuid[], 구현 계획 Task1은 group_positions integer[] | 최신 계획을 적용. 엔진은 ID 없이 결정적 배열을 반환하며 질문은 groupIndexes로 참조한다. DB에서 같은 버전의 position만 허용한다. |
| ReadResult 한도 초과 구조가 설명마다 모호함 | Task0대로 `{ status: 'limit_exceeded' }`; snapshot:null 속성을 추가하지 않는다. |
| 상세 설계11절 migration 검토는 박기성, 계획 Task1 파일 작성은 박효민 | 박기성 검토 및 로컬 검증용 005 제안본을 준비. 작성자 통합 확인 전 원격 적용·병합하지 않는다. |
| 100 MiB 용량은 SUM 조회만 제시 | 기존 workspace 행 잠금과 동일 트랜잭션에서 확인해야 동시 업로드를 막는다. API 인계 필수사항으로 명시한다. |
| size_bytes를 실제 bytea 길이와 비교하지 않음 | 일치 CHECK로 허위 용량 집계를 방지한다. |
| 파일/스냅샷 immutable이나 AI 요약 갱신 시점이 불명확 | 파싱·AI를 트랜잭션 밖에서 마치고 쓰기 직전 revision·권한·용량 재검증, 요약과 함께 INSERT한다. |
| 한도 초과 XML을 끝까지 조사하면 자원 제한과 충돌 | ZIP 메타데이터를 먼저 검증하고 실제 해제량도 제한한다. 제한으로 분석하지 못한 원본은 분석 안전 인증을 뜻하지 않는다. API는 attachment로만 내려주고 브라우저 렌더링하지 않아야 한다. |
| 루트 가이드는 AI 보류, 최신 PR은 로컬 AI 시연 추가 | 이번 엔진은 규칙 질문만 구현. AI 담당 코드·실제 키·운영 활성화는 변경하지 않는다. |

## 인계 계약

`src/lib/xlsx/index.ts`에서 readXlsx, compareSnapshots, buildQuestions 및 Cell·SheetSnapshot·Snapshot·ReadResult·ChangeKind·ChangeGroup·RuleQuestion을 export한다. ZIP/XML 오류는 기존 AppError의 unsafe_file(422), 파일 크기 초과는 file_too_large(413)로 반환하며 원본 셀 값이나 파일 이름을 오류에 넣지 않는다.

buildQuestions(groups, first)의 first는 기본 질문 두 개, groups=null은 분석 한도 질문 하나, []는 변경 없음이다. 변경 10개까지 개별 질문, 11개 이상은 첫9개와 나머지를 묶은1개다. 첫 버전이 분석 한도에 걸린 경우 어떤 안내를 우선하는지는 API에서 한도 상태를 화면에 별도로 표시한다.

비교 결과의 before/after 수식과 필터 조건에는 업무 정보가 포함될 수 있다. AI 담당은 엔진 객체 전체를 전송하지 않고 계획의 허용 필드만 새로 구성해야 한다. 머리글·시트 이름·수식 자체에도 개인정보가 들어갈 수 있으므로 '셀 값 미전송'을 개인정보 부재 보장으로 표현하지 않는다.

## 완료 경계

엔진 단위 테스트·합성 파일과 로컬 DB migration 검증은 제품 전체 업로드 흐름의 완료가 아니다. 실제 API·화면·AI 전송 검증, 운영 용량 실측·백업 정책 승인·운영 배포는 담당 통합 후 별도 확인한다. 구체 실행 결과는 xlsx-engine.md와 xlsx-schema-review.md에 기록한다.
