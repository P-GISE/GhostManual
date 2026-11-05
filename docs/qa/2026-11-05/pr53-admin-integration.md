# PR #53 관리자 기능 최신 통합 검토

2026-11-05 KST · 원 PR53 head3f7284ecc970b3afdf6d2987388dff186a8c7a14 · 기본42075bc43a5975729a0fc61c07e617790a9f94f3.

## 범위와 현재 상태

사용자 요청: 최신 PR 전체 검토, 문제 수정, CI 후 병합과 운영 배포, 지정 관리자 실제 접근 확인. PR 원문의20파일을 현재 다중 형식 엔진과 대조했다. 문서·CSS 충돌은 양쪽 기능을 보존한다. 초기 DB 관리자006과 문서007은 운영에 이미 적용돼 재적용하지 않는다. 초기 관리자는 별도 사용자 승인으로 DB is_admin을 준비했으며 이메일·비밀번호·토큰을 저장소에 기록하지 않는다. ADMIN_EMAILS를 추가하거나 기존.env/Compose를 바꿀 필요는 없다. 현재 통합 검토 단계이며 이 문서만으로 운영 관리자 화면 배포 완료를 뜻하지 않는다.

## 확인한 문제와 최소 수정

- 동시 관리자 권한 변경: actor권한을 먼저 읽고 target만 FOR UPDATE하면 감사기록 FK의 actor KEY SHARE와 맞물려40P01 교착/500이 발생한다. 결정적 두 요청/행잠금 회귀에서 기존 코드 실패를 확인했다. 최초 우려한 관리자0은 실제 재현 결과가 아니므로 완료 사실로 기록하지 않는다. 전용 advisory782403으로 변경을 직렬화한 뒤 actor 권한을 재검사해 한 요청 성공·다른 요청403을 확인한다.
- 최신 일반 문서 경로는 계정별 한도 대신100MiB 고정 검사였다.1MiB 제한 계정이1,048,589bytes CSV를 받아들이는 RED를 확인했다. registerDocument의 동일 트랜잭션에서 workspaceStorageLimit을 사용해 새 자료/새 버전/재처리에 공통 적용한다. 한도 증가와 기존 revision보존을 검증한다.
- 자기 DB 관리자 행에 self를 표시해 해제 컨트롤을 숨긴다. 서버의 자기 강등 거부를 유지하며 다른 관리자 권한도 매 요청 검사한다.
- PATCH 성공 후 변경 기록 GET 실패를 저장 실패와 구분한다. 확인 패널은 안전한 취소 버튼에 포커스하고 취소 시 원래 조작으로 복귀한다. 권한 토글 label44px 기준을 적용한다.
- 합성 API만 쓰는 관리자 접근성 회귀를 desktop/mobile/tablet에 추가해 자기계정 잠금·확인/취소 포커스·조작 치수·저장 성공/이력 실패·가로넘침을 검사한다.

## 검증

원격 전용 internal Docker network와 ghostmanual_pr53_test DB,PG18.4동일image,Node24.20 pinnedimage를 사용한다. 운영 DB·실제 SMTP/AI·실제 업무자료는 테스트에서 사용하지 않는다. heavy flock과2GiB공간 하한을 지킨다.

첫 RED: 기존 관리자4통과/추가2실패(교착40P01·한도초과허용). 핵심 수정 후6/6. 전체 통합26파일152/152통과. 이후 UI보완/self응답 필드를 포함한 최종 lint·타입·단위·통합 및 GitHub CI 결과는 PR 최신 실행을 따른다. Iron Laws 연결 서버에는 해당 원격 경로가 없어 검사하지 못했으며 독립 코드 검토/실행 테스트와 구분한다.

## 배포·검증 경계

migration006 Git blob이 이미 적용한SQL과 동일한지 확인한다. protected_tree 변경은 기존 root review/module/config/receipt/fence/lock을 보존한 승인 설정만 갱신한다. canonical default push CI attempt1 artifact와 guarded SSM 배포를 사용한다. gateway/worker는 event fingerprint 전후 추가/제거하지 않으며 worker는 앱 성공 후 정확CID/label/imageSTOP→제거확인→imageenv갱신→START 순서로 별도 갱신한다. 실제 관리자 /admin·메뉴와API200,익명401·일반계정403을 검증하며 다른 계정 권한을 임의 변경하지 않는다.

## 한계

사용자 목록API는 전체를 반환하고 화면은100행만 그리므로 대규모 계정 증가 시 서버 페이지 나누기가 후속이다. OCR 정확도/시각 비교·장기 부하·실제 재부팅 검증을 이번 관리자 통합의 성공으로 확대하지 않는다.
