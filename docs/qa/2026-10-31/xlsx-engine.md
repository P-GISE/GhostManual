# 엑셀 엔진 검증·인계

검증일: 2026-10-31 KST. 기본 소스 `131a709`, 설계 PR #23 head `06b38b3`. 작업 브랜치 `feat/xlsx-engine`, 별도 Codex 작업 공간. 원래 작업 폴더의 미커밋 변경은 보존했다. 사용자 최종 확인·커밋·PR 요청 후 아래 검증을 재실행하고 반영한다.

## 제공 결과

- `src/lib/xlsx/index.ts`: 계획 Task0와 같은 타입·함수 계약. DB·HTTP·AI 의존성 없이 동작한다.
- `readXlsx(bytes)`: ZIP/CRC/실제 해제량·경로·매크로·암호·XML 검증, 공유 수식·문자열·필터·이름 정의 읽기. 업로드 5 MiB, 해제 합계20 MiB/XML10 MiB, 시트20, 셀50000. 별도로 펼친 셀 키·값·수식의 직렬화 크기 합계도20 MiB로 제한한다. 분석 한도 초과 시 partial snapshot 없이 limit_exceeded.
- `compareSnapshots(before, after)`: 9종 변경·상대 수식 묶음·결정적 정렬·행 재정렬 가능성 메모. 수식 캐시 값만 달라진 경우는 값 변경으로 세지 않는다.
- `buildQuestions(groups, first)`: 기본2개/한도1개/변경없음0개/변경별 최대10개. 변경11개 이상은 앞9개+나머지1개. AI 호출은 없다.
- `tests/fixtures/xlsx/`: 시연2개·거부용3개·셀 한도1개, 합성 자료만 포함. Node24에서 generate.ts로 재생성 가능.
- `005_file_versions.sql`: 박효민의 실제 migration 작업과 통합할 로컬 검토 제안본. 기존 자료 보존·공간 격리·불변성·실제 바이트 수·질문 연결 검증을 추가했다.

## 최종 실행 결과

모든 로그는 이 작업 공간의 `.omo/evidence/xlsx-engine/`에 있다. 이전 작업자 중간 결과 대신 아래 최종 결과를 사용한다.

| 명령/시나리오 | 결과 | 로그 |
|---|---|---|
| `npm test` | 종료0, 17파일·97테스트 통과 | unit.log |
| `npm run test:integration` (새 로컬 전용 ghostmanual_xlsx_engine_test) | 종료0, 14파일·83테스트 통과 | integration.log |
| `npm run typecheck` | 종료0 | typecheck.log |
| `npm run lint` | 종료0, 오류0·warning0, info149(기존 코드 포함) | lint.log |
| `npm run build` | 종료0, 프로덕션 빌드 성공 | build.log |
| `npm audit` | 전체 의존성 알려진 취약점0 | 직접 출력 확인 |
| `git diff --check` | 종료0 | 직접 실행 |
| 실제 시연 파일2개 → 읽기 → 비교 → 질문 | 정산 시트 추가, F2:F40 수식39개, 값132개 변경 및 질문 연결 확인 | tests/unit/xlsx-demo.test.ts, unit.log |
| fixture 재생성 SHA-256 일치 | 6개 파일 모두 동일 | ../xlsx-reader/fixtures-sha256.json |
| schema 이전001~004에 기존자료를 넣은 후005 적용 | 기존 텍스트 보존, 경계·불변·권한·CASCADE 검사8개 통과 | ../xlsx-schema/green.log |

## 독립 리뷰와 수정

독립 코드 리뷰의 최초 판정은 REQUEST_CHANGES였으며 근거 원문은 `.omo/evidence/xlsx-engine-code-review.md`에 보존한다. 추가 P2 지적은 없었다. 아래 P1 두 개를 회귀 테스트로 수정하고 부모 작업자가 최종 전체 단위97/통합83·타입·lint·빌드를 직접 재실행했다. 최초 리뷰 결과를 수정 후 재승인으로 표현하지 않는다.

1. 긴 수식 식별자를 매 접미사마다 다시 검사하던 제곱 시간 문제: 식별자 전체를 한 번 소비하는 스캔으로 변경. 100000자 회귀가 수정 전7229ms·timeout 실패 → 수정 후23ms 통과(단일 관찰값, 성능 보장 아님). `.omo/evidence/xlsx-compare/red-linear-scan.log`, `linear-verbose.log`.
2. 공유 수식·문자열의 메모리 확대: 워크북 전체 누적 직렬화 셀 예산20 MiB와 셀50000개를 만들기 전에 검사. 두 개의 제한 초과 회귀가 수정 전 완전 snapshot 반환으로 실패 → 수정 후 limit_exceeded. `.omo/evidence/xlsx-reader/expansion-red.log`, `expansion-green.log`.

Iron Laws MCP는 새 작업 공간이 서버 허용 폴더 밖이라는 오류로 실행하지 못했다. 허용 경계를 우회하거나 다른 폴더의 검사 결과로 대체하지 않았다. 위 테스트·리뷰는 Iron Laws 검사 통과를 의미하지 않는다.

### 커밋 전 최종 확인

사용자의 커밋·PR 요청 후 최신 기본 브랜치가 여전히 `131a709`, PR #23이 `06b38b3`임을 재확인했다. 전체 단위97·통합83·타입·린트·프로덕션 빌드·migration 재실행·npm audit(취약점0)·diff 검사가 다시 통과했다. 새 독립 리뷰가 이전 P1 수정과 계약을 확인하고 엔진 테스트49개를 직접 실행해 차단 지적 없음, APPROVE를 반환했다. 원문은 `.omo/evidence/xlsx-engine-final-code-review.md`에 있다. 이는 운영 적용 승인이나 API/UI 통합 검증을 뜻하지 않는다.

## API 담당 인계

```ts
import { readXlsx, compareSnapshots, buildQuestions } from "@/lib/xlsx";

const parsed = readXlsx(bytes);
const groups = parsed.status === "compared" && previousSnapshot
  ? compareSnapshots(previousSnapshot, parsed.snapshot)
  : null;
const questions = buildQuestions(groups, firstVersion);
```

이 예시는 호출 계약이며 저장/API 구현이 아니다. 첫 버전은 기본 질문2개이고, 분석 한도 안내는 별도로 표시한다. 이전 버전이 한도 초과여서 snapshot이 없으면 규칙 대체 질문을 사용한다. 변경 배열 순서가 저장 position이며 질문의 groupIndexes와 연결한다.

권한·최신 revision·100 MiB 합산 용량을 기존 workspace 행 잠금을 획득한 동일 쓰기 트랜잭션에서 다시 확인한다. 변경 묶음 먼저, 질문 나중에 저장한다. AI 요약은 immutable file INSERT 전에 확정한다. 반환 수식·시트·필터를 포함한 엔진 객체 전체를 AI로 보내지 말고 허용 필드만 구성한다. 질문은 일반 텍스트로 렌더링한다.

분석하지 못한 원본은 안전 인증된 파일이 아니다. API가 attachment/nosniff/no-store 및 Reader 게시 버전 권한을 지켜 내려줘야 한다. Snapshot/ChangeGroup을 DB에서 읽을 때는 신뢰 경계 schema 검증이 API 담당에게 필요하다.

## 남은 일

- 박효민 담당 API·화면·AI·매뉴얼 연결과 엔진 통합, 실제 사용자 흐름의 E2E.
- 005 제안본과 박효민 migration 구현을 하나로 조율한 후 병합·적용. 사용자는 최종 검사 후 이 변경의 커밋·PR을 요청했다. 다른 사람 PR 수정·병합은 하지 않는다.
- 운영 서버의 저장 공간·예상 계정 수·동시 처리량 실측과 전체 저장 예산 결정. 100 MiB는 원본만의 한도이며 snapshot·WAL·백업까지 보장하지 않는다.
- 백업/복구·삭제 잔존 정책 확정과 별도 복원 시험. 이번에는 정책안만 작성했다.
- 실제 Excel 앱에서 합성 파일 열기·운영 배포·실 AI·실메일/OAuth 검증은 미실행. 엔진/DB 변경만 있으므로 기존 브라우저 E2E 전체는 반복하지 않았다.
