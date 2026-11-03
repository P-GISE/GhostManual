# 공유 호스트의 ZRAM 부팅 복구

공유 호스트는 Docker 기동 전에 512 MiB ZRAM 스왑을 준비한다. 압축은 `lzo-rle`, 우선순위는 100이다. 이미 활성인 `/dev/zram0`는 그대로 둔다. 비활성이지만 크기가 설정된 장치나 초기화 명령 실패는 오류로 남겨 운영자가 조사할 수 있게 한다. Docker는 이 유닛의 성공을 필수 조건으로 삼지 않는다.

서버 체크아웃의 루트에서 다음을 검증한다. 테스트는 명령 실행을 모의하므로 실제 장치에 접근하지 않는다.

```sh
python3 -B -m unittest discover -s deploy/host-boot -p test_zram.py -v
systemd-analyze verify deploy/host-boot/zram.service
```

운영 설치 시 대상 파일과 유닛 이름이 비어 있는지 확인한다. 이미 설치됐다면 체크섬을 대조해 다른 운영자의 설정을 보존한다. 배포 잠금 아래 root 소유로 설치한 다음 enable만 수행한다.

```sh
sudo install -m 0644 deploy/host-boot/zram.py /usr/local/libexec/ghostmanual-zram.py
sudo install -m 0644 deploy/host-boot/zram.service /etc/systemd/system/ghostmanual-zram.service
sudo systemctl daemon-reload
sudo systemctl enable ghostmanual-zram.service
systemctl is-enabled ghostmanual-zram.service
systemctl show ghostmanual-zram.service -p Before -p ActiveState
```

승인된 다음 기동에서 유닛 성공과 `zramctl`, `swapon --show`, Docker·서비스 복귀를 확인한다. 부팅 전 설치를 취소할 때는 `systemctl disable ghostmanual-zram.service` 후 이번에 설치한 두 파일만 원복하고 `systemctl daemon-reload`를 실행한다. 현재 부팅에서 활성 스왑을 해제하거나 장치를 reset하는 절차는 없다.
