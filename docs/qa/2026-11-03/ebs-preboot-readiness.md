# EBS 전환 전 부팅 준비 — 2026-11-03

사용자는 인프라 채팅과 조율하여 재부팅 전 문제를 해결하고 EBS 암호화 작업을 계속하도록 지시했다. 로컬 PC의 파일·Docker·설정은 수정하지 않으며 원격에서만 준비한다. 공간 정리·확대는 보류한다.

## 담당과 관측

이 채팅이 S1의 단일 운영 writer이고 인프라 채팅은 읽기 전용 조사와 검토를 맡는다. 인프라 조사에서 공개 8개 호스트가 정상(7개 GET 200, pc는 LostArk로 302), DB 3개 healthy, 실행 중 컨테이너 10개 restart 0·OOM false임을 확인했다. 이번 사전 준비는 이 상태를 유지한다. 이후 실제 EBS 전환·새 부팅·단계 복구는 [완료 기록](ebs-encryption-cutover.md)을 따른다. 무인 재부팅 장애 주입 드릴은 별도 미실행이다.

- ZRAM: 현재 512 MiB, lzo-rle, 우선순위 100. 기존 부팅 구성 부재를 확인한 뒤 전용 oneshot을 설치하고 enable만 했다. 현재 swap은 중지·재초기화하지 않았다. 설치 직후 유닛은 inactive였으며 Docker 이전 실행·시간 제한은 30초다. 이후 실제 oneshot을 실행해 success/0을 확인했고 활성 swap과 모든 컨테이너가 불변이었다. 활성 swap은 건너뛰고, 초기화된 비활성 장치의 재포맷은 거부한다. 모의 4개와 systemd-analyze verify 통과, 전후 모든 컨테이너 ID·이미지·시작·재시작·OOM 불변이다.
- LostArk: Tailscale 주소가 준비되기 전 PG의 호스트 바인딩 복원이 실패할 가능성에 대응하는 프로젝트 전용 복구 유닛을 설치하고 enable했다. 독립 검토의 배포 경합 지적을 수정한 후 ZRAM 4개와 LostArk 9개를 합친 테스트 13개가 통과했다. 실제 oneshot도 기존 running 컨테이너를 재시작하지 않고 success/0으로 종료했고 모든 컨테이너 상태 불변을 확인했다. 실제 장애 재현 완료로 표시하지 않는다. Docker 전체 대기는 추가하지 않는다. 기존 배포의 실제 poll.lock과 .app-deploy.lock을 동일 순서로 획득하고, 실제 주소·기존 컨테이너 신원·PG healthy를 제한 시간 안에 확인한다. 생성·pull·migration·과거 롤백 컨테이너 재개는 하지 않는다.
- Chiikawa: 초기 네트워크 차이 가설은 철회했다. Compose 논리 이름 tunnel은 external eventops_default를 가리키며 live와 일치한다. 이미지·마운트·읽기 전용·tmpfs·보안 옵션·메모리·CPU도 대조했다. 수정이나 Compose 재적용은 하지 않는다.
- 커널: 실행 중은 7.0.0-1009-aws, 다음 기본 부팅 후보는 1014다. EBS 변경과 커널 변경을 섞지 않기 위해 전환 직전 알려진 실행 커널의 일회 부팅 경로를 검토한다. 이후 1009 일회 부팅을 지정하고 새 부팅과 next_entry 소비를 확인했다. 기본 부팅 후보 변경은 하지 않았다.

## 설치 파일과 의존

ZRAM은 `/usr/local/libexec/ghostmanual-zram.py`와 `/etc/systemd/system/ghostmanual-zram.service`, LostArk는 `/usr/local/libexec/lostark-restore.py`와 `/etc/systemd/system/lostark-restore.service`를 root 소유 0644로 설치했다. LostArk는 기존 root 전용 `/usr/local/lib/lostark-event/trust.py`의 배포 잠금 함수를 재사용한다. 이 의존 파일을 제거·이름 변경하면 복구도 실패하므로 배포 인프라 변경 시 함께 검토한다. 새 보안 권한이나 포트는 추가하지 않았다.

## 중단 경계와 롤백

사전 측정 스냅샷이 완료되고 부팅 준비가 검증되기 전에는 서비스를 중지하지 않는다. 실제 중단은 쓰기 차단부터 모든 서비스 재개까지 측정한다. 작업 창은 최대 60분을 목표로 하고 30분 시점까지 최종 스냅샷이 준비되지 않으면 원본 재개를 우선한다. 이는 완료 보장이 아니며, 상태별 되돌리기 시간을 남겨 원본 분리 전에 중단할 수 있다.

전환 직전 현재 10개 live 컨테이너와 각 restart policy·서비스/timer의 원래 상태·설정 해시를 root 전용 기록으로 보존한다. 자동 배포와 예약 작업을 막고 LostArk 복구 hold를 두며, 터널·앱·worker 쓰기를 차단하고 DB를 정상 종료한다. Docker 자동복원이 쓰기를 재개하지 않도록 작업 창에 한해서 원래 restart policy를 보존하고 일시 변경한다. 최종 정지 스냅샷과 암호화 볼륨은 동일 30 GiB·AZ·성능을 사용한다.

새 루트에서 암호화·부팅·마운트·ZRAM·DB·앱 검증 전에는 사용자 및 worker 쓰기를 열지 않는다. 실패하거나 복구 결정 시각에 도달하면 새 쓰기가 차단된 상태에서 원본 볼륨을 원래 장치로 연결해 복구한다. 재개 시 restart policy·타이머·터널·hold를 이전 상태로 돌린다. 원본 볼륨과 스냅샷 삭제는 별도 승인 전 실행하지 않는다.

[전환 계획·AWS 상태·비용](../2026-11-02/ebs-encryption-plan.md) · [부팅 준비 코드](../../../deploy/host-boot/README.md)
