# 원격 배포 식별 확인 — 2026-10-17 KST

근거는 사용자가 기존 Tailscale SSH로 ubuntu 계정의 서버에 접속하여 실행한 docker ps/docker inspect/docker exec 출력이다. 에이전트가 직접 서버 셸을 실행한 결과와 구분한다. Tailscale 추가 인증 후 접속했고 AWS 보안 그룹·터널 설정 변경은 하지 않았다.

| 항목 | 확인 결과 |
|---|---|
| 앱 이미지 태그 | ghostmanual:58d9ebd1eac5f80f7fb66364ece4950e87a25ebf |
| 앱 실제 이미지 ID | sha256:419ee46b31617999150b7841ce6e7ccb650b6065441b4531cf115dceb4e33ca8 |
| 앱 상태 | running, OOMKilled=false, RestartCount=0 |
| 앱 실행 기간 | docker ps 출력 시 Up 10 days |
| 앱 바인딩 | 127.0.0.1:3200→3200/tcp |
| 원격 Next build ID | x6zb-rufDOdAIMgz8oWRv |
| DB 실제 이미지 ID | sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382 |
| DB 상태 | running, healthy, OOMKilled=false, RestartCount=0 |
| DB 실행 기간 | docker ps 출력 시 Up 12 days |
| DB 포트 | 컨테이너5432/tcp, 호스트 포트 매핑 없음 |

앱 태그는 현재 저장소 HEAD와 일치한다. 이미지 태그와 실제 이미지 ID·원격 build ID를 확보하여 원격 배포 식별 및 실행 상태 확인 항목을 완료한다. 태그가 소스 provenance를 암호학적으로 보증하는 것은 아니며 이미지 revision label/서명 또는 CI 산출물 digest 대조는 수행하지 않았다.

이전 로컬 build ID 0bYd-CJQ4c0aA4_VrAuRQ와 원격 build ID는 다르다. 앞선 공개 자산14개 해시 일치와 공개 desktop/mobile10/10 결과는 해당 관찰 시점의 독립 증거로 유지한다. build ID 차이만으로 기능 오류나 오래된 배포라고 판단하지 않으며 로컬/원격 이미지가 동일하다고 주장하지 않는다. 이를 이유로 재배포·재시작하지 않았다.

실제 AI·계정·예산은 사용자가 이번 범위에서 제외했다. 타이머·현재 메모리·기존3000/3100 서비스 상태는 이번 출력에 없어 재확인했다고 기록하지 않는다.
