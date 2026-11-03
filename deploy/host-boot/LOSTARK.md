# LostArk 부팅 복구

운영 PostgreSQL은 Tailscale 주소에 포트를 바인딩한다. 부팅 시 Docker가 먼저 복원을 시도할 수 있으므로 이 유닛은 Docker·tailscaled가 시작된 후 실제 인터페이스 주소를 최대 120초 확인한다. LostArk의 기존 컨테이너 네 개의 이름, Compose 프로젝트·서비스 라벨을 먼저 검증하고, 정지된 PostgreSQL을 기존 ID로 시작한다. DB가 최대 180초 안에 healthy가 되면 정지된 web·worker·character-worker를 시작하고 running 상태를 확인한다. Git pull, Compose 재생성, 재시작, 마이그레이션은 실행 경로에 없다.

주소 준비 후 기존 LostArk 배포 도구의 root 전용 `/usr/local/lib/lostark-event/trust.py`에서 `deployment_locks()`를 호출한다. `/var/lib/lostark-deploy/poll.lock`, `/opt/lostark-party/.app-deploy.lock` 순으로 공통 60초 안에 두 배타 잠금을 확보하고 컨테이너 식별 검사부터 마지막 상태 검사까지 유지한다. 기존 잠금 또는 도구가 없거나 안전성 검사가 실패하면 실행이 중단된다. 전체 유닛 상한은 500초로 주소·잠금·DB·앱 상태 대기 상한 합계 380초에 검사·기동 명령 시간을 포함한다.

운영 담당자가 배포 잠금 아래 기존 설치 충돌 여부를 확인한 후 아래 두 파일을 root 소유 0644로 설치한다.

- `lostark-restore.py` → `/usr/local/libexec/lostark-restore.py`
- `lostark-restore.service` → `/etc/systemd/system/lostark-restore.service`

설치 파일을 `systemd-analyze verify`로 확인하고 `systemctl daemon-reload`, `systemctl enable lostark-restore.service` 순서로 적용한다. 현재 서비스 재시작 없이 다음 부팅에 적용된다. `systemctl is-enabled`와 `systemctl show -p After -p ActiveState`로 확인한다. 다음 부팅 후 유닛 로그, DB healthy, 세 앱 상태·작업 처리와 실제 서비스 응답을 확인한다.

계획 점검 중 정지된 컨테이너를 유지해야 할 때는 재부팅 전에 root 소유 `/etc/lostark-boot-recovery.hold` 표식으로 이 유닛을 보류한다. Docker restart policy와 사용자·worker의 쓰기 차단은 별도로 관리한다. 작업 완료 후 담당자가 만든 표식만 해제하고 정상 서비스 상태를 확인한다. 이 유닛은 평소 네 컨테이너를 계속 운영한다는 전제로 동작한다. 서비스 이름, 포트 바인딩 또는 운영 대상이 바뀌면 먼저 유닛을 비활성화하고 대상을 갱신한다.

롤백은 `systemctl disable lostark-restore.service` 후 해당 작업에서 새로 설치한 두 파일을 원복하고 `systemctl daemon-reload`한다. 컨테이너 기동·종료는 이 롤백에 포함하지 않는다.
