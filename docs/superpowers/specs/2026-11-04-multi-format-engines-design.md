# 다중 업무 파일 엔진 설계 초안 — 2026-11-04

> 11/5 통합: 열린 관리자 PR #53의006 번호를 보존해 문서 엔진 실행 파일은 `007_document_formats.sql`로 확정했다. 아래 날짜별006 표기는 당시 설계·시험 기록이며 운영 실행에는007을 사용한다.

상태: 사용자 구현 요청에 따른 설계 초안. 접근 방식 A 및 이 상세 설계는 11/4 사용자 승인 완료. 제품 코드/설치/운영 적용은 아직 하지 않았다. 조사 기준은 기본 브랜치 `e6039bff132f6f65aec685f6dd1ab486a84451bb`다. 기존 백업·보고서 문서 4개 미커밋 변경은 별도로 보존한다.

## 목표와 현재 차이

사용자는 DOCX·HWPX·PPTX·HWP·PDF·CSV 엔진을 모두 제작하도록 요청했다. 기존 XLSX와 같은 자료 등록 → 새 버전 → 내용 추출 → 인접 버전 비교 → 변경 이유 질문 → 검수 매뉴얼·게시·공유 흐름을 제공한다. TXT/Markdown 기존 텍스트 등록 동작도 보존한다. 구형 DOC/PPT와 스캔 PDF는 변환/OCR 경로로 지원하는 안이며 지원 방식은 11/4 사용자 선택 A(전체 형식+격리 변환·OCR)로 확정했다.

현재 `file-sources.ts`, `sources.ts`와 `db/migrations/005_file_versions.sql`은 file_type=xlsx 전용이고 SourceForm의 accept는 XLSX/TXT/Markdown뿐이다. XLSX의 ZIP/XML 안전 검사·셀값 AI 제외·소유자 전용 과거값·Reader 게시본 경계를 후퇴시키지 않는다. 새 형식 업로드만 되고 내용 추출은 안 되는데 완료로 표시하는 구현은 금지한다.

## 접근 방식 후보

A. 권장안: DOCX/HWPX/PPTX/CSV는 기존 안전 ZIP/XML 도구·표준 파서로 구조를 추출하고, HWP v5/구형 DOC/PPT/PDF/OCR는 격리 추출 서비스로 처리한다. 모든 형식을 목표로 하고 문단/표/슬라이드/페이지의 내용 비교를 제공한다. 운영에는 별도 추출 이미지·작업 상태·자원 검증이 필요하다.

B. 경량 선행안: DOCX/HWPX/PPTX/CSV·텍스트 PDF까지만 먼저 배포하고, HWP/구형 DOC/PPT/OCR는 다음 배포로 둔다. 초기 운영 부담이 작지만 전체 형식 지원 요청을 완료했다고 할 수 없다.

사용자 선택: 11/4 “전체 형식 + 격리 변환·OCR”로 A 선택 완료. 아래 상세 계약은 11/4 사용자가 “설계대로 구현 진행”으로 승인했다. 글꼴·배치·그림·도형의 시각 비교, 문서 원본 편집·완벽한 레이아웃 재현, 전자서명 검증, 외부 클라우드 OCR, 추가 AI 호출·비용 변경은 이 설계 범위 밖이다. 개발/설계 승인은 실제 운영 migration·새 서비스 설치/유료 자원 승인과 구분한다.

## 형식별 지원 계약

| 형식 | 구조·비교 단위 | 추출 경로와 한계 |
| --- | --- | --- |
| XLSX | 기존 시트·셀·수식·범위 | 기존 엔진 유지 |
| DOCX | 본문 순서의 제목·문단·표/셀 | OOXML part/relationship를 검증하고 XML document-order를 보존하는 파서를 사용. 기존 object형 XML 파서가 문단/표 순서를 보존한다고 가정하지 않음. 첫 범위는 현재 표시 본문. 변경추적 삭제문·댓글·각주·숨김 텍스트는 제외하고 coverage에 명시. 삽입 추적문은 현재 표시 정책으로 포함 |
| HWPX | section 순서의 문단·표/셀 | HWPX manifest/spine/section 경로 검증. 중첩 표·빈칸·한글/혼합 run 순서 보존 |
| PPTX | presentation 지정 슬라이드 순서, 텍스트·표 | slide1 파일명 정렬을 순서로 쓰지 않음. 도형 레이아웃/애니메이션/그림 속 글은 기본 추출 제외. 발표자 노트·숨김 슬라이드는 제외하고 coverage에 명시 |
| CSV | 순서 있는 행·열·문자열 값 | 따옴표/쉼표/줄바꿈/BOM·CRLF 지원. UTF-8 엄격 판정, 잘못된 인코딩은 변환 안내. 첫 행을 임의 헤더/식별자로 사용하지 않음. 수식은 실행하지 않음 |
| HWP | HWP v5 본문·문단·표를 얻는 범위 | Apache Tika HwpV5Parser 후보. 모든 HWP 버전 지원으로 과장하지 않음. 암호·배포용/보호 문서·미지원 버전은 명확히 거절 |
| DOC/PPT | 본문 문단·표 / 슬라이드 텍스트 | Apache Tika OfficeParser 후보. 매크로·암호·실행/내장객체는 거절 또는 추출 대상에서 차단. 구형 포맷별 실제 구조 지원은 합성 fixture로 증명 |
| PDF | 페이지별 텍스트 블록 | PDFBox/Tika 후보. 읽기 순서 추정 한계 표시. 표 복원이 불확실하면 표로 확정하지 않고 페이지 텍스트로 표시 |
| 스캔 PDF | 페이지 OCR 텍스트 | Tesseract kor+eng 후보. 페이지별 텍스트가 없는 경우 OCR, 혼합 PDF는 해당 페이지만. OCR 오인식·낮은 신뢰 상태 표시, 변경 없는 것으로 처리하지 않음 |

표·도형 등의 구조를 실제로 추출하지 못한 형식은 지원표를 텍스트 수준으로 낮춰 표시하고 표 비교 완료를 주장하지 않는다. 서식만 바뀌면 “추출 내용 변경 없음, 서식·이미지 비교 제외”라고 표시한다. 동일 내용이라고 원본 바이트가 같다고 주장하지 않는다.

## 공통 엔진 계약

새 `src/lib/documents/`에 Format, DocumentSnapshot(version=1), Block, ExtractionResult, ChangeGroup을 둔다. XLSX Snapshot은 기존 타입을 유지하며 판별식으로 분기한다. 기존 저장 snapshot에 새 판별식을 억지로 요구하지 않고 xlsx file_type를 기준으로 역호환 처리한다.

- Block: 종류(paragraph/table-row/slide/page), 안정된 위치 경로, 표시 순서, 원문 문자열/셀 배열. 파서가 만든 HTML·URL은 실행/렌더링하지 않고 React text로 표시한다.
- Snapshot: format, parserVersion, normalizationVersion, blocks, coverage(포함/제외 기능), warnings, extractionMode(native/ocr).
- ExtractionResult: ready(snapshot), limited(reason), unsupported(reason), failed(reason). partial 결과에는 누락 범위를 명시하고 “변경 없음”을 허용하지 않는다. parserVersion이 달라지면 같은 버전의 파서로 재추출하거나 비교 불가 안내한다.
- Diff: 정규화된 블록 해시와 제한된 sequence alignment로 추가/삭제/수정 위치를 계산한다. 앞부분 삽입으로 뒤의 모든 문단이 수정으로 표시되지 않게 한다. 중복 문단은 순서 기준으로 비교하며 임의 동일성/이동 추정을 확정하지 않는다. CSV는 행순서·열좌표 기준, 사용자 key-column 추론은 하지 않는다.
- 무한 O(n²) 비교 금지. 블록/텍스트/계산 예산 초과 시 limited를 반환한다. 의미가 달라질 수 있는 공백·수식·숫자를 삭제하지 않고 CRLF/Unicode 처리 정책을 테스트로 고정한다.
- 질문: 변경 종류와 문서 위치를 사용하는 규칙 질문. 기존 작성 답변/건너뛰기·검수필요·게시 이력 freeze를 재사용한다. 단순한 문장 변경을 근거 없이 의미 변화로 확정하지 않는다.

## 개인정보·권한 계약

새 형식에서 추출한 본문·표 값·OCR 결과·과거 원문은 owner 전용 snapshot/변경 상세다. 기존 셀값 정책과 같은 원칙으로 change_groups 공개 요약에는 위치·종류·개수만 넣고, 원문/과거값 미리보기는 owner 전용 endpoint에서만 조회한다. Reader 응답·검색·근거·PDF·클라이언트 JSON에 과거 원문이 섞이지 않는 테스트가 필수다.

자동 외부 AI payload에는 원본 바이트/추출 본문/표 값/OCR 문장을 넣지 않는다. 구조/변경 개수/위치/사용자 답변 등 기존 허용 입력만 사용한다. 사용자 작성 설명·답변·수식에는 민감한 값이 포함될 수 있어 “업무 숫자 외부 전송 없음”으로 과장하지 않는다. 본문을 AI에 직접 보내는 기능은 이번 구현에 자동 포함하지 않는다. 사용자에게 검토·직접 작성 경로를 제공한다.

Reader는 현재 허용된 게시 revision/게시 history만 본다. 과거 버전·질문 답변·원본 다운로드는 기존 revision 권한을 적용한다. 새 parser failure/상태 조회도 다른 workspace 파일 존재를 드러내지 않도록 한다. parser 로그/오류에 원문·파일명·사용자 연락처·스택을 그대로 쓰지 않는다.

## 업로드·작업·저장 계약

파일당 5 MiB·계정당 100 MiB는 유지한다. 확장자만 허용하지 않고 파일 서명·내부 형식 구조·암호/매크로를 확인한다. ZIP bomb, 외부 relationship, XXE, 경로 탈출, 중복 entry, embedded executable·첨부문서·외부 URL fetch를 차단한다. OCR/변환은 네트워크에서 파일/모델을 받지 않고 배포 이미지 안에 검증된 파서/언어 모델을 고정한다.

신규 migration은 sources.file_type 허용 목록을 추가하고 문서 추출 결과 테이블과 영속 작업 테이블을 추가한다. 기존 source_files/change_groups UPDATE 금지 trigger는 보존한다. source_files에 file_type을 복사 저장하고 source 형식 일치를 INSERT 검사로 보장한다. XLSX 행은 기존 compared/limit_exceeded·snapshot 제약을 유지한다. 일반 문서 행은 compare_status=NULL, snapshot=NULL을 허용하는 조건부 CHECK로 구분하며 pending을 limit_exceeded로 저장하지 않는다. 실제 처리 상태는 job/result에서 조회한다. 원본 source_files는 불변이며 일반 문서 snapshot은 별도 append-only extraction_results에 저장한다. job 상태/lease만 변경하고 완료 결과를 UPDATE하지 않는다. source_revisions.text는 등록 시 구조 설명을 저장하며 이후 임의 본문으로 교체하지 않는다. XLSX 저장 snapshot과 일반 문서 결과를 file_type별 조회 경로로 분리한다. 기존 005는 수정하지 않는다. 업로드 원본의 quota 차감과 revision/job 생성은 한 transaction으로 처리하고 작업은 commit 이후 수행한다. 낙관적 revision 검사·idempotency·중복 업로드/동시 작업·삭제 중 작업 결과 폐기 정책이 필요하다.

작업 상태: queued → processing → ready / limited / failed / rejected. 처리 중에는 초안 생성·새 게시를 막고 자료 수정 직후 기존 needs_review/Reader 경계를 유지한다. 안전검사를 통과한 limited만 기본 이유 질문·직접 작성과 명시적 제한 확인 후 게시할 수 있다. 안전 판정 미완료 failed/rejected는 재시도/삭제 안내만 제공하고 원본이 연결된 게시·다운로드를 허용하지 않는다. 필요하면 별개 텍스트 자료로 직접 작성한다. 각 처리 결과에는 result_id를 부여하고 선택된 result_id와 생성 질문 ID를 revision에 고정한다. 질문이 생성된 뒤 기존 질문/선택 결과를 재작성하지 않으며, 결과를 바꾸는 사용자 재분석은 새 revision으로만 생성한다. 게시 history에는 source_revision_id/result_id/질문 ID와 답변을 고정한다. 제한 상태를 직접 작성으로 게시한 뒤에도 재분석 결과는 새 revision으로만 들어온다. 재시작은 결과가 확정되지 않은 lease 만료 작업만 제한 재시도하고 중복 결과를 version 조건으로 거절한다. 파일 bytes와 SHA는 원본 그대로 보관·다운로드하며 원본을 변환본으로 대체하지 않는다. failed 상태에서도 안전검사를 통과한 원본은 quota에 포함되고 owner가 삭제/재시도 가능하다. 크기·서명·정적 컨테이너 검사에서 확인되는 불안전/형식 불일치는 저장 전에 거절한다. 심층 검사가 필요한 원본은 quota를 차감해 격리 상태로만 보관하고 심층 판정 전 다운로드·게시·AI·Reader 접근을 차단한다. 심층 검사에서 암호·내장 실행객체·손상이 발견되면 rejected 상태로 고정하고 공개하지 않는다. owner는 정해진 보관 정책으로 삭제할 수 있다. 이 검사는 악성코드 무해화 보증이 아니다. 비교 불가/대기 상태는 no_changes로 내리지 않는다.

API: 기존 source 생성/새 revision은 형식 판별과 202 작업 상태를 지원하고, 기존 GET은 extraction 상태/coverage를 함께 반환한다. XLSX의 기존 동기 응답 계약은 보존한다. 새 형식 상세/재시도는 owner만 허용, 실제 공개/비공개 경계는 서버에서 검증한다. 유사 자료 검색도 같은 file_type만 제안하며 서비스 계층에서 형식 일치를 재검사한다. 새 버전은 같은 정확한 file_type만 허용하며 DOC↔DOCX/PPT↔PPTX 등 교차 변환 버전은 첫 범위에서 거절한다.

## 추출 서비스와 자원

웹 앱이 변환 프로그램을 직접 무제한 실행하거나 Docker socket을 가지지 않는다. 격리 추출 서비스는 DB/API키/메일키/호스트 mount를 갖지 않으며 허용된 바이트 입력·고정 parser 설정만 처리한다. 연결은 DB 작업 worker → mTLS 내부 입력 gateway → 요청별 파서 자식 프로세스 하나로 고정한다. gateway는 허용 입력 크기/format만 받아 바이트 pipe로 전달하고 임의 URL·파일경로·실행 인자는 받지 않는다. gateway 인증 키는 별도 UID가 소유하고 파서 UID·mount namespace·procfs에는 보이지 않게 한다. 파서 자식은 network namespace/출력 tmpfs/자원 cgroup을 분리해 네트워크·다른 작업 파일·gateway 자격증명에 접근하지 못하게 한다. 이 격리 실행 launcher는 검증된 고정 명령만 호출하며 웹 앱에는 host 명령 실행권한이나 Docker socket을 주지 않는다. raw Tika endpoint·임의 URL·셸 명령/옵션·사용자 경로 입력은 외부에 노출하지 않는다. 외부 outbound/호스트 접근은 차단하며 프로세스·임시 파일은 사용자별 분리한다. worker의 DB 작업 관리와 실제 파서 실행 권한을 분리한다. 배포 전 실제 네트워크/파일시스템 제한을 검증해야 하며 파서를 보안 경계로 믿지 않는다.

초기 제안 한도: 동시 추출 1개, native 20초, 변환/PDF 60초, OCR 120초, 추출 텍스트 200,000자/5,000블록, 표 50,000셀, PDF/OCR 최대 20페이지, 압축 해제 합계 20 MiB. 한도는 측정 전 제안이며 예산 초과는 partial/limited로 표시한다. 파서 cgroup 메모리/CPU/pids/임시공간을 고정하고 시간 초과는 자식 프로세스까지 종료한다. OCR 페이지 렌더링 크기·DPI·최대 픽셀 수도 제한한다.

11/4 조회 서버는 RAM 약 1.9GiB, available 약 1.0GiB, swap 약 363MiB 사용, 디스크 여유 약 3.8GiB였다. 이 값으로 전체 추출 서비스를 운영 가능하다고 판정하지 않는다. 개발 이미지/합성 시험은 별도 검증 창에서 실행하고 이미지/모델 크기·peak RSS·CPU·앱 latency·기존 서비스 상태를 측정한다. 용량 확보·유료 자원·재부팅·기존 이미지 삭제는 이 설계 승인에 포함하지 않는다. 자원이 부족하면 추가 운영 적용을 보류하고 원인과 선택지를 보고한다.

## 영향 범위

- core: file-sources.ts, sources.ts, types.ts, 문서 parser/diff 모듈, 기존 xlsx archive/xml의 공유 재사용 여부.
- HTTP: sources 생성/개별 source 새 revision/file 다운로드/형식별 owner preview·작업 상태/재시도.
- AI/근거: change-ai.ts, ai.ts, file history/generation/evidence/retrieval. owner 원문이 Reader·외부AI 경로에 진입하지 않게 검증.
- UI: SourceForm/SourceDetail/ManualCitationPanel/ManualVersionComparison/ManualDetail 등의 fileType 가정·accept·도움말·오류·한도·추출대기/실패·coverage 표시.
- data/ops: 신규 migration·worker 역할·job lease·추출 이미지/설정·개발/CI fixture·배포 가드/보존 검증.
- docs: 00 결정 기록, 02/03/04/05/06/07/08/09/10/99 관련 계약과 구현 진행 기록. 설계/구현/배포 상태를 구분.

## 단계별 완료 조건

1. 공통 계약·새 migration·기존 XLSX 회귀: 현재 snapshot/게시본을 그대로 읽고 이전 값 노출0.
2. DOCX/HWPX/PPTX/CSV: 각 정상 파일 2버전과 삽입/삭제/수정/동일/표/순서/한글 합성 사례를 실제로 통과.
3. PDF/HWPv5/DOC/PPT: 고정 parser·안전 샌드박스에서 내용 추출과 비교. 포맷별 unsupported/암호/손상/한도/timeout 경로 확인.
4. OCR: 한국어+영어 스캔/혼합 PDF와 저품질 오인식 사례, 페이지별 상태·신뢰 한계·timeout 검증.
5. 격리 경계: 파서에서 DB 주소·169.254.169.254·인터넷·호스트 경로·gateway 키·다른 작업 파일 접근이 모두 실패하고, timeout/OOM 후 앱이 계속 응답함을 합성 악성 fixture로 확인. 설치 환경에서 namespace/cgroup을 제공하지 못하면 변환/OCR는 운영 활성화하지 않는다.
6. API/DB/UI E2E: 업로드→추출대기→변경질문/답변→검수/게시→Reader/인쇄/다운로드, 세션·동시성·quota·다른 workspace/Reader차단·삭제/재시작 복구.
7. unit·DB통합·E2E·접근성·보안/파서 adversarial·이미지 build CI 통과 후 PR로 검토. 사용자 지시한 PR만 병합. 운영은 fresh baseline/backup/worker 자원측정/migration/앱과service실제확인·rollback 계획을 별도 완료.

“전체 엔진 완료”는 선택한 전체 형식의 정상/실패·내용비교·권한·실제 사용자 흐름 증거가 있을 때만 쓴다. 구현 PR 하나가 통과했다고 전체 형식이나 운영 검증 완료로 확대하지 않는다.

## 근거

- 기존 설계: [파일 버전 설계](2026-10-22-file-version-questions-design.md), [XLSX 상세 설계](2026-10-30-xlsx-version-detail.md).
- Apache Tika 형식 지원: https://tika.apache.org/docs/4.2.x/formats.html — HWP는 v5 parser 명시, Office/PDF 지원. 형식 감지와 추출 가능 여부는 다름.
- Apache Tika 보안 모델: https://tika.apache.org/security-model.html — 격리·네트워크 제한·least privilege·출력 비신뢰 필수.
- Tesseract 언어 데이터: https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html — kor/eng 사용 후보. 실제 인식 품질은 합성 검증 필요.

이 문서의 parser 제품/버전·라이선스·한도는 구현 전 고정·검증해야 한다. 설계 승인 전 의존성 설치·제품 코드·운영 변경은 하지 않는다.

## 구현 중 판단: OCR 검토용 비교

실제 한국어 OCR fixture에서 오인식이 관측됐다. 일반 비교 엔진은 경고가 있는 snapshot을 여전히 비교 불가로 유지한다. 별도의 owner 전용 OCR 검토 비교는 전체 페이지 처리를 마친 같은 parser/format/mode의 제한 결과에만 허용하고 항상 `review_required`로 반환한다. 차이 0건도 원본 동일로 판정하지 않는다. 이 비교는 공개 change_groups/질문/AI/게시 이력에 자동 편입하지 않으며, 기존 limited 게시 확인·AI 차단을 유지한다. 이는 승인된 OCR 내용 비교를 안전하게 제공하기 위한 구현 판단이다.
