# Multi-format Engines Implementation Plan

> 11/5 통합: 열린 관리자 PR #53의006 번호를 보존해 문서 엔진 실행 파일은 `007_document_formats.sql`로 확정했다. 아래 날짜별006 표기는 당시 설계·시험 기록이며 운영 실행에는007을 사용한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** XLSX 회귀 없이 DOCX/HWPX/PPTX/CSV/HWPv5/DOC/PPT/PDF/OCR 파일의 원본 보관·안전 추출·내용 비교·질문·게시 흐름을 구현한다.
**Architecture:** 기존 XLSX는 그대로 두고 documents 모듈과 불변 결과 테이블을 추가한다. 복잡한 파서는 별도 mTLS gateway/제한된 parser 프로세스로 실행하며 DB 작업 worker가 관리한다. 앱에는 Docker socket·변환 명령 실행 권한을 주지 않는다.
**Tech Stack:** TypeScript/Next/PostgreSQL, 기존 fast-xml-parser/ZIP 검사, 격리 Apache Tika/Tesseract.
**Spec:** ../specs/2026-11-04-multi-format-engines-design.md

## Global Constraints

- 파일당 5 MiB·계정당 100 MiB 유지, 기존 XLSX Snapshot v1/005 migration/게시 이력 보존.
- source_files/change_groups 불변. 일반 문서 compare_status/snapshot은 NULL, 결과는 append-only.
- 자동 AI에 원본/본문/표값/OCR 입력 금지. before/after는 owner전용. Reader는 게시 result와 고정 질문/답변만.
- processing/failed/rejected 원본은 다운로드/게시/AI금지. 검사완료 limited만 명시확인+직접작성 가능.
- 동시추출1, native20s/PDF60s/OCR120s, 20페이지,20MiB expanded,200k chars/5k blocks/50k cells.
- 로컬PC프로젝트·운영DB·서비스·설정·메일·실제AI 호출·정리/증설 변경 금지. 원격 별도clone, 테스트만격리. 기존4개문서미커밋절대변경X.
- 기존 파일당업로드/형식서명/auth/quota/revision conflict검증을 유지. 다운로드 attachment/nosniff/no-store.
- DOCX본문의현재표시내용만,삭제추적/각주/댓글/숨김제외. PPT노트/숨김제외. coverage표시.

## Review Focus

- 앞문단삽입·중복문단·표/문단순서: 전체수정오판방지 테스트 (Task1).
- owner이전본문이ReaderJSON/검색/AI/인쇄로유출: payload스냅샷/권한통합테스트 (Task3/5).
- 삭제중작업완료/lease재시작/동시버전: 결과고정및idempotency통합테스트 (Task3/4).
- 위장확장자·외부rels/XXE·zipbomb·암호/매크로: 거절테스트 (Task1/2).
- timeout/OOM/metadata접근/타작업파일읽기/출력폭탄: sandbox실행테스트 (Task2).

## Interfaces shared by workers

Task1 owns `src/lib/documents/{types,read,compare,questions}.ts` and supporting parser modules. Public API:
- `DocumentFormat = 'docx'|'hwpx'|'pptx'|'csv'|'hwp'|'doc'|'ppt'|'pdf'`.
- `detectDocumentFormat(fileName:string,bytes:Uint8Array):DocumentFormat` validates extension/signature/static container, throws AppError on invalid input.
- `readDocument(format:DocumentFormat,bytes:Uint8Array):DocumentExtraction` for native formats. DocumentExtraction union has status ready/limited/failed/rejected, `snapshot:DocumentSnapshot|null`, reason:string|null, and coverage:string[]. Native cannot silently accept external formats.
- DocumentSnapshot `{v:1, format, parserVersion:string, normalizationVersion:1, extractionMode:'native'|'ocr', blocks:DocumentBlock[], coverage:string[],warnings:string[]}`.
- DocumentBlock `{kind:'paragraph'|'table-row'|'slide'|'page',path:string,text:string,cells?:string[]}`. Content order defines order.
- `compareDocuments(previous:DocumentSnapshot,current:DocumentSnapshot):DocumentComparison` where `{status:'compared'|'no_changes'|'limit_exceeded', changes:DocumentChange[]}`. DocumentChange `{kind:'block_added'|'block_removed'|'block_modified',path:string,before:string|null,after:string|null}`. Owneronly bodies.
- `documentQuestions(changes:readonly DocumentChange[],first:boolean):{kind:'purpose'|'origin'|'change'|'other',question:string,groupIndexes:number[]}[]`, bounded10/500chars.
Task2 owns transport/worker sandbox `src/lib/document-extractor.ts`, `services/document-extractor/**`, deployment example only. Public `extractDocument(format,bytes):Promise<DocumentExtraction>` uses native readDocument or fixed mTLS gateway. Secrets only serverenv, remote errors bounded/redacted. No mocked gateway advertised as real parser support.
Task3 owns DB/API/backend (except Task1/2 files): source discrimination, generic revisions/history/AI redaction, immutable extraction state and jobs. Worker runner `scripts/document-jobs.ts` consumes shared extractDocument.
Task4 owns UI components and HTTP client shapes; waits Task3public shape. General non-XLSX SourceView fileType plus `extraction:{status,reason,coverage,resultId}` and owner generic document changes endpoint, reuse existing forms.

### Task 1: Native document engines + diff + questions

Files: new src/lib/documents/**, tests/unit/document-*.test.ts, tests/fixtures/documents/**. Existing XLSX utility used without modifying its behavior.
- [ ] Write/observe RED for two-version DOCX/HWPX/PPTX/CSV, mixedbodyorder, relationships/spineorder, trackeddeletionexclusion, quotedmultilineCSV, BOM/UTF8, duplicateparagraph/frontinsert.
- [ ] Implement shared typed limits/signature checks + native extraction and bounded diff/questions. Keep strings untrusted.
- [ ] Run targeted unit GREEN; malicious zip/XXE/encrypted/macro/oversize/partialcoverage; write evidence counts/log paths.
- [ ] Read-only task reviewer audits exact diff against spec before integration.

### Task 2: Real isolated external parser/OCR gateway

Files: services/document-extractor/**, src/lib/document-extractor.ts, tests/unit/document-extractor.test.ts, tests/fixtures/documents/** (externalfixturescoordinateTask1).
- [ ] RED test format/body limits, TLS authentication, fixed commands, timeout/groupkill, outputlimits/noURLs. Pin package/image versions/digests and licenses from primary sources.
- [ ] Implement real HWPv5/DOC/PPT/PDF extraction and kor+eng OCR with perjob isolation, credentials excluded, networkdeniedchild and outputnormalization contract. Gateway/transport no DB credentials or arbitrarypaths/options.
- [ ] GREEN synthetic externalformat two-version extraction+diff/OCR plus namespace/DB/metadata/network/file denial tests. Bound resources and record available/tested environment limitations truthfully.
- [ ] Provide opt-in example config/docs; do not install live service or alter existingcompose/workflows/Dockerfile automatically.

### Task 3: Immutable data, jobs, API and privacy

Files: new db/migrations/next_document_formats.sql (inspect actualnextnumber), src/lib/file-sources.ts/sources.ts/retrieval.ts/ai.ts/generation.ts/manuals.ts, new document-sources.ts/document-jobs.ts asneeded; sourceAPI routes; tests/integration/document-*.test.ts; existingfiletests.
- [ ] RED oldxlsxbackwardcompat, generalformatNULLmetadata, append-only extractionresults, safequarantine, lease/retry/delete/conflict/quota, owner/reader workspaceboundaries.
- [ ] Add migration without modifying005, generalformat registration branch, atomic revision+quota+job, immutable selectedresult/questions, servicelevel sameformat check, mimedownloadguards and filtered similar sources.
- [ ] Generic job runner auth/session/ownership changes rechecked at publish/write. Long parser outsidetransaction.
- [ ] Frozenhistory result/questionID; no raw before/after in Reader/AI/retrieval; generic safe structure-only AI prompts. pending/failed/rejected blocks generation/download/publish.
- [ ] GREEN new and existing DBintegration with separate temporaryPG/nohostports/prodvolumes. No migration on operationalDB.

### Task 4: Actual upload/versions/questions/published UI

Files: SourceForm.tsx, FileVersions.tsx, SourceDetail.tsx, source types/usagehelp and minimal supporting components, tests/e2e/document-versions.spec.ts.
- [ ] RED upload every supportedextension, expectedprocessingstate, native extractcontentpreviewowner, questions/answers/manualreview, rejectedreason/retry, sameformatnewversion, Readernodiffleak.
- [ ] Accept/type-aware file handling, previewlabels/coverage and basicdocument diff, perversiondownload, safeplaintext rendering/accessible status updates. Existing XLSX cellpreview preserved.
- [ ] GREEN E2E+keyboard/phoneviewport+a11y. No claim physicalmobile/printertested.

### Task 5: Full integration/security/release readiness

Files: docs/00/99+spec/implementationrecord and testevidence; do not overwrite existing4uncommitteddocs in originalcheckout.
- [ ] Combine engines/service/data/UI; run npm lint/typecheck/unit, isolated DBintegration, E2E, accessibility; confirm all selectedformats real successful test evidence.
- [ ] One independent wholebranch security/quality/QA gate, resolveCritical/Importantfindings, verify diff/secretpattern/links.
- [ ] Manual UI with syntheticfiles; list unsupported subfeatures, resource/testinglimits, deployment/migration steps and safe rollback.
- [ ] Present concrete code/testresults for human review. No sharedbranchpush/merge/productiondeploy or paidresource without applicableuserauthorization.

## Concrete QA scenarios

Test commands run in the existing node:24.20.0-bookworm-slim image, with repo at /work, user1000:1000, memory512m/cpus0.5/pids128, no production mounts/env/ports. `npm ci --ignore-scripts --no-audit --no-fund` has succeeded in this isolated checkout. Native tests use `npx vitest run --project unit tests/unit/document-native.test.ts tests/unit/document-compare.test.ts tests/unit/document-extractor.test.ts`. Preserve RED failure and GREEN output under .omo/multiformat.

| Task | Tool/input/ordered steps | Required assertion |
| --- | --- | --- |
| 1 | Vitest fixtures generated from UTF8 source into DOCX/HWPX/PPTX/CSV. Read v1, insert first paragraph/slide/quoted CSV row in v2, extract→compare→question. Also reorder document/table runs and slides via relationship order; upload zip with external relation/DTD/encrypted/macro/overlimit. | Exactly one addition for frontinsert, unchanged remaining blocks, exact Korean/table/text order, no stale deleted text, invalid cases rejected, limit→limited never no_changes. |
| 2 | `docker build -t ghostmanual-document-extractor:test services/document-extractor`; run image with `--memory=512m --cpus=0.5 --pids-limit=128 --read-only --network=none --tmpfs /tmp:size=128m`, mounting only synthetic fixture folder readonly. Container command `python3 -m unittest discover -s /service/tests -v`. Native runner+smoke uses only /fixtures/office.doc,/fixtures/slides.ppt,/fixtures/sample.hwp,/fixtures/text.pdf,/fixtures/scan-ko.pdf (generated or Apache-licensed synthetic samples, inspect source/expected text). | Extract expected synthetic phrase/blocks for every realformat; scan-ko invokes OCR and emits mode ocr. Separate adversarial parser subprocess attempts DB socket/169.254.169.254/internet/hostfile/gatewaykey/otherjobfile reads: all denied; blocking process exceeding deadline has no surviving child and yields timeout/failed; output cap rejected. Record real namespace availability; missing enforcement is test failure not simulated pass. |
| 3 | Vitest isolated PG test: create job A, lease with owner1, force lease expiry, claim owner2, finish owner1 then owner2 twice; query counts. Next create job B then delete source before completion. Parallel same expectedRevision uploads. | stale owner completion0 rows, exactly1 immutable result for current lease, duplicate completion idempotent, source deleted→no result/reference left, concurrent revisions one409, no quota doublecount; UPDATE published result/questions denied. |
| 3 privacy | Owner uploads v1 SECRET_OLD_7391, v2 SAFE_NEW_7391 and publishes. Change answer after publish. Read all Reader detail/history/evidence/download/AI payload paths and attempt owner-onlydiff with Reader+otherworkspace. | SECRET_OLD_7391 absent in all Reader/AI payloads, Reader sees frozen published answers not later edits, diff denied403/404, original published downloadhash exact. |
| 4 | `npx playwright test tests/e2e/document-versions.spec.ts` against isolated app+test PG. Owner setInputFiles docx v1, await ready status; upload v2, answer rulequestion, edit draft, mark reviewed, publish; authenticated Reader follows sharelink. Repeat upload and ready/limited state per nativeformat, then configured actualworker externalformat. | Owner sees exact contentdiff, queued disables publish/download; accepted limited displays coverage; Reader only published current snapshot/frozenQA, no old sentinel in DOM/network JSON; unsupported/failed shows exact reason not changednone. Mobileviewport/keyboard status and controls work. |
| 5 | `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm run test:accessibility`; commands sequenced on bounded test environment. Fullbranch reviewer consumes diff and saved logs. | All relevant suites pass on exact current diff; liveproduction config/container IDs/DB were untouched; unsupported subfeatures/resourceblocks explicitly reported rather than hidden. |

## Execution ledger

- 2026-11-04: user approved complete format scope+isolation/OCR and reviewed design. Preserve prior4docs. Implementation notyetverified.
- Ruling: execute plan through scoped workers under user AGENTS collaboration preference; user already approved implementation, so no duplicate confirmation between tasks.
- Ruling: no per-task commits until human code review as AGENTS requires. Evidence uses staged/untracked diff paths rather than invented commit ranges.
