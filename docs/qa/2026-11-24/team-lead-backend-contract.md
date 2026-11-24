# 대표 관리자 호환 백엔드·이양 API 계약

## 적용 단계와 신뢰 경계

013은 nullable `workspaces.lead_user_id` 열만 추가한다. 호환 백엔드는013을 최소 DB 버전으로 요구하며,013만 적용된 동안 기존 admin/member 권한과 마지막 관리자 보호를 유지한다. 개인 자료·공유 링크·Reader를 이동하거나 폐기하지 않는다.

준비 신호는 DB 소유자가 migration과 같은 트랜잭션에 기록하는 `schema_migrations.name = '014_team_lead_enforce.sql'`이다. 매 요청의 트랜잭션에서 읽으며 환경 변수·캐시·사용자 입력으로 켜지 않는다. 현재 운영 앱 역할은 이 표의 SELECT만 가능하고 INSERT·UPDATE·DELETE는 불가능한 것을013 적용 후 별도로 확인했다. 이 PR에014 SQL·backfill·자동 활성화는 없다. marker만 수동으로 추가하는 방식은 운영 전환 절차가 아니다.

향후014는 구버전 writer 종료 확인, 기존 admin backfill, 같은 팀 admin을 가리키는 대표 pointer와 최종 COMMIT 제약을 한 트랜잭션으로 제공해야 한다. 호환 createTeam은 workspace INSERT와 admin membership 생성 뒤 준비 상태를 확인해 전환 중 대기한 생성 요청도 대표를 설정한다. 대표 없는 개인 workspace는 그대로 둔다.014 이후 구버전 앱으로 복구하지 않는다.

## API

`GET /api/workspaces/:id/members`는 기존 응답에 다음만 추가한다.

- `leadReady: boolean`:014 marker가 있고 해당 팀 pointer가 NULL이 아닐 때 true.
- `leadUserId: string | null`: 준비된 팀의 대표 UUID, 미준비 시 NULL.
- `members[].lead: boolean`: 준비된 pointer와 해당 팀원 UUID가 같은지 계산한다.

admin/member 역할을 바꾸거나 기존 admin을 부관리자로 표시하지 않는다. member에게 이메일·대기 초대 정보를 노출하지 않는 기존 경계를 유지한다.

`POST /api/workspaces/:id/lead` 입력은 정확히 `{ "userId": "<uuid>" }`이며 기존 로그인·약관·same-origin·JSON 입력 검사를 거친다. workspace를 정렬 잠근 다음 계정·세션·현재 역할을 재확인한다. actor는 현재 대표, 대상은 같은 팀의 **다른 기존 admin**이어야 한다. 한 트랜잭션에서 pointer만 갱신하고 두 membership은 admin으로 유지한다. 응답은 `{ "id": "<workspace uuid>", "leadUserId": "<target uuid>" }`이다. 대상과 actor의 동일성은 문자열 표기가 아닌 DB UUID 비교로 판별하고 응답은 DB가 돌려준 canonical 대상 UUID를 사용한다. 쿠키를 교체하지 않는다.

- 401: 로그인·유효 세션 없음.
- 403 `invalid_origin`: 다른 origin, 또는 `forbidden`/ `lead_required`: 팀원 역할·현재 대표 조건 불충족.
- 404 `not_found`: 비회원·Reader·대상 팀 없음.
- 422 `invalid_input`: 잘못된 UUID/추가 필드/자기 자신/같은 팀의 다른 admin이 아닌 대상.
- 503 `team_lead_not_ready`:014 미적용 또는 팀 pointer NULL.
- 409 `lead_transfer_required`: 강제 단계 대표의 강등·내보내기·나가기·계정 삭제 시 이양 필요.

준비 전에는 admin에게503을 반환하고 기존 역할 수정·탈퇴·계정 삭제는 기존 의미대로 동작한다. member·비회원에게 준비 상태를 조회하는 우회 권한을 주지 않는다.

## 보존·권한과 경합

대표인 팀이 하나라도 있으면 계정 삭제는 개인 자료 제거 **이전**에 거절해 전체 rollback한다. 이양 후 이전 대표는 admin으로 남으며 기존 마지막 관리자 규칙 안에서 탈퇴·계정 삭제할 수 있다. 팀 삭제는 현재 admin 권한을 유지한다. 대표에게만 팀 삭제·다른 admin 변경을 허용하는 새 권한표는 이 PR에 포함하지 않는다.

같은 workspace 행 잠금이 이양·강등·탈퇴·계정 삭제를 직렬화한다. 대상 계정을 먼저 잠그지 않는다. 두 동시 이양은 한 번만 성공하고, 이양과 대상 강등/탈퇴/계정 삭제는 먼저 완료된 동작에 따라 나머지가422 또는409로 거절된다. 팀·원본·게시본·공유·기존 Reader는 거절 경로에서 유지된다.

## 검증 범위

RED CI45302151676에서 기존 DB203건 통과와 신규6건 실패를 확인한 후 구현했다. 최초 단계 경계 검사의 pg_stat_activity snapshot 캐시를 발견해 pg_stat_clear_snapshot으로 대기 관측을 보완했다.

새 DB 테스트는013 NULL 호환, pointer-only 이양·역할/세션 보존, 대표 삭제 방어와 개인/팀 원본·게시본·공유/Reader 보존, 두 이양/강등/탈퇴/계정 삭제 경합, INSERT 뒤 단계 전환 재검사와 실제 HTTP 로그인·origin·입력·비회원·Reader 검사를 포함한다. 테스트의014 marker는 **격리 CI의 프로토콜 모의**이며 실제014 FK·trigger·backfill 검증이 아니다. afterEach에서 제거한다. 구현1b27fe3의 CI45302755028에서 lint·타입·단위·DB212건이 통과했고 이미지/E2E 등 전체 결과는 이 문서 작성 시 진행 중이다. 최종 head의 전체 CI와 독립 검토 결과는 PR에 기록한다.

최종 검토에서 대문자 자기 UUID가 문자열 동일성 검사를 우회하는 문제를 발견했다. 회귀 e820c20/CI45304175752에서 함수·HTTP2건 실패(기존210건 성공)를 확인한 뒤 DB UUID 비교로 actor를 제외하고 canonical 대상 응답을 구현했다. 대문자 다른 admin의 성공200도 검사한다. 이는 새 이양 API 범위의 수정이며 기존 removeMember 표기 호환성은 별도 작업 목록으로 구분한다.

운영013 적용은 별도 [운영 검증 기록](migration013-production-verification.md)을 따른다. 이 API·보호 코드의 운영 배포와014는 아직 하지 않는다. 실제 화면의 이양 버튼·안내는 박효민과 이 응답/오류 계약에 맞춰 연결할 후속 작업이다.
