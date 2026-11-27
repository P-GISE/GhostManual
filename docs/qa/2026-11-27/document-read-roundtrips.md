# 文서 초기 조회 왕복 축소 실행 기록

기준은 PR121 병합41dd4e70abc5aba556b1c4f75938c96749ac2a77이며 사용자는 운영·migration014 적용을 보류했다.

## 실패와 최소 구현
a8570d57의 [집중 RED45992269087](https://github.com/P-GISE/GhostManual/actions/runs/45992269087)는 실제 DB013/Next/Chromium에서2건 모두 예상대로 실패했다. 등록 metadata는1회 기대/2회 실제였고 includeLatest=1 응답도 기존 배열이었다. 앱 코드를 바꾸기 전 확인했다. 일반CI는 별도 테스트 포맷 오류로 정정했다.

12f2b9b의 [집중 GREEN45992900712](https://github.com/P-GISE/GhostManual/actions/runs/45992900712)는 두 회귀를 통과했다. route 수명의 UI 문서함 목록을 공유해 crumb/SourceForm/SourceMove가 재사용한다. 다른 경로로 바뀌면 이전 목록은 보이지 않으며 이전 응답은 cleanup/abort로 차단한다. 완료된 인증 권한의 전역 cache나 TTL을 만들지 않았다.

파일 목록이 이미 읽은 첫 FileRevisionView를 재사용해 includeLatest=1의 {revisions,latest}를 같은 transaction에서 반환한다. assertSession의 workspace 잠금·현재 소속/공유 검사, Reader의 게시 revision·동결 답변을 유지한다. opt-in 없는 목록 배열·개별 상세·수동 버전 선택·2초 polling·게시 fileHistory·documentDetails 원문 경계는 보존한다. FileVersions 최초 응답은 unmount/request generation을 확인하고 id/Reader 변경 시 상태가 분리된다.

## 추가 검증·결과 출처
최종 head의 전체 CI·늦은 metadata의 CSR 왕복·Owner 동등성/다른 계정404/invalid401·Reader frozen answer/공유폐기401·기존 이름갱신/실패 차단과30표본 재측정은 [PR122](https://github.com/P-GISE/GhostManual/pull/122) 최신 결과를 따른다. 원시 p50/p95와 요청 수를 별도 재계산하고 성공 실행의 completed·표본 수를 확인한 값만 보고한다. 초안이며 이 PR을 병합하지 않는다.

초기 지연 기준선은 f080c1f/45988619065의 작은 native3형식·각30표본·DB013·desktop1명이다. 재측정도 같은 fixture·pacing3.5초·polling2초·계측 코드로 한다. 요청 감소와 실제 시간 변화를 구분하고 운영 네트워크/대형파일/SQL잠금/OCR/다중부하로 확대하지 않는다. 화면 감지는 자동화 assertion의 관측 지연도 포함한다.

## 범위
로컬 프로젝트/S1 빌드·부하·운영 조회/배포·SQL014/backfill·대표 지정·실제 AI/메일·원본/공유 삭제는 하지 않는다. 새 의존성·폴링 간격/워커 병렬 수 변경도 없다. 조회 permission은 서버가 매 요청 다시 확인하며 UI metadata로 승인하지 않는다.

Ruling: sourceMove가 늦게 마운트되므로 pending Promise만 합치는 대신 route 표시 목록을 공유한다. 같은 경로의 타 브라우저 rename 실시간 동기화·query-only 모드 전환은 이 작업의 보장 범위가 아니며, 현재의 전체 reload 문서함/로그아웃 경계를 유지한다.
