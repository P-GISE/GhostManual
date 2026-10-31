# 엑셀 버전 기록·변경 질문 상세 설계 (DB·API)

작성일: 2026-10-30 (KST). 상태: **초안, 사용자·팀 검토 대기, 미구현**. 상위 설계는 [파일 버전 기록·변경 질문 설계](2026-10-22-file-version-questions-design.md)이고, 이 문서는 그 설계를 2026-10-30 결정(상위 설계 16절)과 로그인 도입 후 구조에 맞춰 DB·API·데이터 구조로 구체화한다. 운영 DB 적용은 박기성이 맡는다.

## 1. 범위 (중간평가 2026-11-06, 시연 영상·로컬 동작)

| 포함 | 제외 (고도화 계획) |
|---|---|
| `.xlsx` 자료 등록(버전 1)과 기본 질문 2개 | `.xlsx` 외 형식의 업로드·비교 (Word·한글·PPT·PDF·이미지) |
| 같은 자료에 새 버전 업로드, 직전 버전과 자동 비교 | 아무 두 버전 골라 비교 |
| 변경 묶음과 변경별 질문(최대 10개), 답변·건너뛰기 | AI가 셀 값까지 읽는 분석 |
| **AI 변경 질문 생성·버전 요약**(7.1절), 기존 AI 매뉴얼 초안·후임자 답변 켜기 | 아무 두 버전 AI 비교 |
| 버전 목록(번호·올린 사람·KST 시각·파일 이름·크기·비교 상태·답변 수) | 팀 정보, 팀 기능 |
| 원본 파일 내려받기, 시트 미리보기 | 브라우저에서 원본 열기 |
| 미답변 질문 → 매뉴얼 "확인 필요", 새 버전 → 재검토 필요 | 서식·차트·피벗·매크로·주석 비교 |
| 계정 저장 용량 한도(100 MiB)와 사용량 표시 | 저장소(S3·드라이브) 분리 |
| 프로필에서 이름 수정 | 카카오·네이버 로그인 |

기존 텍스트 자료(TXT·Markdown·직접 입력) 흐름은 그대로 둔다.

## 2. 핵심 결정

| 항목 | 결정 | 출처 |
|---|---|---|
| 올린 사람 | 업로드 순간의 **계정 이름과 소속(부서)**을 버전에 복사해 고정. 소속은 프로필의 선택 입력(1~40자), 비어 있으면 이름만. 팀 기능(초대·권한)은 없음 | 사용자 결정(10/30, 처음엔 이름만 → 같은 날 소속 추가) |
| 이름·소속 수정 | 계정 화면 "내 프로필"에서 수정. 이미 올린 버전의 이름·소속은 바뀌지 않음 | 사용자 결정(10/30) |
| 보관 | 계정(workspace)당 원본 파일 합계 **100 MiB**, 파일당 **5 MiB**. 자동 삭제 없음, 넘으면 업로드 거부 | 사용자 결정(10/30). 숫자는 박기성 확인 후 조정 |
| 형식 | `.xlsx`만 | 사용자 결정(10/30) |
| 시각 | 서버 저장 시각(`created_at`). 화면은 KST `2026-10-30 14:05` | 상위 설계 9.1 |
| 파일 저장 위치 | PostgreSQL `bytea` | 상위 설계 10절. 용량 한도로 DB 크기를 예측 가능하게 묶음 |
| 질문 상한 | 업로드당 10개, 넘치면 "기타 변경 N건" 1개 | 상위 설계 7.2 (구현자 기본값) |
| 라이브러리 | `fflate`(ZIP) + `fast-xml-parser`(XML)로 필요한 부분만 직접 읽음 | 6절 (구현자 판단) |
| AI 사용 | 중간보고서 심사에 AI 활용(25점)이 있어 사용. 비교는 규칙 코드, **질문과 버전 요약을 AI가 생성** | 사용자 결정(10/30), 7.1절 |
| AI로 보내는 범위 | **구조만**: 시트 이름·열 이름(머리글)·수식·바뀐 범위·칸 수. 셀 값은 보내지 않음 | 사용자 결정(10/30, 보안) |
| AI 제공자·모델 | OpenAI, 박효민 개인 결제 키(로컬 `.env`), `OPENAI_MODEL`=GPT-6 Luna로 시작, 품질이 부족하면 Sol로 설정만 변경 | 사용자 결정(10/30). 공모전 측 키 지원 없음 |

## 3. DB 스키마 — `db/migrations/005_file_versions.sql` (초안)

기존 규칙을 따른다: 모든 테이블에 `workspace_id`와 `(workspace_id,id)` 복합 FK, `ON DELETE CASCADE`로 자료·계정 삭제 시 함께 삭제, 버전 데이터는 수정 금지 트리거.

```sql
-- 자료 종류: 기존 자료는 모두 text
ALTER TABLE sources
  ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','file')),
  ADD COLUMN file_type text CHECK (file_type IN ('xlsx')),
  ADD CONSTRAINT sources_kind_file_type CHECK ((kind = 'file') = (file_type IS NOT NULL));

-- 파일 버전의 text는 검색용 요약이라 100자보다 짧을 수 있다. 텍스트 자료의 100자 하한은 앱(Zod)이 계속 검사한다.
ALTER TABLE source_revisions DROP CONSTRAINT source_revisions_text_check;
ALTER TABLE source_revisions ADD CONSTRAINT source_revisions_text_check
  CHECK (char_length(text) BETWEEN 1 AND 20000);

-- 프로필 소속(부서), 선택 입력
ALTER TABLE users ADD COLUMN department text
  CHECK (char_length(department) BETWEEN 1 AND 40);

-- 올린 사람 이름·소속(업로드 당시 값). 이 기능 이전 버전은 NULL → "기록 없음"
ALTER TABLE source_revisions
  ADD COLUMN uploaded_by_name text CHECK (char_length(uploaded_by_name) BETWEEN 1 AND 40),
  ADD COLUMN uploaded_by_department text CHECK (char_length(uploaded_by_department) BETWEEN 1 AND 40);

-- 원본 파일과 비교용 스냅샷 (버전당 1행, 수정 금지)
CREATE TABLE source_files(
  revision_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL,
  compare_status text NOT NULL CHECK (compare_status IN ('compared','limit_exceeded')),
  snapshot jsonb,
  ai_summary text CHECK (char_length(ai_summary) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, revision_id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE,
  CHECK ((compare_status = 'compared') = (snapshot IS NOT NULL))
);
CREATE INDEX source_files_workspace ON source_files(workspace_id);
CREATE TRIGGER immutable_source_file BEFORE UPDATE ON source_files
  FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_update();

-- 직전 버전과 비교한 변경 묶음 (수정 금지)
CREATE TABLE change_groups(
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('sheet_added','sheet_removed','formula_added','formula_changed',
    'formula_removed','filter_changed','names_changed','size_changed','values_changed')),
  sheet text,
  range text,
  summary jsonb NOT NULL,
  UNIQUE (revision_id, position),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER immutable_change_group BEFORE UPDATE ON change_groups
  FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_update();

-- 버전별 질문과 답변 (답변은 나중에 고칠 수 있음)
CREATE TABLE revision_questions(
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
  kind text NOT NULL CHECK (kind IN ('purpose','origin','change','other')),
  group_positions integer[] NOT NULL DEFAULT '{}',  -- 같은 버전 change_groups.position (질문을 묶음 저장 전에 만들기 때문)
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  answer text CHECK (char_length(answer) BETWEEN 1 AND 2000),
  skipped boolean NOT NULL DEFAULT false,
  answered_at timestamptz,
  UNIQUE (revision_id, position),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE,
  CHECK (NOT (skipped AND answer IS NOT NULL)),
  source text NOT NULL DEFAULT 'rule' CHECK (source IN ('rule','ai')),
  CHECK ((answer IS NOT NULL OR skipped) = (answered_at IS NOT NULL))
);

-- 게시 시점의 변경 이력(버전·질문·답변)을 매뉴얼 버전에 고정
ALTER TABLE manual_versions ADD COLUMN history jsonb;
```

- `kind='other'`는 "기타 변경 N건" 질문이며 `group_positions`에 묶음 순번 여러 개를 가진다. `kind='change'`는 묶음 하나를 가리킨다.
- `source_revisions`·`manual_versions`의 기존 수정 금지 트리거는 `ALTER TABLE ... ADD COLUMN`과 무관하다(행 UPDATE가 아님).
- 계정 삭제·자료 삭제는 기존 CASCADE로 새 테이블까지 지워진다. 계정 workspace는 만료되지 않는다.
- 용량 계산: `SELECT COALESCE(sum(size_bytes),0) FROM source_files WHERE workspace_id=$1`. 기존 텍스트 한도(자료 50개·버전 200개·텍스트 2 MiB)는 그대로 함께 적용한다.

### 3.1 운영 적용 메모 (박기성)

- 기존 데이터 변경: 모든 `sources` 행에 `kind='text'`가 채워지고 나머지는 열·테이블 추가뿐이다.
- `source_revisions_text_check`는 001에서 자동 생성된 제약 이름이다. 적용 전 `\d source_revisions`로 이름을 확인한다.
- 파일이 DB에 저장되므로 DB 크기가 사용자 수 × 최대 100 MiB까지 늘 수 있다. 백업(DATA-POLICY) 크기도 함께 커진다.

## 4. API

권한 표기: **O** = 로그인한 Owner(자기 문서함), **R** = 공유 링크로 들어온 Reader. 모든 응답 오류는 기존 형식 `{ code, message, retryable }`.

### 4.1 자료 등록 (버전 1)

`POST /api/sources` — O, `multipart/form-data`

| 필드 | 내용 |
|---|---|
| `file` | `.xlsx`, 5 MiB 이하 |
| `title` | 1~120자 |

기존 TXT·Markdown 업로드와 같은 주소다. 확장자가 `.xlsx`이면 파일 자료로 처리한다.

응답 `201`:
```json
{
  "id": "uuid", "kind": "file", "fileType": "xlsx", "title": "월간 정산",
  "revision": 1, "revisionId": "uuid", "createdAt": "2026-10-30T05:05:00Z",
  "file": { "name": "정산_1030.xlsx", "sizeBytes": 48211 },
  "uploadedByName": "박효민", "uploadedByDepartment": "재무팀",
  "compareStatus": "first",
  "changes": [],
  "questions": [
    { "id": "uuid", "kind": "purpose", "question": "이 파일은 어떤 업무를 위한 것인가요?", "answer": null, "skipped": false },
    { "id": "uuid", "kind": "origin", "question": "자료는 어디서 가져왔나요?", "answer": null, "skipped": false }
  ],
  "usage": { "bytes": 48211, "limitBytes": 104857600 }
}
```

`compareStatus`: `first`(버전 1) · `compared` · `no_changes` · `limit_exceeded`.

### 4.2 새 버전 올리기

`POST /api/sources/:id/revisions` — O, `multipart/form-data`

| 필드 | 내용 |
|---|---|
| `file` | `.xlsx`, 5 MiB 이하 |
| `expectedRevision` | 화면이 보고 있던 최신 버전 번호. 다르면 409 |

처리: 파일 검사 → 스냅샷 추출 → 직전 버전 스냅샷과 비교 → 변경 묶음·질문 저장 → 연결 매뉴얼 `needs_review=true`, 미답변 질문을 초안 `unknowns`에 추가(5절). 제목은 이전 버전 제목을 이어받는다.

응답 `201`: 4.1과 같은 모양. `changes` 예:
```json
[
  { "id": "uuid", "kind": "sheet_added", "sheet": "정산", "range": null, "summary": { "rows": 40, "cols": 6 } },
  { "id": "uuid", "kind": "formula_changed", "sheet": "원본", "range": "F2:F40",
    "summary": { "count": 39, "before": "=SUM(B2:E2)", "after": "=SUMIF(B2:E2,\">0\")" } },
  { "id": "uuid", "kind": "values_changed", "sheet": "원본", "range": "A2:E40",
    "summary": { "count": 132, "note": "rows_may_be_reordered" } }
]
```

### 4.3 버전 목록

`GET /api/sources/:id/revisions` — O, R(공유된 게시 매뉴얼이 가리키는 버전까지만)

```json
[
  { "revision": 2, "revisionId": "uuid", "createdAt": "…", "uploadedByName": "박효민", "uploadedByDepartment": "재무팀",
    "file": { "name": "정산_1030.xlsx", "sizeBytes": 50110 },
    "compareStatus": "compared", "changeCount": 3, "questionCount": 3, "answeredCount": 1 }
]
```
최신 버전이 먼저 온다. 텍스트 자료는 `file`이 `null`이고 `compareStatus`가 `text`다.

### 4.4 버전 상세

`GET /api/sources/:id/revisions/:revision` — O, R(위와 같은 범위)

4.1 응답 + `preview`:
```json
"preview": [
  { "sheet": "원본", "hidden": false, "rows": 41, "cols": 6,
    "cells": [["거래처","1월","2월","3월","4월","합계"], ["가나상사", 120, 80, 95, 110, 405]] }
]
```
시트마다 앞쪽 20행 × 12열까지. 값은 스냅샷의 표시 값이며 수식은 계산하지 않는다(캐시 값).

### 4.5 원본 파일 내려받기

`GET /api/sources/:id/revisions/:revision/file` — O(모든 버전), R(공유된 게시 매뉴얼이 가리키는 버전만)

- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename*=UTF-8''<원래 파일 이름>`
- `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`

### 4.6 답변 저장·건너뛰기

`PUT /api/sources/:id/revisions/:revision/questions/:questionId` — O, JSON

```json
{ "answer": "거래처별 합계를 따로 보려고 만들었습니다." }
```
또는 `{ "skipped": true }`. 답변 1~2000자. 같은 질문은 다시 고칠 수 있다.

응답 `200`: 바뀐 질문 1개. 처리: 답변하면 연결 매뉴얼 초안의 `unknowns`에서 그 질문 항목을 뺀다(5절). 건너뛰면 `unknowns`에 남긴다.

### 4.7 내 정보·사용량·이름 수정

| Method / Endpoint | 권한 | 내용 |
|---|---|---|
| `GET /api/me` | O | 기존 `{ name, email }`에 `department`(없으면 `null`), `loginMethods`(`password`·`google`), `usage: { bytes, limitBytes }` 추가 |
| `PATCH /api/me` | O | `{ "name": "새 이름", "department": "재무팀" }`(각 1~40자, `department`는 `null`로 지움). 이미 올린 버전의 이름·소속은 바뀌지 않음 |

### 4.8 기존 API 변경

| API | 변경 |
|---|---|
| `GET /api/sources`, `GET /api/sources/:id` | 응답에 `kind`, `fileType`, `uploadedByName`, `uploadedByDepartment` 추가 |
| `PATCH /api/sources/:id` (텍스트 수정) | 파일 자료이면 `422 file_source_readonly` |
| `POST /api/sources/:id/generate` (AI 초안) | 파일 자료이면 `422`. AI는 보류 중이며 파일 자료는 직접 작성 |
| `POST /api/manuals/:id/publish` | 게시 시 `manual_versions.history`에 변경 이력을 함께 저장 |
| `GET /api/manuals/:id` (Reader 포함) | 게시 버전의 `history` 포함 |

### 4.9 오류 코드

| code | HTTP | 언제 | 화면 문구 (안) |
|---|---|---|---|
| `file_too_large` | 413 | 5 MiB 초과 | 파일은 5 MB까지 올릴 수 있습니다. |
| `unsupported_file` | 415 | `.xlsx`·TXT·Markdown 외 | 엑셀(.xlsx), TXT, Markdown 파일만 올릴 수 있습니다. |
| `unsafe_file` | 422 | 확장자와 내용 불일치, 매크로, 암호, 손상, ZIP 이상 | 열 수 없는 엑셀 파일입니다. 매크로·암호가 없는 .xlsx로 저장해 다시 올리세요. |
| `file_type_mismatch` | 422 | 파일 자료에 다른 형식으로 새 버전 | 같은 자료에는 같은 형식의 파일만 올릴 수 있습니다. 새 자료로 올리세요. |
| `storage_quota` | 429 | 계정 합계 100 MiB 초과 | 저장 공간(100 MB)이 가득 찼습니다. 오래된 자료를 지운 뒤 다시 올리세요. |
| `conflict` | 409 | `expectedRevision` 불일치 | 다른 곳에서 새 버전이 올라왔습니다. 새로고침 후 다시 올리세요. |
| `file_source_readonly` | 422 | 파일 자료 텍스트 수정·AI 생성 | 파일 자료는 새 버전을 올려서 바꿉니다. |
| `not_found` | 404 | 없는 자료·버전·질문, Reader 범위 밖 | (기존) |

오류 메시지와 로그에는 셀 값·파일 내용·파일 이름을 넣지 않는다.

## 5. 매뉴얼 연결 규칙

- 파일 자료의 매뉴얼은 기존 "직접 작성" 흐름으로 만든다(`POST /api/manuals`, provenance `human`).
- 새 버전이 올라오면 `UPDATE manuals SET needs_review=true` (기존 `updateSource`와 같음).
- 미답변 질문은 초안 `unknowns`에 `"[v2 확인 필요] '원본' F2:F40 수식을 바꾼 이유"`처럼 넣는다. `unknowns` 최대 30개를 넘으면 남은 것을 `"[v2 확인 필요] 답하지 않은 변경 질문 N건"` 하나로 합친다. 초안 갱신 시 `draft_revision`을 올린다.
- 답변하면 그 항목을 `unknowns`에서 뺀다. 기존 게시 규칙(모든 `unknowns` 확인 체크)이 그대로 미답변 질문을 막는다.
- 게시하면 그 시점까지의 버전·변경 묶음 요약·질문·답변을 `manual_versions.history`에 고정한다. Reader는 이 고정본을 본다.

`history` 구조:
```json
{ "v": 1, "revisions": [
  { "revision": 2, "createdAt": "…", "uploadedByName": "박효민", "uploadedByDepartment": "재무팀", "fileName": "정산_1030.xlsx",
    "compareStatus": "compared",
    "changes": [{ "kind": "sheet_added", "sheet": "정산", "range": null }],
    "questions": [{ "question": "…", "answer": "…", "skipped": false }] } ] }
```

## 6. xlsx 읽기

### 6.1 라이브러리 비교 (2026-10-30 npm 기준)

| 후보 | 상태 | 판단 |
|---|---|---|
| `exceljs` 4.4.0 | 마지막 배포 2024-12. `unzipper`·`archiver`·`tmp` 등 의존성이 많음 | 쓰기 기능까지 들어 있어 무겁고 유지보수가 느림 |
| `xlsx`(SheetJS) 0.18.5 | npm 버전이 오래됨. 보안 수정판은 npm이 아닌 자체 CDN에서만 배포 | 의존성 검사·Dependabot 관리가 어려움 |
| **`fflate` 0.8.3 + `fast-xml-parser` 5.11.2** | 둘 다 2026년 갱신, 의존성 적음 | **채택.** 읽을 부분(시트·셀·수식·필터·이름 정의)만 직접 읽어 압축 크기·XML 엔티티를 통제 |

구현 계획 단계에서 최신 버전과 알려진 취약점을 다시 확인한다.

### 6.2 읽는 파트

`[Content_Types].xml`, `xl/workbook.xml`(시트 이름·순서·숨김, `definedNames`), `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheetN.xml`(`dimension`, `sheetData`의 셀 값·수식·캐시 값, `autoFilter`), `xl/sharedStrings.xml`. 날짜는 숫자 그대로 두고 `styles.xml`은 읽지 않는다(서식 비교 제외).

### 6.3 거부·한도

- ZIP 서명(`PK\x03\x04`)이 아니면, `[Content_Types].xml`이 없거나 통합 문서 형식이 아니면 `unsafe_file`.
- `xl/vbaProject.bin` 존재(매크로), `EncryptionInfo`(암호, OLE 컨테이너) → `unsafe_file`.
- 경로에 `..`·절대 경로가 있는 ZIP 항목 → `unsafe_file`.
- XML의 `<!DOCTYPE`·엔티티 선언 → `unsafe_file` (엔티티 처리 끔).
- 압축 해제 합계 20 MiB, 시트 20개, 비어 있지 않은 셀 50,000개, XML 파트 하나 10 MiB. **이 한도를 넘으면 거부하지 않고** 원본만 저장, `compare_status='limit_exceeded'`, 질문은 "이번 버전에서 무엇을, 왜 바꿨나요?" 1개.
- 외부 링크(`externalLinks`)·연결 데이터는 열지 않는다.

### 6.4 스냅샷 JSON

```json
{ "v": 1,
  "sheets": [
    { "name": "원본", "hidden": false, "rows": 41, "cols": 6,
      "cells": { "A1": { "t": "s", "v": "거래처" }, "F2": { "t": "n", "v": 405, "f": "SUM(B2:E2)" } },
      "autoFilter": { "ref": "A1:F41", "columns": [{ "col": 0, "filter": "가나상사" }] } } ],
  "names": [{ "name": "정산범위", "ref": "원본!$A$1:$F$41" }] }
```
`t`: `s` 문자 · `n` 숫자 · `b` 참거짓 · `e` 오류 · `z` 빈 값(수식만 있음). 공유 수식(`<f t="shared">`)은 기준 셀의 식을 상대 이동해 각 셀에 펼친다.

## 7. 비교와 질문 (결정적)

상위 설계 8.2·8.4의 규칙을 따른다. 구현 기준:

1. 시트 이름 집합 비교 → `sheet_added`·`sheet_removed` (이름 변경은 삭제+추가).
2. 공통 시트마다: 수식 문자열 비교 → `formula_added/changed/removed`. 같은 시트에서 **열이 같고 R1C1 상대식이 같은** 셀은 하나의 묶음으로 합쳐 `range`를 그 범위로 둔다.
3. 수식 없는 셀 값 비교 → 시트당 `values_changed` 1개(개수·범위). 바뀐 셀이 시트 비어 있지 않은 셀의 30% 이상이고 행 단위 값 집합이 같으면 `note: "rows_may_be_reordered"`(관찰 메모, 판정 아님).
4. `rows`·`cols` 변화 → `size_changed`. 자동 필터 범위·조건 → `filter_changed`. 이름 정의 → `names_changed` 1개.
5. 우선순위 정렬: 시트 추가·삭제 → 수식 → 필터 → 이름 정의 → 행·열 → 값. 같은 순위는 시트 순서·주소 순.
6. 질문은 순서대로 최대 9개 + 남으면 `other` 1개("나머지 변경 N건은 어떤 작업이었나요?") = 최대 10개. 변경이 없으면 `no_changes`, 질문 없음.
7. 질문 문구의 시트 이름·수식은 각각 40자·80자로 자르고 화면에서 이스케이프한다.

같은 두 파일이면 항상 같은 묶음이 나와야 한다(정렬 기준 고정, 해시맵 순서에 의존하지 않음). 규칙 질문(위 6번)은 AI가 실패했을 때의 대체 질문으로도 쓴다.

### 7.1 AI 질문·버전 요약

```
규칙 코드: v1·v2 스냅샷 비교 → 변경 묶음(결정적)
      ↓  구조만 담은 입력 (셀 값 없음)
AI(OpenAI Responses API, 기존 src/lib/ai.ts 호출 경로): 질문 ≤10개 + 버전 요약 1~2문장
      ↓  실패·꺼짐·한도 초과·형식 오류
규칙 질문(7절)으로 대체, 요약 없음
```

- **입력**: 파일 제목, 시트 목록(이름·행·열 수), 각 시트 머리글 행(1행 값, 시트당 최대 30열·각 40자), 변경 묶음(종류·시트·범위·칸 수·수식 전후 문자열 각 200자 이하). 셀 값·파일 이름·사용자 이름·이메일은 넣지 않는다. 머리글은 "열 이름"으로만 쓰며 2행 이하 값은 보내지 않는다.
- **출력(구조화 JSON, Zod 검사)**: `{ "summary": "…", "questions": [{ "groupPositions": [0], "question": "…" }] }`. `groupPositions`는 입력에 있는 묶음 순번만 허용, 질문 1~300자, 최대 10개. 검사 실패 시 규칙 질문으로 대체.
- **프롬프트 원칙**: 관찰한 변경만 근거로 묻고 의도를 단정하지 않는다("~하려는 건가요?"처럼 확인형), 엑셀 기능 이름(필터·수식·시트)으로 짧고 친절하게, 한국어.
- **저장**: `revision_questions.question`에 AI 문구를 저장하고 `source`(`ai`·`rule`) 열을 둔다. 버전 요약은 `source_files`와 같은 버전 단위로 `ai_summary text`(nullable)에 둔다. 화면에 "AI가 만든 질문" 표시. 3절 migration에 두 열을 추가한다.
- **비용·한도**: 기존 `AI_DAILY_LIMIT`(일 호출 수)와 `usage_counters`를 그대로 쓴다. 업로드 1회 = AI 호출 1회.
- **동기 처리**: 업로드 요청 안에서 호출하고 제한 시간(예: 20초)을 넘기면 규칙 질문으로 저장한다. 시연에서 업로드가 끊기지 않게 하기 위해서다.
- **안내**: 업로드 화면과 개인정보 안내에 "시트 이름·열 이름·수식과 바뀐 위치가 AI(OpenAI)로 전송됩니다. 셀 값은 전송되지 않습니다." 표시.
- **기존 AI 기능**: 매뉴얼 초안 생성·후임자 질문 답변은 `AI_ENABLED=true`로 켜서 시연에 함께 보여 준다. 이 두 기능은 텍스트 자료 원문을 보내므로(기존 동작) 시연은 합성 자료로만 한다.

## 8. 화면

| 화면 | 내용 |
|---|---|
| 문서함·자료 추가 | 파일 선택이 `.xlsx`도 받음. 상단에 사용량 `32 MB / 100 MB` |
| 자료 상세(파일 자료) | 파일 정보, **새 버전 올리기**, 버전 목록, 선택한 버전의 질문(답변 입력·건너뛰기)·변경 묶음·시트 미리보기, 버전별 내려받기 |
| 매뉴얼 검수 | 기존 화면 + "변경 이력" 영역(버전별 변경·질문·답변). 미답변 질문은 기존 "확인 필요" 체크 목록에 보임 |
| Reader 매뉴얼 | 게시본 + 고정된 변경 이력, 게시 버전 원본 내려받기 |
| 계정 `/account` | 탭 두 개(10/30 팀 피드백). **내 프로필**: 이름·소속(부서) 수정, 이메일, 로그인 방식(이메일·Google 연결). **설정**: 비밀번호 변경(기존 재설정 메일 흐름 재사용, Google 전용 계정은 안내만), 저장 공간 사용량, 계정 삭제(문서함의 기존 버튼을 이곳으로 옮김) |

목업(2026-10-30)은 자료 상세·새 버전 결과·후임자 화면을 팀이 확인했다. 계정 화면은 위 탭 구조로 목업을 고친 뒤 확정한다. 질문 카드에는 "AI가 만든 질문" 표시와 버전 요약 한 줄을 더한다.

## 9. 인수 조건 (중간평가 범위)

상위 설계 12절 중 이번 범위: F1·F2·F3·F4·F5·F6·F7(.xlsx 관련)·F8·F9·F10·F14·F15. F11·F12는 아래로 바꾼다. F13은 제외(고도화).

| ID | 확인할 결과 |
|---|---|
| F11' | 버전마다 계정 이름·소속·KST 시각이 보이고(소속이 없으면 이름만), 기록이 없는 옛 버전은 "기록 없음"이다 |
| F12' | 프로필에서 이름·소속을 바꿔도 이미 올린 버전의 값은 그대로다 |
| F16 | 계정 파일 합계가 100 MiB를 넘는 업로드는 저장 전에 거부되고, 사용량이 화면에 보인다 |
| F17 | 게시 후 답변을 고쳐도 Reader가 보는 게시본의 변경 이력은 게시 당시 값이다 |
| F18 | AI가 켜져 있으면 질문·버전 요약이 AI로 만들어지고 "AI가 만든 질문"으로 표시된다. AI 요청에 셀 값·파일 이름·사용자 정보가 없다(테스트 전송 기록으로 확인) |
| F19 | AI가 꺼짐·실패·시간 초과·형식 오류여도 업로드는 성공하고 규칙 질문으로 저장된다 |

시연 영상 시나리오(합성 데이터): `정산_1029.xlsx` 등록 → 기본 질문 답변 → 시트 추가·수식 변경·값 변경을 한 `정산_1030.xlsx`를 새 버전으로 → 변경 묶음·질문 확인, 하나 답변·하나 건너뜀 → 매뉴얼 검수에서 확인 필요 체크 후 게시 → 공유 링크로 후임자 화면 확인 → 이전 버전 내려받기.

## 10. 고도화 계획 (제출서 "발전 가능성" 칸 후보)

1. Word·한글·PowerPoint·PDF 버전 기록, 이어서 Word·한글 내용 비교 (같은 비교기 인터페이스).
2. AI 고도화: 문서함 전체 히스토리 요약, 답변을 매뉴얼 절차로 자동 반영 제안, 사용자 동의 시 셀 값까지 본 정밀 질문, 모델·비용 자동 선택.
3. 팀 기능: 팀 문서함, 초대, 권한, 팀 단위 올린 사람 기록.
4. 저장소 분리(S3·회사 드라이브 연동)와 요금제별 용량.
5. 카카오·네이버 로그인, 관리자·사용량 통계, 구독.

## 11. 역할 분담과 일정 (2026-10-30 박효민 제안)

엔진의 입력·출력(6.4절 스냅샷, 4.2절 변경 묶음, 7절 질문)을 이 문서로 고정해 두 사람이 동시에 작업한다.

| 담당 | 맡는 일 | 주요 위치 |
|---|---|---|
| **박기성: 엑셀 분석 엔진·DB·서버** | 3절 migration `005` 검토·확정, xlsx 읽기(파일 → 스냅샷, 6절 거부·한도 포함), 비교와 질문 만들기(7절), 합성 엑셀 테스트 파일(시연용 `정산_1029.xlsx`·`정산_1030.xlsx` 포함)과 단위 테스트, 용량 한도·백업 정책, 중간평가 후 운영 배포 | `db/migrations/005_file_versions.sql`, `src/lib/xlsx/`, `tests/unit/xlsx*`, `tests/fixtures/xlsx/` |
| **박효민(+Claude Code): API·화면·시연** | 4절 API, 5절 매뉴얼 연결, 8절 화면(버전·질문·미리보기·사용량·프로필 `/account`), 통합·E2E 테스트, 시연 영상 촬영, 제출서 고도화 계획 | `src/app/api/sources/**`, `src/app/api/me`, `src/lib/sources.ts`·`manuals.ts`, `src/components/`, `src/app/account/` |

- 엔진은 DB·HTTP를 모르는 순수 함수로 만든다: `readXlsx(bytes) → { status, snapshot }`, `compareSnapshots(before, after) → ChangeGroup[]`, `buildQuestions(groups) → Question[]`. 정확한 이름은 엔진 PR에서 정하고 이 절을 고친다.
- 엔진 PR 전까지 API·화면은 같은 모양의 가짜 결과로 개발하고, 병합 후 연결만 바꾼다.
- `src/lib/xlsx/` 밖의 파일을 고쳐야 하면 서로 먼저 알린다.

| 날짜 | 박기성 | 박효민 |
|---|---|---|
| 10/30~31 | migration 초안 검토, xlsx 읽기 | 화면 목업 확인, 구현 계획, migration 반영, API 뼈대 |
| 11/1~2 | 비교·질문 만들기, 합성 파일 | API·화면 |
| 11/3 | **엔진 PR 병합** | 엔진 연결, 매뉴얼 연결 |
| 11/4 | 함께 버그 수정 | E2E·마무리 |
| 11/5 | — | 시연 영상 촬영 |
| 11/6 | 제출 | 제출 |

**AI(10/30 중간보고서 범위로 확정)**: AI 질문·요약 호출, 프롬프트, 구조만 담은 입력 만들기, 대체 처리, 화면 표시는 박효민 담당(7.1절). 엔진의 `buildQuestions`(규칙 질문)는 박기성이 만들고 AI 실패 시 대체 질문으로 쓴다. API 키는 중간평가 동안 박효민 개인 결제 키를 로컬에서만 쓰며, 운영 배포 시 키·비용 한도·로그 점검은 박기성 담당이다.

## 12. 남은 확인

- 박기성: 100 MiB·5 MiB 한도와 DB 저장 방식이 서버 용량에 괜찮은지, 3절 migration 검토.
- 사용자: 8절 계정 화면 목업(탭 구조) 확인, OpenAI 키 준비(로컬 `.env`, 사용 한도 설정).
