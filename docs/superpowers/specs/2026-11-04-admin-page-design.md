# 관리자 페이지 설계 (OPS-ADMIN 1차)

작성: 2026-11-04 · 박효민 결정 · 박기성 검토 필요(DB migration·서버 설정)

## 1. 목적과 배경

2차 멘토링(2026-11-02)에서 "관리자 계정·전용 페이지에서 사용자와 접근 권한을 관리"하도록 권고했고, 대회 제출 전 우선 과제로 꼽았다. 운영자가 가입자 현황과 AI 사용량을 보고, 사용자별 권한을 조정할 수 있게 한다. `docs/99_해야할일.md`의 OPS-ADMIN 1차 범위다.

## 2. 목표 / 비목표

목표
- 관리자가 사용자 목록과 사용자별 이용 현황(업무 수·매뉴얼 수·게시 수·원본 저장 용량)을 본다.
- 관리자가 날짜별 AI 호출 수(전체·사용자별)를 본다.
- 관리자가 사용자별로 **관리자 지정·해제**, **AI 허용/차단**, **저장 용량 한도**를 바꾼다.
- 누가·언제·누구의·무엇을 바꿨는지 변경 기록을 남기고 화면에서 본다.

비목표 (이번 범위 아님)
- 다른 사용자의 문서 제목·본문·원본 파일 열람 (개수·용량만 본다)
- 계정 정지·삭제, 비밀번호 초기화, 대리 로그인
- 회사별 작업 공간·팀 권한(TEAM-LIBRARY), 구독·결제, 회사 로고
- 오류 로그 수집 화면(OPS-ADMIN 2차, 박기성 로그 수집과 함께)

반목표 (이렇게 되면 실패)
- 관리자가 아닌 사용자가 관리자 API나 화면 데이터에 접근할 수 있음
- 관리자 화면이 다른 사람의 업무 내용을 노출함
- 실수로 관리자가 한 명도 없는 상태가 됨

## 3. 관리자 결정 규칙

- 서버 환경 변수 `ADMIN_EMAILS`(쉼표 구분, 소문자 비교)에 있는 이메일의 계정은 **항상 관리자**다. 화면에서 해제할 수 없다. 이 값은 박기성이 서버 `.env`에 넣는다.
- 그 밖의 계정은 DB의 `users.is_admin`이 true이면 관리자다.
- 관리자는 다른 계정의 `is_admin`을 바꿀 수 있다. **자기 자신의 관리자 권한은 해제할 수 없다.** (관리자 0명 방지)
- 관리자 판단은 매 요청마다 서버에서 세션의 user_id로 다시 계산한다. 클라이언트가 보낸 값은 믿지 않는다.
- 공유 링크로 들어온 Reader 세션은 관리자가 될 수 없다.

## 4. 권한의 효과

| 권한 | 기본값 | 효과 |
|---|---|---|
| 관리자 | false | `/admin` 화면과 `/api/admin/*` 사용 가능. 상단 메뉴에 "관리자" 표시 |
| AI 허용 | true | false이면 그 사용자 문서함(workspace)의 AI 호출을 모두 막는다: 엑셀 변경 질문 AI 보강, 매뉴얼 초안 생성, 후임자 답변. 공유 링크로 들어온 후임자의 질문에도 **문서 주인의 설정**이 적용된다. 규칙 기반 질문과 직접 작성은 그대로 된다 |
| 저장 용량 한도 | null(=기본 100 MiB) | 업로드 시 `FILE_QUOTA_BYTES` 대신 이 값으로 검사. 1 MiB~1 GiB 범위. 이미 쓴 용량보다 작게 줄여도 기존 파일은 지우지 않고 새 업로드만 막는다 |

AI가 차단된 사용자가 AI 기능을 누르면 기존 AI 비활성 응답과 구분되는 안내를 보인다: "관리자가 이 계정의 AI 기능을 꺼 두었습니다. 직접 작성은 계속할 수 있습니다." (코드 `ai_blocked`, 403)

## 5. 데이터 (migration 006, 박기성 검토 필요)

```sql
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN ai_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN storage_limit_bytes bigint
  CHECK (storage_limit_bytes BETWEEN 1048576 AND 1073741824);
CREATE TABLE admin_events(
  id uuid PRIMARY KEY,
  admin_user_id uuid REFERENCES users ON DELETE SET NULL,
  target_user_id uuid REFERENCES users ON DELETE CASCADE,
  change jsonb NOT NULL,          -- {"field":"ai_allowed","from":true,"to":false}
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_events_created ON admin_events(created_at DESC);
```

- 기존 행은 기본값으로 채워져 동작이 바뀌지 않는다.
- 앱 계정(`ghostmanual_app`)은 기존 기본 권한 설정으로 새 표에도 읽기·쓰기 권한을 받는다(`deploy/database-runtime-role.sql`).
- 사용자를 삭제하면 그 사용자가 대상인 기록은 함께 지워지고, 그 사용자가 한 변경은 남되 `admin_user_id`가 비워진다.

## 6. API

모두 계정 세션 필요. 관리자가 아니면 403 `forbidden`.

| 메서드·경로 | 설명 |
|---|---|
| `GET /api/admin/users` | 사용자 목록: id, 이름, 이메일, 부서, 가입일, 이메일 인증 여부, 관리자 여부(`admin`, `adminSource: "env" \| "db" \| null`), `aiAllowed`, 업무 수, 매뉴얼 수, 게시 수, 사용 용량 bytes, 한도 bytes, 오늘 AI 호출 수 |
| `PATCH /api/admin/users/[id]` | body: `{ admin?: boolean, aiAllowed?: boolean, storageLimitBytes?: number \| null }` 중 하나 이상. 자기 자신 관리자 해제·env 관리자 해제는 400. 바뀐 칸마다 `admin_events` 기록. 응답은 바뀐 사용자 한 명 |
| `GET /api/admin/usage?days=14` | 최근 N일(1~60) 날짜별 AI 호출 수: 전체(`usage_counters` scope=global)와 사용자별 합계 |
| `GET /api/admin/events?limit=50` | 최근 변경 기록: 시각, 관리자 이름, 대상 이름, 바뀐 칸, 이전 값 → 새 값 |

`GET /api/me`에 `admin: boolean`을 추가해 상단 메뉴에서 관리자 링크를 보일지 정한다.

## 7. 화면 (`/admin`)

- 상단 메뉴: 관리자에게만 "관리자" 링크.
- 맨 위 요약 4칸: 가입자 수, 오늘 AI 호출 수 / 하루 상한(`AI_DAILY_LIMIT`), 전체 저장 용량, 게시된 매뉴얼 수.
- 최근 14일 AI 호출 막대 그래프.
- 사용자 표: 이름·이메일, 부서, 가입일, 업무·매뉴얼·게시 수, 용량(사용/한도 막대), 오늘 AI, 권한 칸(관리자 토글, AI 허용 토글, 용량 한도 선택). 검색 입력.
- 권한을 바꾸면 바로 저장하고 결과를 알린다. 관리자 해제·AI 차단처럼 영향이 큰 변경은 한 번 더 확인한다(브라우저 대화상자 대신 화면 안 확인).
- env 관리자 행은 관리자 토글이 잠겨 있고 "서버 설정 관리자"라고 표시한다. 내 행의 관리자 토글도 잠긴다.
- 맨 아래 최근 변경 기록.
- 관리자가 아닌 사람이 `/admin`을 열면 "관리자만 볼 수 있습니다" 안내와 문서함 링크.

## 8. 보안·개인정보

- 서버에서 관리자 검사 후에만 데이터를 읽는다(쿼리 자체를 관리자 검사 뒤에 둔다).
- 문서 제목·본문·질문·답변·파일 이름은 응답에 넣지 않는다.
- 이메일은 관리자에게만 보인다. 로그에 남기지 않는다.
- PATCH 입력은 Zod로 검증하고, 한도는 정해진 범위만 허용한다.
- 기존 Origin 검사·요청 제한(rate limit) 규칙을 그대로 쓴다.

## 9. 검증 계획

- 통합 테스트: 비관리자 403, Reader 세션 403, env 관리자 판정, 자기 해제·env 해제 거부, AI 차단 시 각 AI 경로가 `ai_blocked`를 내고 규칙 질문은 생성됨, 용량 한도 변경이 업로드 검사에 반영, 변경 기록 생성.
- E2E: 관리자로 로그인 → 메뉴에 관리자 → 사용자 AI 차단 → 그 사용자 화면에서 안내 확인. 비관리자는 메뉴 없음·`/admin` 차단.
- 접근성: 새 화면을 기존 접근성 검사 목록에 추가.

## 10. 운영 반영 조건 (박기성)

1. migration 006 검토 후 운영 DB 적용
2. 서버 `.env`에 `ADMIN_EMAILS` 추가 (효민·기성 계정 이메일)
3. 배포 후 관리자 계정으로 `/admin` 확인

이 셋이 11/6 23:59 전에 안 되면 관리자 페이지는 로컬 시연과 보고서의 "구현 완료·운영 반영 대기"로 표시한다.

## 11. 구현자가 정할 것

- 표·토글·그래프의 세부 스타일(기존 문서함 카드 스타일을 따른다)
- 용량 한도 선택지(예: 50·100·200·500 MiB·1 GiB)
- 사용자 표 정렬 기본값(가입일 최신순)
