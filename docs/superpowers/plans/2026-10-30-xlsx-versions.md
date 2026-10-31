# 엑셀 버전 기록·AI 변경 질문 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.xlsx` 자료를 버전으로 쌓고, 직전 버전과 규칙으로 비교한 변경을 AI가 질문·요약으로 바꿔 답변을 매뉴얼 "확인 필요"와 게시본 변경 이력에 남긴다.

**Architecture:** 엑셀 해석·비교·규칙 질문은 DB·HTTP를 모르는 순수 엔진 `src/lib/xlsx/`(박기성)가 맡고, 이 계획의 나머지(박효민)는 엔진 계약(Task 0)에만 기대어 저장·API·AI·화면을 만든다. AI는 기존 `src/lib/ai.ts`의 OpenAI Responses 경로를 재사용하고, 실패하면 규칙 질문으로 저장한다. 파일 원본·스냅샷은 PostgreSQL에 둔다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL 18(pg), Zod 4, ky 2, OpenAI SDK 7(Responses API), Vitest, Playwright, Biome. 엔진: `fflate`, `fast-xml-parser`.

**Spec:** `docs/superpowers/specs/2026-10-30-xlsx-version-detail.md` (상위: `docs/superpowers/specs/2026-10-22-file-version-questions-design.md`)

## Global Constraints

- 형식은 `.xlsx`만. 파일당 5 MiB(5242880 B), 계정 workspace당 원본 합계 100 MiB(104857600 B), 넘으면 `storage_quota` 429, 자동 삭제 없음.
- AI 입력은 시트 이름·행·열 수·1행 머리글(시트당 30열, 각 40자)·변경 묶음(종류·시트·범위·칸 수·수식 전후 각 200자)만. **셀 값(2행 이하)·파일 이름·사용자 이름·이메일·소속은 넣지 않는다.**
- AI 출력은 질문 ≤10개(각 1~300자) + 요약(1~500자). AI 꺼짐·실패·20초 초과·형식 오류면 규칙 질문으로 저장하고 업로드는 성공한다.
- 업로드 1회 = AI 호출 1회. 하루 한도: 전역 `AI_DAILY_LIMIT`(기본 100), workspace당 `change` 30.
- 버전에 업로드 당시 `uploaded_by_name`·`uploaded_by_department`를 복사해 고정. 소속은 선택(1~40자).
- 원본 응답: `Content-Disposition: attachment; filename*=UTF-8''…`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- 오류 메시지·로그에 셀 값·파일 내용·파일 이름을 넣지 않는다.
- 화면 문구는 기존 사이트처럼 "~합니다"체. 오류 코드·문구는 스펙 4.9절 표를 그대로 쓴다.
- 운영 DB에는 적용하지 않는다(박기성 담당). migration은 로컬·테스트 DB에만.
- 커밋 작성자 박효민, Co-Authored-By·생성 도구 문구 금지. `next.config.ts`·`.env`는 커밋하지 않는다.

## Review Focus

1. **Excel이 아닌데 `.xlsx`인 파일, 암호·매크로 파일** — 저장 전에 `unsafe_file` 422, 원본·버전이 남지 않아야 한다 → Task 3 테스트.
2. **AI가 입력에 없는 묶음 번호를 가리키거나 11개 이상 질문** — 규칙 질문으로 대체 → Task 5 테스트.
3. **동시에 두 창에서 새 버전 업로드(AI 대기 중 다른 업로드 완료)** — 늦은 쪽 409, 고아 행 없음 → Task 4 테스트.
4. **답변 후 다시 건너뛰기·답변 수정** — 초안 `unknowns`가 질문 상태와 항상 일치(중복·누락 없음) → Task 6 테스트.
5. **Reader가 게시 버전이 아닌 v1 파일 주소를 직접 요청** — 404 → Task 6 테스트.

---

## 파일 구조

| 파일 | 담당 | 책임 |
|---|---|---|
| `src/lib/xlsx/types.ts` | 공동(Task 0) | 엔진 계약 타입 |
| `src/lib/xlsx/index.ts` | 박기성(E1~E3), Task 0은 자리만 | `readXlsx`, `compareSnapshots`, `buildQuestions` |
| `db/migrations/005_file_versions.sql` | 박효민 | 스펙 3절 + `ai_summary`·`source`·`department` |
| `src/lib/file-sources.ts` | 박효민 | 파일 자료 등록·새 버전·목록·상세·내려받기·답변 |
| `src/lib/change-ai.ts` | 박효민 | AI 입력 만들기, AI 질문·요약, 대체 |
| `src/lib/accounts.ts` | 수정 | 소속·로그인 방식·사용량, `updateProfile` |
| `src/lib/manuals.ts` | 수정 | 게시 시 `history` 저장, 조회에 포함 |
| `src/app/api/sources/[id]/revisions/**` | 신규 | 4.2~4.6절 라우트 |
| `src/components/FileSourceDetail.tsx` | 신규 | 자료 상세(엑셀) 화면 |
| `src/components/FileUpload.tsx` | 신규 | 새 버전 올리기·결과 |
| `src/components/AccountPage.tsx`, `src/app/account/page.tsx` | 신규 | 계정 탭(내 프로필/설정) |
| `tests/fixtures/xlsx/` | 박기성(E4) | 합성 `.xlsx` |

---

### Task 0: 엔진 계약과 자리 — ✅ 완료(박기성 PR #25, `f6ee13f`)

**Files:**
- Create: `src/lib/xlsx/types.ts`, `src/lib/xlsx/index.ts`
- Test: `tests/unit/xlsx-contract.test.ts`

**Interfaces — Produces (이 계획 전체가 이 이름을 쓴다):**
```ts
export type Cell = { t: "s" | "n" | "b" | "e" | "z"; v: string | number | boolean | null; f?: string };
export type SheetSnapshot = { name: string; hidden: boolean; rows: number; cols: number;
  cells: Record<string, Cell>; autoFilter?: { ref: string; columns: { col: number; filter: string }[] } };
export type Snapshot = { v: 1; sheets: SheetSnapshot[]; names: { name: string; ref: string }[] };
export type ReadResult = { status: "compared"; snapshot: Snapshot } | { status: "limit_exceeded" };
export type ChangeKind = "sheet_added" | "sheet_removed" | "formula_added" | "formula_changed"
  | "formula_removed" | "filter_changed" | "names_changed" | "size_changed" | "values_changed";
export type ChangeGroup = { kind: ChangeKind; sheet: string | null; range: string | null; summary: Record<string, unknown> };
export type RuleQuestion = { kind: "purpose" | "origin" | "change" | "other"; groupIndexes: number[]; question: string };
export function readXlsx(bytes: Uint8Array): ReadResult;            // 위험 파일은 AppError("unsafe_file", 422)
export function compareSnapshots(before: Snapshot, after: Snapshot): ChangeGroup[]; // 우선순위 정렬, 결정적
export function buildQuestions(groups: ChangeGroup[] | null, first: boolean): RuleQuestion[];
```
`buildQuestions`: `first` → purpose·origin 2개(스펙 7.1 문구), `null`(한도 초과) → other 1개 "이번 버전에서 무엇을, 왜 바꿨나요?", `[]` → `[]`, 그 외 최대 10개(9개 + other "나머지 변경 {N}건은 어떤 작업이었나요?").

- [ ] **Step 1:** `tests/unit/xlsx-contract.test.ts`에 `buildQuestions([], true)`가 `[{kind:"purpose",question:"이 파일은 어떤 업무를 위한 것인가요?",groupIndexes:[]},{kind:"origin",question:"자료는 어디서 가져왔나요?",groupIndexes:[]}]`, `buildQuestions(null,false)`가 other 1개, `buildQuestions([],false)`가 `[]`임을 단언.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/xlsx-contract.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3:** `types.ts` 작성. `index.ts`에 `buildQuestions`의 위 세 분기만 구현, `readXlsx`·`compareSnapshots`는 `throw new AppError("not_implemented", 501, "엑셀 비교 엔진 준비 중입니다.")`(shortcut 주석: 엔진 PR에서 교체).
- [ ] **Step 4:** 같은 명령 PASS, `npm run lint`·`npx tsc --noEmit` 통과.
- [ ] **Step 5:** `git commit -m "feat: 엑셀 엔진 계약 타입과 자리 추가"` → 박기성에게 계약 확인 요청.

### 박기성 엔진 작업 — ✅ E1~E4 완료(PR #25, 10/31)

- **E1 `readXlsx`**: 스펙 6.2~6.4. 거부(`unsafe_file`): ZIP 서명 아님, `[Content_Types].xml` 없음, `xl/vbaProject.bin`, OLE 암호(`D0 CF 11 E0`), `..`·절대 경로, `<!DOCTYPE`. 한도(→ `limit_exceeded`): 해제 합계 20 MiB, 시트 20, 비어 있지 않은 셀 50,000, XML 파트 10 MiB. 공유 수식 펼치기.
- **E2 `compareSnapshots`**: 스펙 7절 1~5, 30% 관찰 메모 `note:"rows_may_be_reordered"`. 같은 입력 → 같은 출력.
- **E3 `buildQuestions`**: 스펙 8.4 틀 + 7절 6·7(시트 이름 40자, 수식 80자 자르기).
- **E4 픽스처**: `tests/fixtures/xlsx/정산_1029.xlsx`, `정산_1030.xlsx`(시트 추가·F2:F40 수식 SUM→SUMIF·값 132칸), `macro.xlsx`, `encrypted.xlsx`, `not-zip.xlsx`(텍스트), `huge.xlsx`(셀 50,001). 생성 스크립트도 함께.

---

### Task 1: migration 005 — ✅ 완료(박기성 PR #25, 운영 적용 10/31)

**Files:**
- Create: `db/migrations/005_file_versions.sql`
- Test: `tests/integration/file-schema.test.ts`

- [ ] **Step 1:** 테스트: `source_files` UPDATE 시 `Snapshots are immutable` 오류, `sources(kind='file', file_type=NULL)` INSERT가 체크 위반, `users.department`에 41자 거부, 기존 `sources` 행의 `kind`가 `'text'`.
- [ ] **Step 2:** `DATABASE_URL=…/ghostmanual_test npx vitest run --project integration tests/integration/file-schema.test.ts` → FAIL.
- [ ] **Step 3:** 스펙 3절 SQL 그대로 + 다음 추가: `source_files.ai_summary text CHECK(char_length(ai_summary) BETWEEN 1 AND 500)`, `revision_questions.source text NOT NULL DEFAULT 'rule' CHECK(source IN ('rule','ai'))`, `users.department`, `source_revisions.uploaded_by_department`. `revision_questions.change_group_ids uuid[]`는 쓰지 않고 `group_positions integer[] NOT NULL DEFAULT '{}'`(같은 버전 `change_groups.position` 참조)로 둔다 — 질문을 묶음 저장 전에 만들기 때문.
- [ ] **Step 4:** `npm run db:migrate`(로컬 개발 DB)와 테스트 DB에 적용, 테스트 PASS.
- [ ] **Step 5:** 스펙 3절을 `group_positions`·추가 열에 맞게 고치고 함께 커밋 `feat: 파일 버전 DB migration 005`.

### Task 2: 프로필 소속·로그인 방식·사용량

**Files:**
- Modify: `src/lib/accounts.ts` (`currentUser`, 신규 `updateProfile`), `src/app/api/me/route.ts`(PATCH 추가), `src/app/privacy/page.tsx`
- Test: `tests/integration/profile.test.ts`

**Interfaces — Produces:**
- `currentUser(ctx) → { name: string; email: string; department: string | null; loginMethods: ("password" | "google")[]; usage: { bytes: number; limitBytes: 104857600 }; newAccount: boolean }`
- `updateProfile(ctx, input: { name: string; department: string | null }) → 위와 같은 모양`
- `export const FILE_QUOTA_BYTES = 104857600` (in `src/lib/file-sources.ts`, Task 3에서 만들고 여기서는 상수만 먼저 둠)

- [ ] **Step 1:** 테스트: 소속 저장·`null`로 지우기, 41자 이름 거부(422), `loginMethods`가 비밀번호 가입이면 `["password"]`, 사용량 0.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 사용량은 `SELECT COALESCE(sum(size_bytes),0) FROM source_files WHERE workspace_id=$1`. 개인정보 안내에 "소속(선택)"과 "엑셀 원본 파일, AI(OpenAI)로 보내는 항목: 시트 이름·열 이름·수식·바뀐 위치(셀 값 제외)" 문단 추가.
- [ ] **Step 4:** PASS, 기존 `tests/integration/accounts.test.ts`·`terms.test.ts` PASS.
- [ ] **Step 5:** 커밋 `feat: 프로필 소속과 사용량 조회`.

### Task 3: 엑셀 자료 등록(버전 1)

**Files:**
- Create: `src/lib/file-sources.ts`
- Modify: `src/app/api/sources/route.ts`(multipart에서 `.xlsx` 분기, 본문 한도 5 MiB + 64 KiB), `src/lib/sources.ts`(`SourceViewSchema`에 `kind`·`fileType`·`uploadedByName`·`uploadedByDepartment`; 텍스트 생성·수정도 이름·소속 기록)
- Test: `tests/integration/file-sources.test.ts` (엔진은 `vi.mock("../../src/lib/xlsx/index.ts")`로 고정 결과)

**Interfaces — Produces:**
- `createFileSource(ctx, input: { title: string; fileName: string; bytes: Uint8Array }) → FileRevisionView`
- `type FileRevisionView = { id; kind: "file"; fileType: "xlsx"; title; revision; revisionId; createdAt; file: { name; sizeBytes }; uploadedByName: string | null; uploadedByDepartment: string | null; compareStatus: "first" | "compared" | "no_changes" | "limit_exceeded"; aiSummary: string | null; changes: ChangeView[]; questions: QuestionView[]; usage: { bytes; limitBytes } }`
- `type QuestionView = { id; kind; question; answer: string | null; skipped: boolean; source: "rule" | "ai"; groupPositions: number[] }`, `type ChangeView = { position; kind; sheet; range; summary }`

- [ ] **Step 1:** 테스트: 등록 → `revision 1`, `compareStatus "first"`, 질문 2개(`source "rule"`), `uploadedByDepartment`가 프로필 값, `sha256`이 원본과 일치; `readXlsx`가 `unsafe_file`을 던지면 `sources`·`source_files` 행 0개; 5 MiB+1 B → 413; 사용량 합이 100 MiB를 넘으면 429 `storage_quota`; 파일 이름은 오류 메시지에 없음; 기존 `deleteSource`로 자료를 지우면 `source_files`·`revision_questions` 행 0개(F8).
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 순서: 크기 검사 → `readXlsx`(트랜잭션 밖) → 트랜잭션(`assertSession(db, ctx, true)` 잠금 → 용량 검사 → `sources(kind='file', file_type='xlsx')`·`source_revisions`(text = 시트 이름·머리글 요약, 1~20000자)·`source_files`·`revision_questions`). 버전 1은 AI를 호출하지 않는다(기본 질문만).
- [ ] **Step 4:** PASS, `tests/integration/sources.test.ts`·`source-quota.test.ts` PASS.
- [ ] **Step 5:** 커밋 `feat: 엑셀 자료 등록과 기본 질문`.

### Task 4: 새 버전 올리기와 매뉴얼 연결

**Files:**
- Modify: `src/lib/file-sources.ts`
- Create: `src/app/api/sources/[id]/revisions/route.ts` (POST, 이 Task는 POST만)
- Test: `tests/integration/file-revisions.test.ts`

**Interfaces:**
- Consumes: Task 3 뷰 타입, Task 0 엔진, Task 5 `changeQuestions`(이 Task에서는 `vi.mock("../../src/lib/change-ai.ts")`로 `null` 반환 = 규칙 사용)
- Produces: `addFileRevision(ctx, id: string, input: { fileName: string; bytes: Uint8Array; expectedRevision: number }) → FileRevisionView`

- [ ] **Step 1:** 테스트: v2 업로드 → 묶음 저장(position 순), `compareStatus "compared"`, 규칙 질문; 변경 없음 → `no_changes`·질문 0; 한도 초과 → `limit_exceeded`·질문 1; 텍스트 자료에 업로드 → 422 `file_type_mismatch`; `expectedRevision` 불일치 → 409(행 증가 없음); 연결 매뉴얼이 있으면 `needs_review=true`, `source_revision_id`가 새 버전, 초안 `unknowns`에 `"[v2 확인 필요] " + 질문`(30개 초과분은 `"[v2 확인 필요] 답하지 않은 변경 질문 N건"` 하나), `draft_revision` +1.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 흐름: 읽기 트랜잭션(직전 스냅샷·revision) → `readXlsx` → `compareSnapshots` → `changeQuestions`(트랜잭션 밖, ≤20초) → 쓰기 트랜잭션에서 `revision` 재확인(409) 후 저장. 직전 버전이 `limit_exceeded`면 비교 없이 `limit_exceeded`처럼 처리. 매뉴얼 `source_revision_id` 갱신은 기존 `publishManual`의 "최신 원본" 검사를 통과시키기 위함.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat: 엑셀 새 버전 비교와 매뉴얼 재검토 연결`.

### Task 5: AI 변경 질문·버전 요약

**Files:**
- Create: `src/lib/change-ai.ts`
- Modify: `src/lib/ai.ts`(`generate`를 `export`), `src/lib/operations.ts`(신규 `reserveChangeAi`)
- Test: `tests/unit/change-ai.test.ts`, `tests/integration/change-ai.test.ts`(기존 `generation.test.ts`의 로컬 가짜 OpenAI 서버 방식)

**Interfaces — Produces:**
- `changePrompt(title: string, after: Snapshot, groups: ChangeGroup[]) → ChangePromptInput` (순수)
- `changeQuestions(ctx, input: ChangePromptInput, groupCount: number) → Promise<{ summary: string; questions: { groupPositions: number[]; question: string }[] } | null>` — `null`이면 호출자가 규칙 질문을 쓴다
- `reserveChangeAi(ctx) → Promise<boolean>` — 한도 안이면 카운트 올리고 `true`, 넘으면 `false`(오류 아님)

- [ ] **Step 1 (unit):** `changePrompt` 결과를 `JSON.stringify` 했을 때 테스트 스냅샷의 2행 셀 값(`"가나상사"`, `120`)·파일 이름이 **없고**, 1행 머리글·수식 `SUM(B2:E2)`·범위는 **있음**; 머리글 31번째 열 잘림, 수식 201자 → 200자.
- [ ] **Step 2 (integration):** 가짜 서버가 정상 JSON → 질문 `source "ai"`, `aiSummary` 저장; 가짜 서버가 `groupPositions:[99]` 또는 질문 11개 → `null`(규칙 사용); 응답 25초 지연 → `null`, 업로드 201; `AI_ENABLED` 아님 → 서버 호출 0회; 하루 한도 소진 → 호출 0회.
- [ ] **Step 3:** 실행 → FAIL.
- [ ] **Step 4:** 구현. `generate(schema, "change_questions", input, 20000, 1500, instructions + 지시문)`; 지시문은 "관찰한 변경만 근거로, 의도를 단정하지 말고 '~하려는 건가요?' 확인형으로, 엑셀 기능 이름을 써서 한국어로 짧게. 요약은 1~2문장". 출력 Zod: `{ summary: string 1..500, questions: array(max 10) of { groupPositions: int[] (각 0..groupCount-1, 1개 이상), question: string 1..300 } }`. 모든 `AppError`를 잡아 `null`(로그 없음). `reserveChangeAi`는 `reserveAiAttempt`의 `usage_counters` 두 범위(전역 `all`·workspace `change` 30)만 재사용.
- [ ] **Step 5:** PASS, `tests/unit/ai.test.ts`·`generation.test.ts`·`questions.test.ts` PASS. 커밋 `feat: AI 변경 질문과 버전 요약`.

### Task 6: 버전 목록·상세·내려받기·답변 API

**Files:**
- Modify: `src/lib/file-sources.ts`, `src/app/api/sources/[id]/revisions/route.ts`(GET)
- Create: `src/app/api/sources/[id]/revisions/[revision]/route.ts`, `…/[revision]/file/route.ts`, `…/[revision]/questions/[questionId]/route.ts`
- Test: `tests/integration/file-read.test.ts`

**Interfaces — Produces:**
- `listFileRevisions(ctx, id) → RevisionSummary[]` (스펙 4.3 필드 + `uploadedByDepartment`)
- `getFileRevision(ctx, id, revision) → FileRevisionView & { preview: { sheet; hidden; rows; cols; cells: (string|number|boolean|null)[][] }[] }` (시트당 20행 × 12열)
- `fileContent(ctx, id, revision) → { fileName: string; bytes: Uint8Array }`
- `answerQuestion(ctx, id, revision, questionId, input: { answer: string } | { skipped: true }) → QuestionView`

- [ ] **Step 1:** 테스트: 목록 최신순; 미리보기 20×12 자름; 내려받기 바이트·헤더 3종(라우트 테스트); 답변하면 초안 `unknowns`에서 해당 항목 제거, 건너뛰면 다시 추가(중복 없음), 답변 2001자 422; **Reader**(공유 세션)는 게시 버전 목록·상세·파일만, v1 파일 요청 404, 답변 PUT 403/404.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. Reader 범위는 `sourceInTransaction`의 게시 버전 조건을 재사용. 답변·건너뛰기는 `revision_questions` 갱신 + 매뉴얼 초안 `unknowns` 동기화를 한 트랜잭션에서.
- [ ] **Step 4:** PASS. 커밋 `feat: 엑셀 버전 조회·내려받기·답변 API`.

### Task 7: 게시본 변경 이력과 기존 API 정리

**Files:**
- Modify: `src/lib/manuals.ts`(`publishManual`이 `history` 저장, `ManualVersionViewSchema`에 `history`), `src/app/api/sources/[id]/route.ts`(파일 자료 PATCH 422 `file_source_readonly`), `src/app/api/sources/[id]/generate/route.ts`(파일 자료 422)
- Test: `tests/integration/manual-history.test.ts`

- [ ] **Step 1:** 테스트: 게시 후 답변을 고쳐도 게시 버전 `history`는 게시 당시 값(F17); `history.revisions`가 v1·v2(이름·소속·묶음 요약·질문·답변); 텍스트 자료 게시본 `history`는 `null`; 파일 자료 PATCH·generate 422.
- [ ] **Step 2:** FAIL 확인 → 구현 → PASS, `manuals.test.ts`·`manual-versions.test.ts` PASS.
- [ ] **Step 3:** 커밋 `feat: 게시본에 파일 변경 이력 고정`.

### Task 8: 자료 상세(엑셀)·새 버전 화면

**Files:**
- Create: `src/components/FileSourceDetail.tsx`, `src/components/FileUpload.tsx`
- Modify: `src/components/SourceForm.tsx`(`accept`에 `.xlsx`, 안내 문구), `src/components/SourceDetail.tsx`(`kind==="file"`이면 `FileSourceDetail`), `src/app/globals.css`·`responsive.css`(기존 토큰만)
- Test: `tests/e2e/xlsx-versions.spec.ts`(엔진 mock 불가 → E4 픽스처 필요; 엔진 병합 전에는 `test.skip(!engineReady)`), `tests/accessibility/design.spec.ts`에 두 화면 추가(API는 `page.route`로 고정)

목업 ①②(https://claude.ai/artifact/A4YW7DG2pkzFCtusbHdCQC) 배치를 따른다: 왼쪽 버전 목록, 오른쪽 질문(답변·건너뛰기·"AI가 만든 질문" 배지·버전 요약) → 바뀐 부분 → 시트 미리보기(표, 가로 스크롤 상자). 업로드 화면에 AI 전송 안내 문구(스펙 7.1) 고정 표시.

- [ ] **Step 1:** 접근성 테스트: 두 화면 axe 위반 0, 키보드로 답변 저장·건너뛰기, 모바일 폭 가로 넘침 0.
- [ ] **Step 2:** FAIL → 구현 → PASS(`npm run build` 후 `npm run test:accessibility`).
- [ ] **Step 3:** 커밋 `feat: 엑셀 자료 상세와 새 버전 화면`.

### Task 9: 계정 화면과 후임자 변경 이력

**Files:**
- Create: `src/app/account/page.tsx`, `src/components/AccountPage.tsx`
- Modify: `src/components/Navigation.tsx`(이름 → `/account` 링크, 사용량 표시), `src/components/ManualList.tsx`(계정 삭제 버튼 제거), `src/components/ManualDetail.tsx`(Reader·Owner 모두 `history` 표시, 게시 버전 원본 내려받기 링크)
- Test: `tests/accessibility/design.spec.ts`(계정 두 탭, 후임자 이력), `tests/e2e/auth.spec.ts`(계정 삭제 경로 갱신)

목업 ③: `role="tablist"` 탭 "내 프로필"(이름·소속·이메일·로그인 방식) / "설정"(비밀번호 변경 = 기존 `POST /api/auth/password-reset`에 내 이메일, Google 전용이면 안내만; 저장 공간 막대 `role="progressbar"`; 계정 삭제). 목업 ④: 매뉴얼 아래 "파일 변경 이력".

- [ ] **Step 1:** 테스트: 소속 저장 후 새로고침해도 유지; 탭 키보드 이동; 기존 계정 삭제 E2E가 `/account › 설정`에서 동작.
- [ ] **Step 2:** FAIL → 구현 → PASS.
- [ ] **Step 3:** 커밋 `feat: 계정 화면 탭과 후임자 변경 이력`.

### Task 10: 엔진 연결·시연 시나리오·마무리 (11/3 엔진 병합 후)

**Files:**
- Modify: `tests/e2e/xlsx-versions.spec.ts`(skip 해제), `src/components/Landing.tsx`(엑셀 기능 "곧 제공" 배지 제거), `docs/99_해야할일.md`, `docs/구현_진행_기록.md`, `docs/08_운영_배포.md`(migration 005·`AI_ENABLED`·`OPENAI_MODEL` 안내, 값은 쓰지 않음)

- [ ] **Step 1:** E2E 시연 시나리오(스펙 9절): `정산_1029.xlsx` 등록 → 기본 질문 답변 → `정산_1030.xlsx` 새 버전 → 변경 3건·질문 확인, 하나 답변·하나 건너뜀 → 매뉴얼 검수에서 확인 필요 체크 후 게시 → 새 브라우저로 공유 링크 → 이력·내려받기. AI는 꺼진 상태(규칙 질문)로 단언.
- [ ] **Step 2:** 전체 실행: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build && npm run test:accessibility`, 세션·전송 구성. 모두 PASS.
- [ ] **Step 3:** 수동 확인(박효민): 로컬 `.env`에 `AI_ENABLED=true`·`OPENAI_API_KEY`·`OPENAI_MODEL`(GPT-6 Luna) → 같은 시나리오에서 "AI가 만든 질문"·요약 표시, 응답 시간 기록. 질문 품질이 부족하면 `OPENAI_MODEL`만 Sol로.
- [ ] **Step 4:** 커밋 `docs: 엑셀 버전 기능 기록과 배포 안내` → PR.

---

## 일정

| 날짜 | 박효민 | 박기성 |
|---|---|---|
| 10/30 | Task 0 | 계약 확인, E1 시작 |
| 10/31 | Task 1~3 | E1 |
| 11/1 | Task 4~5 | E2 |
| 11/2 | Task 6~7 | E3·E4 |
| 11/3 | Task 8 | 엔진 PR 병합 |
| 11/4 | Task 9~10 | 버그 수정 |
| 11/5 | 시연 영상 | — |
| 11/6 | 중간보고서 제출(23:59) | 〃 |
