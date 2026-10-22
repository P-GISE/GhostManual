# API 명세

현재 기준(2026-10-17 KST): AI 비활성 공개 데모 완료. [프로젝트 가이드](../PROJECT_GUIDE.md)의 인계/QA 근거와 [99 남은 범위](99_해야할일.md)를 따른다. 아래 날짜별 설계·구현 기록을 최신 검증 결과로 대체해 읽지 않는다.
변경일: 2026-10-05
아래 경로는 현재 route와 서비스 구현을 기준으로 갱신했다. 통합·브라우저 검증은 진행 기록에 기록하며 실제 AI 실행은 별도다.
기준: [상세 설계](superpowers/specs/2026-10-03-ghostmanual-mvp-design.md).
공통 성공 응답은 JSON, 오류는 {error:{code,message,retryable}}다. HTTP 200의 insufficient는 정상적인 근거 부족이며 장애와 다르다.

## 2026-10-22 파일 버전 제안 계약 (미구현)
[파일 버전 설계 10절](superpowers/specs/2026-10-22-file-version-questions-design.md)의 제안이다. 아래 현재 계약에는 아직 없다.
| Method / Endpoint | 인증·입력 | 응답 |
|---|---|---|
| POST /api/sources | O, multipart에 `.xlsx` 허용 | 201 버전1·기본 질문 |
| POST /api/sources/:id/revisions | O, multipart `.xlsx`·expectedRevision | 201 새 revision·변경 묶음·질문, 불일치 409 |
| GET /api/sources/:id/revisions | O 또는 해당 R | 200 버전 목록 |
| GET /api/sources/:id/revisions/:revision | O 또는 해당 R | 200 변경 묶음·질문·답변·미리보기 |
| GET /api/sources/:id/revisions/:revision/file | O 또는 해당 R | 200 원본 파일, attachment |
| PATCH /api/sources/:id/revisions/:revision/answers | O, 질문별 답변·건너뜀 | 200 저장 결과 |
기존 PATCH /api/sources/:id는 텍스트 자료에만 허용한다.

## 현재 HTTP 계약
O=소유자 쿠키, R=공유 독자 쿠키. 모든 ID는 서버의 workspace 범위에서 검증한다.
| Method / Endpoint | 인증·입력 | 응답 | 사용 화면·제안 파일 |
|---|---|---|---|
| POST /api/workspaces | 무인증, {mode:blank 또는 example} | 201 workspace 만료 시각, 소유자 쿠키 | 시작 / src/app/api/workspaces/route.ts |
| DELETE /api/workspace | O, 본문 없음 | 200 {deleted:true}, workspace 데이터 전체 삭제·쿠키 해제 | 내 데이터 삭제 / src/app/api/workspace/route.ts |
| GET /api/session | O 또는 R header | 200 role·expiresAt·manualId | 권한 확인 / src/app/api/session/route.ts |
| GET /api/sources | O | 200 Source 목록 | 문서함 / src/app/api/sources/route.ts |
| POST /api/manuals | O, sourceRevisionId·draft·expectedDraftRevision? | 201 저장된 초안 | 직접 작성 / src/app/api/manuals/route.ts |
| GET /api/shares | O, manualId query | 200 활성 공유 id·만료 목록, 원래 token 재노출 없음 | 공유 취소 / src/app/api/shares/route.ts |
| GET /api/manuals | O | 200 매뉴얼 요약·상태 목록 | 목록 / src/app/api/manuals/route.ts |
| POST /api/sources | O, multipart title와 text 또는 file 중 하나 | 201 Source id·revision | 자료 등록 / src/app/api/sources/route.ts |
| GET /api/sources/:id | O 또는 해당 R, 현재 허용된 revision | 200 제목·원문·문단·revision | 원문 / src/app/api/sources/[id]/route.ts |
| PATCH /api/sources/:id | O, {title,text,expectedRevision} | 200 새 revision·재검토 상태 | 원문 수정 / 같은 파일 |
| DELETE /api/sources/:id | O | 200 {deleted:true}, 관련 매뉴얼·공유·답변 포함 삭제 | 원문 삭제 / 같은 파일 |
| POST /api/sources/:id/generate | O, {expectedRevision}, Idempotency-Key | 201 초안 Manual 또는 처리 중이면 202 operationId | 생성 / src/app/api/sources/[id]/generate/route.ts |
| GET /api/manuals/:id | O 또는 해당 R | 200 Owner는 draft와 게시 버전, Reader는 현재 검수본만 | 상세 / src/app/api/manuals/[id]/route.ts |
| PATCH /api/manuals/:id | O, {sourceRevisionId,draft,expectedDraftRevision} | 200 새 draft revision | 편집 / 같은 파일 |
| POST /api/manuals/:id/publish | O, {expectedDraftRevision,acknowledgedUnknowns} | 201 검수 버전 ID | 검수 / src/app/api/manuals/[id]/publish/route.ts |
| POST /api/shares | O, {manualId}, 검수본·최신 원본 필요 | 201 shareId·1회 표시 공유 URL·만료 | 공유 / src/app/api/shares/route.ts |
| DELETE /api/shares/:id | O | 200 {deleted:true}, 공유 취소·독자 세션 접근 차단 | 공유 취소 / src/app/api/shares/[id]/route.ts |
| POST /api/share | 무인증, {token} | 200 manualId·expiresAt·독자 쿠키 | 공유 진입 / src/app/api/share/route.ts |
| POST /api/questions | O 또는 R, {question,manualId?}, Idempotency-Key | 200 QuestionResult 또는 202 operationId | 질문 / src/app/api/questions/route.ts |
| GET /api/questions/:id | O 또는 생성한 R | 200 답변·근거·오래됨 표시 | 결과 / src/app/api/questions/[id]/route.ts |
| GET /api/evidence/:id | O 또는 해당 답변의 R | 200 근거 원문·위치·당시 버전 | 출처 패널 / src/app/api/evidence/[id]/route.ts |

신규 생성 요청은 한정된 시간 안에서 동기 처리한다. 동일 Idempotency-Key 재전송 시 저장된 결과를 재사용하고 processing이면 202를 반환한다. durable background worker가 있다는 의미가 아니다. 처리 중은 202로 알리고 문서함 확인·동일 키 재전송으로 결과를 재사용한다. 별도 operation GET은 아직 제공하지 않는다.
같은 키에 다른 본문은 409, 원본·draft revision 충돌도 409다. 최초 정상 생성 201, 질문 정상/부족/검색 fallback 결과는 200이다. 입력만으로 실패한 요청은 4xx다.
AI timeout은 QuestionResult.status=unavailable과 검색 결과를 반환한다. DB 자체가 실패하여 결과 저장도 못 하면 503을 반환한다.

## QuestionResult 현재 구현
id, status(supported/partial/insufficient/unavailable), answer, procedure[], evidence[], confidence(supported/partial/insufficient 또는 장애 시 null), insufficientEvidence, limitations[], searchResults[], isOutdated.
현재 answer는 주장 텍스트를 합친 문자열이다. 절차는 evidenceIds를 보존하며 전체 evidence를 함께 제공한다. 주장별 연결은 향후 명세 보완 항목이다. procedure는 text·evidenceIds의 순서 목록이다.
evidence에는 id, sourceKind, sourceId, revisionId, title, section, excerpt, 내부 열람 URL이 있다. AI가 URL을 만들지 않는다.
unavailable에서는 answer·procedure·evidence를 비우고 searchResults를 보여준다. insufficientEvidence는 검색·평가 결과일 때만 true/false, 모델 장애로 판단 불가이면 null이다.
이력 조회는 공유 독자가 다른 독자의 질문을 볼 수 없도록 session_id를 검사한다.

## 공통 오류
422 형식·입력 오류, 401 세션 없음/만료, 403 허용되지 않은 변경·Origin, 404 권한 밖 ID·취소된 공유, 409 revision/키 충돌, 413 크기 초과, 415 파일 형식 미지원, 429 할당량·속도 제한, 503 DB·시스템 불가.
Provider 오류 본문·키·stack trace를 클라이언트에 그대로 보내지 않는다. 요청 본문과 토큰은 로그에서 제외한다.
응답 cache-control:no-store, 공유 진입 referrer-policy:no-referrer. 실제 적용은 테스트로 검증해야 한다.

