# 팀 이름 변경 후 상단 경로 갱신

## 기준과 원인

기본47168fc는 PR119 병합이고 병합 후CI45951476014가 단위280·DB262·E2E220·세션11·쿠키7·접근성117을 통과했다. 프로젝트 가이드와 할 일 목록의 #118 진행/#119 초안 표기를 이 결과에 맞춰 정리한다. 기존 엔진·이양 화면·탈퇴 안내·페이지 처리는 완료다.

WorkspaceCrumb는 영속 layout에서 usePathname을 읽지만, useCurrentWorkspace는 최초 mount에서만 현재 문서함을 조회한다. TeamPage의 이름 저장은 팀 데이터만 재조회한다. 기존 업무→팀 설정에서 rename→Next Link로 새 업무 등록 이동을 하면 저장 성공 후에도 이전 breadcrumb 이름이 남는다. 이 표시는 권한 판단에 사용되지 않으며 권한 결함으로 확대 보고하지 않는다.

## 최소 설계

표시 대상 /sources·/manuals·/templates 하위 경로에서만 현재 문서함을 읽는 자식을 만들고 pathname을 key로 사용한다. 경로가 바뀌거나 팀 화면에서 다시 들어오면 새로 조회한다. 조회 중/실패 시 이전 이름을 표시하지 않는다. 기본 훅의 undefined/loading·null/failure·개인 name=null 계약과 active cleanup, 서버 권한·세션 확인은 유지한다.

SourceForm/LegacyTemplates/TeamPage의 독립 조회는 변경하지 않는다. 표시하지 않는 화면의 crumb 조회는 사라지지만, 모든 metadata 요청이1개가 되거나 모든 이동 시간이 줄었다는 뜻은 아니다. 같은 pathname에서 다른 브라우저가 이름을 바꾸는 경우·query-only 이동의 자동 갱신은 이번 범위가 아니다.

## 회귀와 검증 기록

tests/e2e/workspace-crumb-refresh.spec.ts는 실제 격리 DB에서 회원/팀/텍스트 업무를 만들고, source의 기존 경로 확인→팀 Link→이름 저장/재조회 완료→새 업무 등록 Link 순서로 이동한다. html의 합성 marker가 보존되는지 확인해 전체 새로고침으로 결함을 숨기지 않는다. 새 이름/같은 팀 href·이전 이름 부재, metadata503 시 이전 경로 비표시·입력 차단을 desktop/mobile에서 검사한다.

최초 a4cb278/CI45954009304는 새 테스트의 체인 줄바꿈1건에서 lint 실패했다. 형식을 정리한488de064의 CI45954265705은 기존E2E220성공/새4실패로 완료됐다. desktop/mobile에서 새 이름 링크 부재와503 뒤 이전 경로 잔존을 확인했다. 새 브랜치 생성으로 시작된 기본47168 CI45954002744는 이미 검증한 코드의 중복 실행이라 취소했다. 앱 코드 수정은 실제 회귀 실패 확인 뒤 수행한다.

최종 구현/CI·독립 검토·캡처 결과는 [PR #120](https://github.com/P-GISE/GhostManual/pull/120)의 동일 head를 기준으로 기록한다. 성능 단축은 [준비 범위](../../superpowers/specs/2026-11-27-document-latency.md)와 [단계별 계획](../../superpowers/plans/2026-11-27-document-latency.md)을 따르며 아직 실측하지 않았다.

## 운영 경계

이번 작업은 GitHub 코드·격리 CI·합성 자료 범위다. 운영 배포·DB014·backfill·대표 지정·운영 부하·환경/보호 설정 변경·실제 AI/메일·자료/이미지 삭제는 하지 않는다. 기존 개인 자료·양식·공유를 보존한다.
