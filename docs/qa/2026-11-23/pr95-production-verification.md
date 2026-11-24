# 2026-11-23 PR #95 운영 배포·문서 검증

## 배포 식별과 근거

- PR: [#95](https://github.com/P-GISE/GhostManual/pull/95), 병합 커밋 `2ff147b33938b7b0ff6d728dee153607dfbce162`.
- Canonical 기본 브랜치 push CI: [45117000015](https://github.com/P-GISE/GhostManual/actions/runs/45117000015), 최종 성공.
- 검증 이미지 artifact:14791979577. 앱·문서 큐 워커 동일 image `sha256:5fd239f2357459eb637718272680b966cd37d21ffbfbacef54ebb8edae0cbf9f`.
- 단위278·DB 통합194·E2E146·세션11·쿠키7·접근성87·격리 자원46건 통과. 자원 측정은 허용24·안전 거부22, OOM·watchdog·미측정0건.
- 서버 root 전용 증빙: `/var/lib/ghostmanual-deploy/event/pr95-20261123/`의 `app.json`, `worker.json`, `complete.json`, `upload-qa.txt`, `backup.txt`, `image-cleanup.json`, `protected-review.json`, `ui-qa.json`.

## 배포 절차와 보존 경계

인프라 채팅과 작업 창을 조율하고 실제 서버 잠금·마커·자원을 확인했다. 새 S3 백업 성공 후 CI workflow와 신규 측정 child 두 항목만 보호 트리에 반영했다. `.env`·Compose·고정 실행기·그 밖의 보호 목록은 유지했다. 새 배포 스크립트 작성 명령은 자동 검토에서 `blocked by policy`로 거부돼 파일이 만들어지지 않았고 기존 고정 실행기와 별도 워커 절차를 사용했다.

앱 배포 전체 동안 기존 워커를 그대로 유지해 비앱 컨테이너 fingerprint 경계를 지켰다. 앱 성공 후 기존 이미지 pin으로 워커를 중지하고 정확 CID 부재를 확인한 다음 새 digest pin으로 시작했다. 워커 경계 최초 비교는 Docker의 mount 표시 순서 차이로 중단됐으나 같은 mount 항목 순열이 기존 전체 경계 hash와 일치했고 Config·환경 fingerprint도 일치했다. 이를 설정 변경으로 간주하거나 보호 기준을 완화하지 않았다.

Migration12개·인증 이동 wrapper-only 실행 권한·운영 환경·OCR 추출기 `a4ce8378…`를 유지했으며 SQL을 다시 실행하지 않았다. 최종 앱·워커 Running·재시작0·OOM 없음·로그인200과 event 진행/import 마커 부재를 확인했다.

별도 사용자 승인으로 미사용 이미지 `c21c9ae` 한 개만 삭제했다. 직전 정상103db6f·그 이전40f98e3과 DB·백업·추출기는 보존했다. 회수량919,748,608bytes, 최종 여유2,437,959,680bytes(약2.27GiB)였다. 완료와 작업 창 반환을 인프라 채팅에 공유했다. 이번 승인이나 기록은 추가 자원 삭제·증설 승인이 아니다.

## 운영 API 실제 업로드·추출

합성 계정·팀을 만들고 팀원으로 다음 네 형식을 한 건씩 순차 업로드했다. 외부 메일과 AI는 호출하지 않았고, 실제 운영 API와 새 큐 워커를 사용했다.

| 형식 | 업로드 | 추출 | 원문 표식 | 팀원·관리자 결과 조회 | 비회원 원본·결과 조회 |
|---|---|---|---|---|---|
| DOCX |202|ready|일치|200|404|
| HWPX |202|ready|일치|200|404|
| PPTX |202|ready|일치|200|404|
| 텍스트 PDF |202|ready|일치|200|404|

팀원·관리자가 받은 snapshot이 같은지 확인했다. API를 통한 합성 팀·계정 정리 후 생성 계정·팀·자료 버전 잔여0건을 별도로 확인했다. 실제 업무 자료를 사용하거나 지우지 않았다. 이 API 결과는 화면 조작 검증을 대신하지 않는다.

## 운영 화면 확인 — 3형식 통과·정리 완료

Aside에서 실제 파일 입력의 `setInputFiles`로 선택한 뒤 "원본 등록"을 눌러 자료 상세로 이동하고 "현재 추출 내용"을 펼쳤다. 다음 내용을 화면 DOM으로 확인했다. API를 직접 호출해 등록한 것을 화면 업로드로 표시하지 않는다.

| 형식 | 화면 업로드·추출 | 추출 위치·원문 |
|---|---|---|
| DOCX |완료·1개 블록|`body/block/1` — `GhostManual DOCX marker`|
| HWPX |완료·2개 블록|`section/1/block/1` — `GhostManual HWPX marker`, `section/2/block/1` — `둘째`|
| PPTX |완료·1개 블록|`slide/1/block/1` — `GhostManual PPTX marker`|

AI를 호출하지 않았으며 기존 관리자 계정의 로그인 세션을 유지했다. 화면용 합성 자료3개만 각각 확인 체크와 삭제 버튼으로 정리했고 정확한 원본 UUID·버전 조회로 잔여0건을 확인했다. 최종 매뉴얼 화면에는 기존 게시 예제만 유지됐다. API 검증용 계정·팀·자료 정리와 구분한다. 별도 root 증빙 `ui-qa.json`의 확인 시각은2026-11-23 14:50 KST다.

스크린샷1회는 10초 CDP timeout으로 실패했고 반복 시도하지 않았다. 따라서 파일 선택·화면 전환·표시 내용은 실제 DOM 관측으로 확인했지만 이미지 캡처·픽셀 단위 검증은 하지 못했다.

## 허용 범위와 미검증

`.xml/.rels/.hpf` 합계1MiB·시작 태그 후보100,000개의 선행 검사와 미검사 DOCX 스타일 거부가 적용됐다. 파일5MiB·ZIP 전체확장20MiB는 유지하지만 복잡한 문서 일부는 이전과 달리 거부될 수 있다. 기존 완료 자료·게시 snapshot은 자동 재처리·삭제하지 않는다. [원인·회귀·자원 측정](ooxml-parser-resources.md)을 따른다.

자원46건은 GitHub 격리 runner의 parser 단독 결과이며 서비스 전체 동시 부하와 가능한 모든 OOXML 최악값을 보증하지 않는다. 이번 배포 검증에서는 OCR·전체 동시 부하·새 복원·Strix 실전 스캔을 재실행하지 않았다. Strix 인증·모델 설정과 추가 OCR 배치는 별도 범위다. 공유 서버 자체 빌드·대용량 fixture 생성·파싱 부하는 수행하지 않았다.
