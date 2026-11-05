# 다중 형식 엔진 구현·검증 중간 기록 — 2026-11-04

> 11/5 통합: 열린 관리자 PR #53의006 번호를 보존해 문서 엔진 실행 파일은 `007_document_formats.sql`로 확정했다. 아래 날짜별006 표기는 당시 설계·시험 기록이며 운영 실행에는007을 사용한다.

> 후속11/5: 최종 새 이미지·오버레이 없는 실제 격리5/5·추출10/10으로 아래 차단을 해소했다. 운영 앱 반영·migration006·커밋/PR은 별도다. [최신 검증](../2026-11-05/external-engine-runtime.md).

## 승인과 현재 상태

사용자는 전체 형식과 격리 변환·OCR 방식의 [상세 설계](../../superpowers/specs/2026-11-04-multi-format-engines-design.md) 및 구현 진행을 승인했다. [구현 계획](../../superpowers/plans/2026-11-04-multi-format-engines.md)을 따라 기본 브랜치 `e6039bff132f6f65aec685f6dd1ab486a84451bb`에서 분리한 `feat/multi-format-engines-20261104` 작업 트리에서 구현했다. **현재 미커밋 검토·검증 단계이며 운영 기능 추가 완료를 뜻하지 않는다.** 운영 DB migration 006·worker 설치·외부 엔진 활성화·배포·자원 증설은 하지 않았다.

## 구현 범위

| 구분 | 구현한 내용 | 확인 범위와 한계 |
|---|---|---|
| 직접 추출 | DOCX·HWPX·PPTX·UTF-8 CSV 텍스트/표/슬라이드 순서 추출, 제한된 비교·규칙 질문 | 합성 구조·손상·제한 회귀. 글꼴·배치·이미지 시각 비교 및 실제 편집 앱 전체 호환성은 미검증 |
| 외부 추출 | HWP v5·구형 DOC/PPT·PDF·스캔 PDF, Tika/PDFBox/POI/Tesseract kor+eng, mTLS 전송·고정 실행 경로 | 실제 파일 파서 회귀는 통과. 최종 이미지 빌드와 실제 격리 성공은 미완료 |
| 저장·처리 | migration 006, 원본·불변 결과·작업 lease, 비동기 worker, 같은 형식 새 버전, 재분석은 새 revision | 독립 시험 DB에서만 001~006 적용. 운영 schema·기존 파일 수정 없음 |
| 권한·안전 | 검사 전 내려받기/초안/게시 차단, 소유자 전용 변경 원문, Reader 게시 이력 고정, AI에 추출 본문·값·OCR 원문 미전송 | 제한 결과는 직접 작성·명시 확인 게시만 허용. 자동 AI 생성 차단 |
| OCR 검토 | 알려진 OCR 불확실성만 남은 인접 PDF 두 버전은 소유자에게 잠정 변경 표시 | 항상 `review_required`, 변경 0건도 동일 원본 판정 아님. 저장된 limited 상태·공개 결과·질문은 승격하지 않음 |
| 화면 | 형식별 등록·새 버전, 처리 상태 갱신, 비교 범위·제한 안내, 소유자 원문 비교·재분석·게시 확인 | 합성 4형식×2버전·390px·DOCX 게시·별도 Reader를 실제 확인. 최신 분리 빌드에서 안내·완료 상태·부모/최신 선택 동기화 회귀도 실제 통과 |

파일당 5 MiB와 기존 계정 용량 제한을 유지한다. 안전 제한 초과·암호화·매크로/임베딩 등 거부 사유를 정상 비교나 변경 없음으로 취급하지 않는다. 직접 추출의 시간 제한은 협력적 검사이며 강제 중단 격리를 보증하지 않는다.

## 실행 증거와 상태 구분

아래 `.omo/multiformat/`는 이 작업 트리의 실행 증거 경로이며 커밋 대상 문서 링크가 아니다. 서로 다른 수정 시점의 수를 합쳐 최종 전체 통과 수로 표시하지 않는다.

| 검사 | 명령 또는 증거 파일 | 결과 |
|---|---|---|
| 직접 추출·비교·질문 | `npx vitest run --project unit --testTimeout 15000 --fileParallelism false tests/unit/document-native.test.ts tests/unit/document-compare.test.ts tests/unit/document-questions.test.ts`; `task-1-ocr-review-green.log` | 61/61, EXIT0 |
| 기존 XLSX 포함 backend | `task-3-final-green.log` | 56/56, EXIT0. 이후 질문/OCR 수정은 아래 별도 회귀 |
| 전체 DB 통합 1차 | `integration-full-first.log` | 24파일 140/140, EXIT0. 후속 변경 전 기준 |
| 질문·OCR 후속 backend | `task-3-ocr-green.log` | 16/16, EXIT0. 주입한 OCR snapshot 권한 시험이며 실제 OCR 실행 증거와 구분 |
| 실제 Node24 worker | `task-3-worker-smoke.log` | 합성 CSV queued→ready·원본 bytes 일치, EXIT0 |
| 외부 실제 파서 | `task-2-fix1-parser-red.log` → `task-2-fix1-parser-green.log` | PDF 동작·PPT 임베딩/매크로 5건 RED 재현 후, 위험 16건 거부+정상 PDF/PPT 4건 = 20/20 GREEN |
| 격리 컨트롤러 | `task-2-fix1-controller-green.log` | 10/10. 실제 namespace/cgroup 검증 대체 아님 |
| 실제 전체 격리 경로 | `task-2-fix1-isolation-blocked.log` | **5건 FAIL/BLOCKED**. 호스트의 user namespace·위임 cgroup 전제조건 부족. 네트워크 차단·OOM·분리 자식 종료·복구 성공을 입증하지 못함 |
| 전체 타입 검사 초기 | `typecheck-final.log` | 768 MiB 제한에서 EXIT0. 초기 변경 기준 |
| 최종 전체 타입 검사 | `final-typecheck.log` | 안정된 최종 typed fixture 포함 EXIT0 |
| 일반 production build | `build-first.log`, `build-resource-ruling.json` | 컴파일 후 메모리 한계로 중단. 성공으로 표시하지 않음 |
| 분리 build | `npx next build --experimental-build-mode compile` 및 `generate`; `build-compile.log`, `build-generate.log` | 각각 EXIT0, 35개 정적 페이지. 일반 build의 CI 성공을 대신 주장하지 않음 |
| UI 계약 | `task-4-client-green.log` | 5/5. 실제 브라우저 결과는 아래 별도 기록 |
| Aside 실제 브라우저 | `browser-qa.md` | 합성 DOCX/HWPX/PPTX/CSV 각각 UI로 2버전 업로드→실제 Node worker 결과→변경 1건/질문·소유자 이전/현재 원문 확인. 390×844 가로넘침 없음 |
| 검수·Reader | `browser-qa.md` | DOCX 대기 중 원본/초안/AI 차단→ready, 답변·직접 작성·저장·검수·게시 성공. 별도 합성 Reader의 owner `/document` 403, 공유 상세 200·이전 원문/소유자 diff 비노출, 모바일 가로넘침 없음 |
| 전체 단위 기본 제한 이력 | 최초 전체 실행·이전 재시도 기록 | 기본 5초는 227 통과·큰 fixture 1 timeout. 이전 15초 재시도 228건은 수정 전 기준으로 보존 |
| 최신 전체 단위 | `final-unit-after-fix.log`; `npx vitest run --project unit --testTimeout 15000` | 단일 수정 후 30파일 232/232 통과 |
| 최신 전체 DB 통합 | `final-integration.log` | 25파일 146/146 통과. 이후 수정은 UI만이며 backend 미변경 |
| 최종 단일 수정·재검토 | `final-fix-wave-review.md` | 실제 callback 회귀 RED2→GREEN4, 부모 revision 단조 갱신·최신 선택 동기화 소스 수정. 범위 재검토 APPROVE |

외부 파서는 JVM 실행 경로, PDF `/S` 동작 subtype, PPT 내부 임베딩/VBA 검사를 수정했다. 실제 격리 경로의 전제조건 실패를 skip이나 PASS로 바꾸지 않았다. 지원 가능한 격리 호스트에서 최종 이미지 및 전체 경로 검증을 통과하기 전 외부 엔진을 활성화하면 안 된다.

## 실제 브라우저 확인의 경계

비공개 loopback SSH 전달과 내부 네트워크 임시 앱·tmpfs DB, 합성 계정/파일만 사용했다. AI는 비활성, 메일은 파일 저장이므로 운영 계정·실제 메일·업무 자료를 쓰지 않았다. 대기 완료 후 상태 문구가 남는 문제와 새 버전 안내의 `.xlsx` 고정 문구를 발견해 소스·회귀 assertion을 수정하고 **새 빌드의 실제 브라우저 재확인도 통과했다**. 최종 검토에서 발견한 부모 revision/최신 선택 동기화 결함은 단일 소스 수정과 callback 회귀 RED2→GREEN4를 거쳐 범위 재검토 APPROVE를 받았다. 최신 빌드에서 대기 v1/v2를 만든 뒤 v1만 완료시켜 v2 기준 작성 차단이 유지됨을 확인했다. v1을 보는 동안 v2도 완료시키고 v2를 다시 선택하자 차단이 해제됐으며, 실제 작성 요청이 원본 버전2로 성공했다. `.csv` 안내와 처리 완료 문구도 확인했다.

Aside 전체 페이지 15초·viewport 5초 캡처는 CDP timeout으로 실패했다. DOM·동작·치수 검증을 화면 이미지/픽셀 검증으로 확대하지 않는다. Playwright CLI E2E suite는 실행하지 않았다.

## 남은 순서

1. 단위 232/232·DB 통합 146/146·최종 타입·변경 파일 lint·최신 분리 빌드·수정 후 실제 화면 회귀·단일 수정 범위 재검토를 마쳤다. 아래 운영 활성화 조건과 일반 CI 검증은 남아 있다.
2. 독립 최종 검토와 사람이 확인할 diff·검증 결과를 준비한다. 사람 확인 뒤 커밋·PR하며 이 기록만으로 병합하지 않는다.
3. 충분한 자원의 CI에서 일반 production build·브라우저 E2E를 확인한다.
4. 외부 엔진은 승인된 격리 실행 환경에서 최종 이미지·mTLS·namespace/cgroup·시간/메모리/출력 제한·분리 자식 종료·후속 정상 요청 복구를 검증한다.
5. 운영 반영은 별도 승인 범위로 migration·worker·설정·배포/복구 절차와 담당 충돌 여부를 확인한다. 이번 승인에는 배포·자원 증설이 포함되지 않는다.

실제 AI 호출·운영 성능/부하·실기기·시각적 배치 비교는 검증하지 않았다. OCR은 오인식 가능성이 있어 원본 대조와 사람의 검수가 필요하다.

## 최종 추가 확인

- `final-unit-after-fix.log`: 30파일 232/232, EXIT0. `final-integration.log`: 25파일 146/146, EXIT0.
- `final-typecheck.log`: EXIT0. `final-lint.log`: 변경 48파일 EXIT0, 기존 CSS 경고5건.
- `final-build-compile.log` / `final-build-generate.log`: 각각 EXIT0, 35개 정적 페이지. 일반 build 미검증 상태와 구분한다.
- `browser-qa-final.md`: 수정 후 실제 두 대기 버전 순서·최신 재선택·원본 버전2 작성 성공.
- 경미한 표시 제한: 다른 버전을 보는 동안 작업이 끝나면 버전 목록 질문 개수는 새로고침 전까지 늦게 갱신될 수 있다. 선택한 버전 상세와 작성·게시 권한은 정상 갱신된다. 이 표시 개선은 후속 항목이다.
