# PostgreSQL 외부 백업

매일 한국 시간 03:20에 GhostManual DB 전체를 pg_dump custom 형식으로 백업한다. 같은 리전(ap-southeast-2)의 전용 비공개 S3 버킷에 TLS로 전송하고 SSE-S3 AES256으로 저장한다. postgres/ 경로의 객체는 생성 후 30일이 지나면 S3 수명 주기 만료 대상이 된다. 만료 처리는 비동기다. 성공 시각 사이의 변경은 마지막 백업 이후 복구할 수 없다. 이 덤프에는 원본 파일과 계정 정보가 들어 있다.

## 준비

1. 버킷 관리자 계정에서 전용 일반 목적 버킷을 만들고 Block Public Access 4개 모두 켬, Object Ownership Bucket owner enforced, 기본 암호화 SSE-S3, 버전 관리 꺼짐을 확인한다. 이 만료 규칙은 버전 관리를 사용하지 않는 전용 버킷을 기준으로 한다.
2. bucket-policy.json의 REPLACE_BUCKET을 실제 버킷 이름으로 치환해 적용한다. lifecycle.json의 규칙을 적용한다. 이 정책은 HTTP와 조건 없는 덮어쓰기를 거부한다. 단일 객체 업로드에 한정된다. [AWS 조건부 쓰기](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html) · [만료 처리](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)
3. instance-policy.json의 REPLACE_BUCKET을 치환하고 EC2 인스턴스 역할에 적용한다. 호스트 자격 증명은 인스턴스 프로파일의 임시 자격 증명을 사용한다. 앱 컨테이너에 AWS 키를 전달하지 않는다. 수명 주기 설정, 버킷 관리, 객체 목록·삭제는 호스트에 부여할 필요가 없다. 별도 관리 주체가 정책을 회수하거나 변경할 수 있게 한다.
4. 공식 AWS CLI v2를 `/opt/ghostmanual/tools/bin/aws`에 설치하고 `aws --version`을 확인한다. 서비스는 이 전용 경로를 PATH에 지정한다. aws s3api put-object --generate-cli-skeleton input 결과에 IfNoneMatch 입력이 있어야 한다. PostgreSQL 18 클라이언트는 기존 DB 컨테이너의 것을 사용한다. 운영 root 셸에서 아래를 실행한다.

```sh
install -m 0755 deploy/backup/backup.sh /usr/local/sbin/ghostmanual-backup
install -m 0644 deploy/backup/ghostmanual-backup.service deploy/backup/ghostmanual-backup.timer /etc/systemd/system/
install -m 0600 /dev/null /etc/ghostmanual-backup.env
printf 'BACKUP_BUCKET=%s\n' 'REPLACE_BUCKET' > /etc/ghostmanual-backup.env
systemctl daemon-reload
systemctl start ghostmanual-backup.service
journalctl -u ghostmanual-backup.service -n 5 --no-pager
```

## 복원 시험과 타이머 가동

첫 서비스 실행이 보고한 객체 키와 SHA-256을 사용한다. 아래 명령은 S3에서 다시 받아 저장소 암호화 속성·SHA-256을 확인한 뒤 네트워크·포트·운영 볼륨을 연결하지 않은 PostgreSQL 임시 컨테이너에서 전체 트랜잭션으로 복원한다. users, workspaces, source_files, source_revisions, manual_versions의 존재까지 확인한다. 데이터·DB 회신 본문을 로그에 쓰지 않는다.

```sh
export PATH=/opt/ghostmanual/tools/bin:$PATH
export AWS_REGION=ap-southeast-2
. /etc/ghostmanual-backup.env
export BACKUP_BUCKET
bash deploy/backup/restore-drill.sh 'postgres/REPLACE.dump' 'REPLACE_WITH_JOURNAL_SHA256'
systemctl enable --now ghostmanual-backup.timer
systemctl list-timers ghostmanual-backup.timer --all
```

복원 시험에서 restore OK가 나온 뒤 타이머를 켠다. 운영 확인은 journalctl -u ghostmanual-backup.service --since yesterday 및 systemctl --failed로 한다. 호스트 중지로 예약을 놓치면 systemd가 다음 기동 시 한 번 실행한다. 타이머가 활성인 것과 예약 실행 성공은 별도로 확인한다. 매일 성공 여부를 확인하고 실패 시 서비스 종료 상태를 확인한 뒤 재실행한다.

중단은 systemctl disable --now ghostmanual-backup.timer로 한다. 실행 중인 작업 종료 여부는 systemctl status ghostmanual-backup.service로 확인한다. 이미 업로드한 백업에는 버킷의 만료 규칙이 계속 적용된다.

## 백업 실패 알림

백업 서비스가 실패 상태에 들어가면 systemd가 알림 서비스를 한 번 시작한다. 알림은 호스트의 Python 표준 라이브러리로 Gmail SMTP(TLS, 465)에 접속해 승인된 한 주소로 보낸다. 메일 본문에는 UTC 알림 시각과 서버에서 확인할 서비스 이름만 담는다.

root 전용 파일 `/etc/ghostmanual-backup-mail.json`을 소유자 root:root, 모드 0600으로 준비한다. JSON 문자열 필드는 `user`(Gmail 발신 주소), `password`(앱 비밀번호), `recipient`(승인된 수신 주소) 세 개다. 값을 명령 인자·Git·로그에 넣지 않는다. 계정·비밀번호가 바뀌면 이 파일도 갱신한다. systemd는 실행할 때 이 파일을 알림 전용 임시 사용자에게 읽기 자격 증명으로 전달한다.

```sh
install -D -o root -g root -m 0755 deploy/backup/notify.py /usr/local/libexec/ghostmanual-backup-notify.py
install -o root -g root -m 0644 deploy/backup/ghostmanual-backup.service deploy/backup/ghostmanual-backup-notify.service /etc/systemd/system/
systemctl daemon-reload
systemctl show ghostmanual-backup.service -p OnFailure
```

코드 검사는 `python3 -B -m unittest discover -s deploy/backup -p test_notify.py`로 실행한다. 수신자가 시험 발송에 동의했으면 다음 명령으로 운영 백업에 영향을 주지 않고 **시험 메일** 한 통을 전송한다. 종료 코드 0은 SMTP 서버의 접수 여부를 나타내며, 수신함 도착은 수신자가 확인한다.

```sh
systemd-run --wait --collect --service-type=oneshot -p DynamicUser=yes -p UMask=0077 -p TimeoutStartSec=45s \
  -p LoadCredential=mail.json:/etc/ghostmanual-backup-mail.json \
  /usr/bin/python3 -I -B /usr/local/libexec/ghostmanual-backup-notify.py --test
```

알림 서비스 상태는 `journalctl -u ghostmanual-backup-notify.service`로 확인한다. 호스트 정지나 타이머 비활성화로 백업이 시작되지 않으면 실패 이벤트도 발생하지 않는다. 네트워크·Gmail 장애 시 메일이 도달하지 않을 수 있다.

### 실패 알림만 중단하기

백업 타이머는 유지한다. 설치 전에 저장한 원본 backup.service와 현재 단위를 비교하고, 이 알림용 `OnFailure=ghostmanual-backup-notify.service` 연결만 제거한 단위를 복원한 뒤 `systemctl daemon-reload`를 실행한다. 이 설치 후 다른 단위 변경이 있었다면 옛 단위를 통째로 덮어쓰지 않고 알림 연결 행만 제거한다. `systemctl show ghostmanual-backup.service -p OnFailure`가 비었는지와 `systemctl is-active ghostmanual-backup.timer`가 active인지 확인한다. 독립 알림 단위를 disable하는 것만으로 OnFailure 호출을 차단한다고 가정하지 않는다. 자격 증명 파일과 알림 코드의 폐기는 별도 운영 변경으로 처리한다.


## 복구 범위

DB 안의 스키마·데이터·ACL을 담는다. PostgreSQL 클러스터 역할과 비밀번호, 운영 .env, TLS 인증서, 앱 이미지, EC2 볼륨은 별도 관리 대상이다. 복원 시험은 원 소유자 ghostmanual과 권한 수신용 ghostmanual_app 역할을 격리 DB에 먼저 만든다. 실제 장애 복구에서는 동일 버전 PostgreSQL과 역할을 먼저 준비하고 서비스가 비어 있는 새 DB를 향하도록 전환하기 전 권한·앱 동작을 재검증한다. 운영 호스트가 없으면 POSTGRES_IMAGE에 확보된 동일 버전 이미지 digest를 지정해 격리 복원 시험을 할 수 있다. 호스트 journal을 잃으면 버킷 관리자가 해당 객체의 metadata.sha256을 조회해 검증값을 복구할 수 있다.

서비스는 0700 /run 디렉터리에 0600 권한으로 덤프를 만들고 종료 시 지운다. 서버에는 스왑이 있어 tmpfs가 반드시 물리 메모리에만 머무른다고 보장할 수 없다. 이 백업 절차 자체의 저장 시 암호화 적용 지점은 S3다. 운영 루트 EBS도 2026-11-03 별도 전환·새 부팅 검증을 완료했다. [운영 근거](../../docs/qa/2026-11-03/ebs-encryption-cutover.md). 현재 복원 시험용 PGDATA는 tmpfs 192 MiB, 컨테이너 메모리는 256 MiB로 제한한다. 데이터가 커지면 별도 복구 호스트에서 tmpfs와 메모리 상한을 조정한다.

## 저장 대상 비교

| 대상 | 무인 인증 | 30일 보관 | 현재 적용 조건 |
| --- | --- | --- | --- |
| AWS S3 | EC2 역할의 임시 자격 증명 | 버킷 수명 주기 | 기존 AWS에서 같은 리전의 전용 버킷·객체 경로만 허용하면 된다. 선택한 구성이다. |
| Google Drive | 별도 Drive 권한에 사용자 동의·갱신 토큰을 받거나 조직 공유 드라이브에 서비스 계정 쓰기 권한을 부여 | 백업 파일 식별·만료 삭제 작업을 따로 운영 | 앱의 Google 로그인은 openid email profile 범위다. 서비스 계정에는 자체 저장 할당량이 없고 파일을 소유할 수 없어 공유 드라이브 또는 사용자 위임 경로가 필요하다. [Drive 권한](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) · [공유 드라이브](https://developers.google.com/workspace/drive/api/guides/about-shareddrives) |
| Google Cloud Storage | AWS EC2와 Google Workload Identity Federation을 연결하고 전용 버킷의 객체 생성·읽기 권한 부여 | 객체 수명 주기 age=30, Delete | 별도 GCP 프로젝트·결제·버킷·신뢰 설정이 필요하다. 영구 삭제 시점은 soft delete 보관 기간도 함께 결정한다. [AWS 연합 인증](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds) · [객체 수명 주기](https://cloud.google.com/storage/docs/lifecycle) |
