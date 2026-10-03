# GhostManual MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공개 URL에서 업무 자료 입력·AI 초안·사람 검수·후임자 질문·근거 확인까지 실제로 시연한다.

**Architecture:** Next.js 단일 앱, PostgreSQL 전용 DB, OpenAI 단일 제공자. Owner 세션과 공유 Reader 권한을 DB 단계에서 제한하고 원문·검수 매뉴얼·답변의 버전을 보존한다. AWS 기존 서비스와 분리하고 Cloudflare 공개 접속·Tailscale 운영 접속을 사용한다.

**Tech Stack:** TypeScript, Next.js App Router, React, CSS Modules, PostgreSQL/pg/pg_trgm, Zod, OpenAI SDK, ky, Vitest, Playwright, Biome, Docker Compose. Node 24와 npm을 사용한다. 사용자 승인 설계의 프레임워크·DB·런타임을 우선하며 skill 기본값 때문에 Hono/Bun/Drizzle로 바꾸지 않는다.

**Spec:** [2026-10-03 GhostManual MVP 설계](../specs/2026-10-03-ghostmanual-mvp-design.md)

**Execution:** 현재 세션 직접 구현을 권장한다. 기능들이 같은 버전·권한 인터페이스에 의존하므로 병렬 구현하지 않는다. 작업별 RED/GREEN을 기록하고 마지막에 독립 코드 리뷰를 수행한다. 구현 착수 전 이 계획의 사용자 검토와 실행 방식 확인이 필요하다.

## Global Constraints
- 한국어 UI, 데스크톱·모바일 브라우저, 공개 주소 ghostmanual.pigs0516.com.
- 제목 1~120자, 본문 100~20,000자, 파일 최대 256 KiB, UTF-8 TXT/Markdown. 원본 바이너리 저장 없음.
- 질문 1,000자, 후보 최대 20개, 검색 근거 상위 6개, 문맥 12,000자.
- 생성 timeout 45초·출력 4,000토큰, 질문 timeout 30초·출력 1,500토큰, SDK 자동 재시도 0회.
- 원본 변경 시 needsReview=true, 신규 답변에서 제외. 생성·답변 저장 직전 revision·권한·만료 재검증.
- workspace 7일, 공유 최대 7일 및 workspace 만료 중 빠른 시점, 만료 즉시 접근 차단·하루 1회 삭제.
- 작업 공간별 하루 생성 5회·질문 20회, 서비스 전체 AI 시도 하루 100회, 동시 AI 최대 2개. 실패 시도도 집계.
- AI_ENABLED 기본 false. 실제 키·계정·예산 준비 전 실 AI 완료 주장 금지.
- 토큰 해시 저장, HttpOnly/Secure/SameSite 쿠키, Origin 검사, no-store, no-referrer.
- 공유 URL /share#token, 토큰은 POST 본문으로 교환. Reader는 공유된 게시본과 해당 근거만 조회.
- quote·evidence ID의 실제 존재와 권한을 검증해도 의미적 정답을 보장하지 않음.
- strict TypeScript, no any/타입 단언/비어 있는 catch, Zod at boundaries. 제품 파일은 책임별로 나눔.
- 기존 서비스 유지, DB 공개 포트 없음, 제안 앱 바인딩 127.0.0.1:3200. 3100은 EventOps 사용 중으로 확인.
- 의존성은 실제 필요한 역할만 설치. patch 버전과 image digest는 구현 때 확인하여 lock/배포 기록에 고정.

## Review Focus
1. 동일 Idempotency-Key의 다른 payload와 네트워크 재전송: 다른 요청으로 오인하거나 비용을 이중 청구하지 않는다. Task 4.
2. 생성/질문 도중 원본 수정·workspace 만료·공유 취소: 오래된 결과 저장과 유출을 막는다. Task 3·5·6.
3. 한국어 띄어쓰기·동의어·문서에 있지만 질문 주제와 무관한 근거: 적절한 문단을 찾고 필요한 정보가 없으면 보류한다. Task 5.
4. 공개 세션 재발급·삭제·프로세스 재시작·동시 요청: 전역 예산이 초기화되거나 제한을 넘지 않는다. Task 4.
5. 파일 안 HTML·명령·잘못된 UTF-8와 AI의 없는 인용: 실행하지 않고 경계에서 거부하거나 안전하게 표시한다. Task 1·4·7.

## 파일 책임
- `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `playwright.config.ts`: 실행·검사 설정.
- `src/lib/schemas.ts`, `types.ts`, `errors.ts`: 경계 schema, 공통 typed 계약, 오류.
- `src/lib/db.ts`, `db/migrations/001_initial.sql`, `scripts/migrate.ts`: 연결·migration·트랜잭션.
- `src/lib/session.ts`, `sources.ts`, `manuals.ts`, `shares.ts`: 소유권·자료·검수·독자.
- `src/lib/ai.ts`, `ai-schemas.ts`, `limits.ts`, `operations.ts`: 제공자 호출·출력·할당량·중복 요청.
- `src/lib/retrieval.ts`, `answers.ts`, `evidence.ts`: 권한 내 후보 검색·답변·버전 인용.
- `src/app/api/**/route.ts`: [API 명세](../../04_API_명세.md)의 HTTP 경계.
- `src/app/**/page.tsx`, `src/components/**`, CSS Modules: [화면 설계](../../06_프런트엔드_구조.md)의 사용자 동선.
- `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`, `tests/fixtures/**`: 실제 경계와 사용자 결과 검사.
- `scripts/cleanup.ts`, `seed.ts`, `evaluate.ts`, `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml`: 운영·시연·평가.
- `docs/구현_진행_기록.md`: 매 작업의 실제 검증·판단·변경 경로. 실행 skill의 임시 ledger는 별도 보존 후 Git 기록으로 남긴다.

## Task 1: 실행 환경과 typed 입력 경계
**Files:** package/config 파일, src/lib/{schemas,types,errors}.ts, tests/unit/input.test.ts, tests/unit/manual-contract.test.ts.
**Interfaces:** SourceInputSchema, ManualDraftSchema, QuestionInputSchema, AnswerModelSchema; WorkspaceId/SessionId/SourceId/ManualId/RevisionId branded UUID; AppError(code,httpStatus,retryable).
- [x] Step 1: npm 기반 설정·테스트 러너만 준비하고 아래 테스트를 먼저 작성한다.
```typescript
it("rejects a 20001-character source", () => {
  expect(SourceInputSchema.safeParse({title:"업무",text:"가".repeat(20001)}).success).toBe(false);
});
it("accepts the 100-character minimum", () => {
  expect(SourceInputSchema.safeParse({title:"업무",text:"가".repeat(100)}).success).toBe(true);
});
```
추가: 99자·120/121자 제목·1000/1001자 질문·256KiB 경계·UTF-8 오류·NUL·TXT/MD 외 파일을 구분한다. 파일 검증은 parseSourceUpload(input: File|text): Promise<SourceInput>.
- [x] Step 2: npm test -- tests/unit/input.test.ts 실행. Expected: 미구현 경계의 테스트 RED. 러너 오류는 수정하고 실제 행동 실패 확인.
- [x] Step 3: Zod schema·typed 에러·업로드 parser 구현. 배열·외부 입력은 unknown에서 parse한다.
- [x] Step 4: npm test 및 npm run typecheck. Expected: 전체 테스트·타입검사 종료 0.
- [x] Step 5: Git 초기화 후 feat/ghostmanual-mvp 브랜치에서 config+경계 변경을 커밋, ledger 기록. 기존 docs·.codegraph를 삭제하지 않는다.

## Task 2: 실제 PostgreSQL 저장·세션·자료
**Files:** db/migrations/001_initial.sql, src/lib/{db,session,sources}.ts, scripts/{migrate,seed}.ts, 관련 API routes, tests/integration/sources.test.ts.
**Consumes:** Task 1 typed schema와 ID.
**Produces:** createWorkspace(mode): Promise<OwnerSession>; requireSession(token): Promise<SessionContext>; createSource(ctx,input): Promise<SourceView>; updateSource(ctx,id,input,expectedRevision): Promise<SourceView>; getSource(ctx,id,revision?): Promise<SourceView>.
- [ ] Step 1: 별도 실제 PostgreSQL 테스트 DB에서 아래 기대값을 갖는 integration을 작성.
```typescript
expect((await getSource(owner, source.id)).revision).toBe(1);
await expect(getSource(otherOwner, source.id)).rejects.toMatchObject({httpStatus:404});
await expect(updateSource(owner,source.id,input,0)).rejects.toMatchObject({httpStatus:409});
```
동일 workspace 내부 불변 revision과 다른 workspace FK 결합 거부·재접속·만료 테스트를 추가한다.
- [ ] Step 2: npm run test:integration -- tests/integration/sources.test.ts. Expected: 저장·격리 미구현 RED.
- [ ] Step 3: [DB 제안](../../03_데이터베이스_설계.md)의 테이블·제약 구현. migration 버전 테이블 추가, 중복 실행 무해성 검사. 모든 query 매개변수화.
- [ ] Step 4: 세션 token hash, 쿠키 flags, Origin 검사, Source CRUD HTTP 구현. plaintext 토큰·본문 로그 금지.
- [ ] Step 5: npm test, npm run test:integration, npm run typecheck. Expected: 종료 0. A1/A5 증거 기록 후 커밋.

## Task 3: 초안 편집·검수·원본 변경 정합성
**Files:** src/lib/manuals.ts, 관련 Manual routes, tests/integration/manuals.test.ts, tests/unit/manual-contract.test.ts.
**Consumes:** SessionContext, SourceView, ManualDraftSchema.
**Produces:** saveDraft(ctx,sourceRevisionId,draft,expectedDraftRevision?): Promise<ManualView>; publishManual(ctx,id,expectedRevision,acknowledgedUnknowns): Promise<ManualVersionView>; getManual(ctx,id): Promise<ManualView>.
- [ ] Step 1: 필수 필드 없는 검수 거부, draft 검색 제외, 검수본 불변, 인간 추가 내용 provenance, 원본 변경 뒤 needsReview 테스트 작성.
```typescript
expect(published.version).toBe(1);
expect((await getManual(owner,id)).needsReview).toBe(true);
await expect(publishManual(owner,id,staleDraftRevision,[])).rejects.toMatchObject({httpStatus:409});
```
- [ ] Step 2: 해당 integration 실행. Expected: 버전·검수 미구현 RED.
- [ ] Step 3: draft revision 및 원문 revision 검사, 검수 트랜잭션·posted pointer·원본 변경 시 검색 제외 구현.
- [ ] Step 4: 생성 중 Source 변경 가정에서 결과 저장 거부 테스트 및 구현.
- [ ] Step 5: unit+integration+typecheck 종료 0, A3/A7 증거와 커밋.

## Task 4: AI 생성·출력 검증·비용 경계
**Files:** src/lib/{ai,ai-schemas,limits,operations}.ts, generate/operations routes, tests/unit/ai.test.ts, tests/integration/limits.test.ts.
**Consumes:** SourceView, ManualDraftSchema, saveDraft.
**Produces:** generateDraft(ctx,id,expectedRevision,key): Promise<OperationResult>; generateAnswer(candidates,question): Promise<ValidatedModelResult>; reserveAiAttempt(ctx,kind,key,payloadHash): Promise<OperationLease>.
- [ ] Step 1: 테스트 HTTP 서버로 provider 성공·refusal·불완전 출력·invalid JSON·없는 quote·45초/30초 timeout 정책을 검증. 시간 제어를 주입하여 실제 45초 sleep하지 않는다.
- [ ] Step 2: AI_ENABLED=false일 때 외부 요청 0회, 자동 재시도 0회, store:false·모델·schema 파라미터를 machine 구조로 검증. 프롬프트 문구 자체를 고정하는 테스트는 쓰지 않는다.
- [ ] Step 3: limits integration RED: 같은 키 1회 예약, 다른 payload 409, 동시에 3개 예약 시 최대 2개, 전체 100회·공간 생성5회/질문20회, 실패·삭제·재시작 후 누적 유지.
```typescript
expect(await dailyAttemptCount()).toBe(100);
await expect(reserveAiAttempt(owner,"question",newKey,hash)).rejects.toMatchObject({httpStatus:429});
```
- [ ] Step 4: OpenAI SDK maxRetries:0·timeout·strict schema·Zod·인용 검사, DB 원자 할당·lease·idempotency 구현.
- [ ] Step 5: timeout·key 없음 시 원문 유지 및 작업 실패, 처리 중 중복 요청 202 API 구현.
- [ ] Step 6: 전체 테스트·타입검사 종료 0 후 커밋. 실 키가 없어 fixture만 실행했으면 그렇게 ledger 기록. A2 실 API 부분은 미검증으로 남긴다.

## Task 5: 검색·질문·인용·지식 부족
**Files:** src/lib/{retrieval,answers,evidence}.ts, question/evidence routes, tests/unit/retrieval.test.ts, tests/integration/questions.test.ts, tests/fixtures/evaluation.json.
**Consumes:** SessionContext, 검수 ManualVersion, generateAnswer.
**Produces:** retrieve(ctx,question,manualId?): Promise<readonly EvidenceCandidate[]>; ask(ctx,input,key): Promise<QuestionResult>; getEvidence(ctx,id): Promise<EvidenceView>.
- [ ] Step 1: published/needsReview/권한 필터 및 한국어 정답 12개 recall@6 테스트. Expected: 11개 이상 기대 섹션 포함. 근거 없음 6개·주입 4개 별도 사례.
- [ ] Step 2: insufficient 때 provider 호출 없이 evidence=[], confidence=insufficient. unavailable 때 confidence=null·insufficientEvidence=null 및 searchResults 표시 테스트 RED.
- [ ] Step 3: 부분 근거·없는 인용·다른 workspace ID·상충 자료·도중 version 변경·과거 답변 isOutdated 테스트.
- [ ] Step 4: NFKC·동의어·SQL 키워드/pg_trgm·최대20후보/6문맥/12000자 구현. AI가 만든 link를 사용하지 않고 서버 candidate ID만 허용.
- [ ] Step 5: 질문 결과 저장 전 게시 버전 재검증·evidence 스냅샷 저장·조회 권한 구현.
- [ ] Step 6: unit/integration 종료 0, fixture 품질 결과 기록·커밋. 실제 모델 의미 평가는 API 준비 후 별도 실행.

## Task 6: 공유 독자·삭제·보관
**Files:** src/lib/shares.ts, share/session/delete routes, scripts/cleanup.ts, tests/integration/sharing.test.ts, tests/integration/retention.test.ts.
**Consumes:** SessionContext, ManualVersion, QuestionResult.
**Produces:** createShare(owner,manualId): Promise<ShareView>; exchangeShare(token): Promise<ReaderSession>; revokeShare(owner,id): Promise<void>; deleteWorkspace(owner): Promise<void>; cleanupExpired(now): Promise<CleanupResult>.
- [ ] Step 1: reader는 공유 Manual만 조회, 수정403, 다른 question ID404, 원문 근거 허용 범위 검사 RED.
- [ ] Step 2: 토큰 hash 저장·7일 만료·취소 후 기존 reader 쿠키 거부·AI 요청 중 취소 저장 거부 테스트.
- [ ] Step 3: workspace/source 삭제로 공유·관련 답변 전체 제거, 만료 즉시403/401, cleanup 중복 실행 무해성 테스트.
- [ ] Step 4: token fragment 교환·허용 범위·삭제 트랜잭션·cleanup 구현. 일반 로그에 요청 본문·토큰 넣지 않음.
- [ ] Step 5: 전체 integration+typecheck 종료 0, A4/A5/A9 증거 및 커밋.

## Task 7: 실제 제품 UI와 브라우저 흐름
**Files:** src/app 화면·layouts/CSS, src/components/*, src/lib/client.ts, tests/e2e/{manual-flow,sharing,error-states}.spec.ts, playwright.config.ts.
**Consumes:** Task 2~6 HTTP 계약.
**Produces:** 한국어 자료·편집·질문·근거·공유·삭제·약관 화면.
- [ ] Step 1: 브라우저 E2E를 먼저 작성하고 실행: 입력 → 초안 → 수정 → 검수 → 별도 browser context Reader 질문 → evidence 표시. Expected: 미구현 UI RED.
- [ ] Step 2: 테스트 환경에서만 HTTP provider fixture 사용. UI에 fixture 모드 표시, production에서는 해당 경로 활성화 금지.
- [ ] Step 3: 390px/1440px에서 가로 overflow 없음, keyboard focus·label·필드 오류·409 입력 유지·429 제한·503 저장 실패 테스트.
- [ ] Step 4: UI 구현. 첫 화면 제품 중심, text buttons·중성 배경·상태 라벨. ky timeout/retry 정책으로 API 통신.
- [ ] Step 5: AI response·파일 HTML을 문자로 표시, fragment 교환 후 URL 토큰 제거, 다른 context에서 공유 취소 적용 확인.
- [ ] Step 6: 전체 E2E·unit·integration·lint·typecheck·build 종료 0. 실제 브라우저에서 수동으로 동일 흐름과 콘솔·네트워크 오류 검사.
- [ ] Step 7: 19개 UI ledger·스크린샷·A1~A11 증거 기록 후 커밋. 운영자 연락처 미확정 문구는 공개 전 해결 조건으로 남김.

## Task 8: CI·검토·배포 가능한 결과
**Files:** Dockerfile, compose.yaml, .env.example, .github/workflows/ci.yml, scripts/evaluate.ts, deploy/README.md, 모든 구현 상태 문서.
**Consumes:** 검증된 Task 1~7 앱과 DB, 서버 조사.
**Produces:** 고정된 빌드·배포/롤백 절차·공개 시연 결과.
- [ ] Step 1: CI에서 dependency install·lint·typecheck·unit·실제 DB integration·build·E2E 실행.
- [ ] Step 2: 로컬 또는 격리 환경에서 앱/DB 이미지 부하 테스트. 기존 AWS 가용 메모리 약805MB에 맞는 runtime 한도를 실제 측정하며, 빌드는 로컬/CI에서 수행.
- [ ] Step 3: 독립 최종 코드 reviewer에게 plan/spec/Review Focus/ledger/검증 결과를 전달. Important/Critical 발견은 regression RED→GREEN으로 수정 후 전체 suite.
- [ ] Step 4: private P-GISE/ghostmanual 저장소, 검증 commit 및 image 식별자 기록. 기존 repo/branch에 직접 덮어쓰지 않는다.
- [ ] Step 5: 서버 전용 디렉터리·DB·볼륨 및 3200포트 준비, migration·health·정리 timer 확인. 새 비용 리소스는 별도 결정 없이 만들지 않음.
- [ ] Step 6: 실 AI 계정·키·금액 예산, 운영자 안내·정책 준비 후 AI 활성화. 정답12·근거없음6·주입4 live 평가·생성 검수 시연.
- [ ] Step 7: Cloudflare GhostManual hostname 연결 후 외부 HTTPS 전체 흐름·기존 URL 사전/사후 확인. 전용 호스트 공개 권한 변경은 실행 시 적용되는 승인 규칙 확인.
- [ ] Step 8: 원본 변경·AI 실패·빈 자료·근거 없음·독자 권한·삭제 테스트와 롤백 검증. 실제 결과를 10·99·08에 기록.
- [ ] Step 9: 실 키나 공개 전 정보가 없으면 완료라고 하지 않고 검증된 범위·남은 조건·사용자 다음 행동을 보고.

## 인수 조건 연결
A1→1/2/7, A2→4/7/8, A3→3/7, A4→6/7, A5→2/5/6, A6→5, A7→3/5/6, A8→4/5/7, A9→6/8, A10→전체, A11→7, A12→8, A13→5/8.
문서 업데이트는 매 단계 같이 수행한다. 코드가 생겼다는 이유만으로 '구현 완료'를 기록하지 않는다.

## 현재 실행 조건
2026-10-03 서버 읽기 전용 조사: Linux, Docker 29.5.3, 메모리1906MB/가용805MB, 디스크29GB/남음13GB, 기존 app 포트3000·3100 사용. 추가 자원 적합성은 부하 검사 전 미확인.
로컬 Docker CLI 존재, 엔진 미실행으로 실제 DB test 실행 전 엔진 시작·확인이 필요하다. 서버의 기존 DB를 개발 테스트용으로 쓰지 않는다.
Tailscale SSH 추가 인증을 기존 계정으로 갱신하여 read-only 접근 성공. 인증 토큰·개인 연락처는 문서에 기록하지 않는다.
AI API 계정·키 없음. 계정 준비와 금액 예산은 실 AI/공개 시연의 선행 조건이다.

## 자체 검토
2026-10-03 spec A1~A13 연결, tasks간 schema/SessionContext/ManualVersion/QuestionResult 계약 확인, 5개 Review Focus 테스트 위치 확인.
3200포트로 실제 충돌 회피, AI 없는 fixture와 live 검증 구분, 승인·권한·만료 검사 및 실패 시 동작을 계획에 포함했다.
코드·schema·API·테스트는 아직 생성하지 않았다. 본 문서는 실행 결과가 아닌 구현 계획이다.

