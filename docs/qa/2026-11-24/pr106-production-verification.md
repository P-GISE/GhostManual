# PR #106 운영 배포·호환 검증

## 출처와 경계

- 완료:2026-11-24 11:02 KST. 사용자 남은 작업 진행 지시, 인프라 작업 창 조율·실제 flock·마커 확인 후 수행하고 창 반환.
- 병합96913c4fd5a3be3d379cc3893a8ade3bf276c81b, [canonical push CI45306982425 success](https://github.com/P-GISE/GhostManual/actions/runs/45306982425), 앱/문서 큐 워커 동일 이미지58e9e257a787530a52a227346bffc719e3bb6e8ea6d3896b4cb71c6904f21031.
- 직전 정상070e649·image9fe95616…를 보존. 환경·Compose·OCR 추출기 변경 없음. DB001~013·7workspace leadNULL·이동 wrapper EXECUTE true/직접 함수 false 유지.014·대표 지정·backfill은 수행하지 않음.
- 신규 S3 백업 저장 SHA256 checksum 확인. 이번 별도 복원 시험은 하지 않음.
- 보호 트리는013 파일 하나의 Git blob5416653c…/SQL SHA25618d771d3…만 추가 검토. 실행기·검사 기준·SSM/IAM 권한은 바꾸지 않음.

## 실행과 공간

고정 canonical 실행기로 앱을 반영한 뒤 worker는 기존 이미지 env 유지한 STOP→정확 CID 부재 확인→새 immutable pin→START 순서로 교체했다. 첫 검증은 Mounts 배열 순서 차이로 거절돼 이전 워커를 복구했다. 전체 항목이 같음을 확인하고 Destination 정렬 비교로 재실행했다. HostConfig·환경 해시·읽기 전용 mount·실제 worker slice/docker.scope 소속은 보존했다.

사용자가 지정 승인한 #95 옛 이미지5fd239f2357459eb637718272680b966cd37d21ffbfbacef54ebb8edae0cbf9f 한 개만 삭제했다. 모든 컨테이너/활성 설정/현재·직전 영수증 미참조를 독립 검토·실행 직전 재확인했다. 실제919,924,736bytes 회수, 배포 중0.5초 간격 관측 최소2,562,580,480bytes와 최종2,956,627,968bytes로2GiB 기준 유지. 관측 간 순간값까지 보증하는 연속 측정은 아니다. 다른 이미지·DB·백업·볼륨 삭제는 하지 않음.

## 실제 운영 API 검증

25개 검사가 통과했다. 실제 비밀번호 로그인·팀 생성·대표 미준비503, admin/member 필드와 이메일 경계, member403·비회원404·origin403·잘못된 입력422,013에서 기존 작성자 강등 허용·선택 팀 탈퇴 후 새 개인 세션·이전 토큰401, 일반 관리자 팀 삭제·로그아웃401·계정 삭제를 확인했다. 합성 계정/팀은 정리했고 기존 workspace 수7·대표 값0을 유지했다.

별도 합성 DOCX860bytes가202→queued→ready로 처리됐고 소유자 전용 `/api/sources/:id/revisions/1/document` snapshot에 `PR106 대표 호환 워커 합성 검증`이 일치했다. 최초 검사는 원문을 숨기는 source 요약 text를 확인해 실패했으며 올바른 document endpoint로 정정했다. 두 시도의 합성 계정·원본 자료 잔여0을 확인했다. 새 워커의 양성 smoke이며 모든 형식·OCR·권한 회수 중 작업 경합을 이번에 반복한 것은 아니다.

공개 로그인200·앱/워커 재시작0·OOM 없음·복구/배포 마커 부재를 확인했다. 실제 화면/픽셀 QA를 새로 수행한 기록은 아니며 기존 화면 회귀는 해당 CI의 브라우저/접근성 검증과 구분한다.

## 증거와 남은 단계

서버 root 전용 `/var/lib/ghostmanual-deploy/event/pr106-20261124/`: complete.json, app.json, worker.json, compatibility-qa.json, docx-qa.json, backup.txt, protected-review.json, canonical-artifact.json, image-cleanup.json, app-disk-monitor.json, schema-before/after.txt. 비밀 값·세션·업무 내용·백업 key는 Git에 기록하지 않는다.

014는 별도 SQL/격리 검증 PR에서 다룬다. 호환 writer 전체 반영 확인, 실제 제약·정해진 기존 admin 지정·실패 rollback·복구 기준 검토 뒤 별도 운영 승인 없이 실행하지 않는다. 대표 화면 연결과 새 권한표 결정도 이 배포로 완료된 것으로 표시하지 않는다.
