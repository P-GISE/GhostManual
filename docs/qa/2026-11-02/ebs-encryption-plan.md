# 공유 EC2 루트 볼륨 암호화 교체 계획

**상태는 실행 승인 대기다.** 2026-11-02 시드니 콘솔에서 인스턴스 `i-0b4a251ecd2f5bd3e`의 루트 장치 `/dev/sda1`에 연결된 `vol-02e91bd89ed39c404`가 gp3 30 GiB, 미암호화로 확인됐다. 실행 당일 이 매핑을 다시 대조한다. 이 문서 작성 중 인스턴스 중지, 스냅샷 생성, 볼륨 교체는 실행하지 않았다. [운영 확인 기록](../../운영_DB권한_외부백업_2026-11-02.md)

## 중단 전 확인과 승인

- 박기성은 공유 호스트의 인프라 담당자와 GhostManual, LostArk Party, EventOps, Chiikawa 등 실제 가동 중인 모든 서비스 담당자를 확인한다. Docker 앱·DB·worker, 볼륨과 바인드 마운트, systemd 서비스·타이머·배포 잠금, 터널, VPN/SSM, DNS와 공개 엔드포인트의 정상 기준을 기록한다. 인스턴스 스토어, 자동 할당 공개 IPv4 의존성, Auto Scaling 자동 교체, 중지 보호가 있으면 대응책부터 정한다. [EC2 중지·시작 시 영향](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html)
- 각 서비스의 최신 DB·파일 백업과 복원 결과를 확보한다. GhostManual은 S3에서 최근 덤프를 다시 내려받아 SHA-256과 격리 PG18 복원을 확인한다. 서버 밖의 접근 통제된 복구 위치에서 Compose·환경 파일·DB 역할·배포 상태·터널 자격 증명의 복구 가능성을 별도로 확인한다. DB 덤프에는 이 설정이 없다. 비밀 값과 업무 데이터는 작업 기록에 복사하지 않는다. [백업·복원 절차](../../../deploy/backup/README.md)
- AWS 실행 담당자는 호스트 외부에서 로그인·복구할 수 있어야 한다. 시드니에서 인스턴스·볼륨·스냅샷 조회, 스냅샷 생성·복사 및 태그, 볼륨 생성·연결·분리, 인스턴스 중지·시작과 블록 장치 속성 변경 권한을 확인한다. 사용할 시드니 KMS 키와 키 정책에서 DescribeKey, CreateGrant, Decrypt, GenerateDataKeyWithoutPlaintext, ReEncrypt 및 인스턴스 사용 허용을 확인한다. 앱·백업용 인스턴스 역할에 운영자 권한을 추가하지 않는다. [EBS 암호화 권한](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption-requirements.html)
- **승인 요청 항목**은 중단 시작 시각·최대 중단 시간·롤백 결정 시각(KST), 서비스별 검증 담당, 대상 키, 중복 스토리지 비용 한도, 원본 보존 재검토일이다. 시간은 미확정이다. 정지부터 스냅샷 완료·복사·볼륨 준비·재기동·검증까지 쓰기를 막는 시간을 확보한다. 원본과 새 gp3, 스냅샷 및 암호화 복사본에 비용이 발생할 수 있으므로 승인 후 생성한다. [EBS 요금](https://aws.amazon.com/ebs/pricing/)

## 승인된 작업 창에서만 수행할 절차

1. AWS 콘솔 EC2 → 인스턴스 → 스토리지에서 실제 AZ, 루트 장치 이름, 볼륨 ID·유형·크기·IOPS·처리량·태그·종료 시 삭제 속성, 추가 디스크 매핑을 저장한다. 서비스 쓰기와 자동 배포·worker·배치의 부팅 시 자동 재개까지 통제한다. 진행 중인 요청을 비우고 DB를 정상 종료한다. 기존 트래픽·작업 중단을 확인한 뒤 EC2를 정상 중지하고 `stopped`를 기다린다. [AWS 루트 스냅샷 권고](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html)
2. 중지된 원본에서 비공개 스냅샷을 만들고 `completed`를 확인한다. 시드니에서 지정한 키로 암호화 복사하고 복사본의 `completed`, `Encrypted=true`, 키 ID를 확인한다. 복사본에서 **기존 인스턴스와 같은 AZ**에 새 gp3 30 GiB를 만들고 기존 IOPS·처리량을 맞춘다. 새 볼륨의 `available`, 암호화, 키와 원본 스냅샷 ID를 확인한다. 실패하면 기존 루트 매핑을 보존한 채 복구 시각에 맞춰 기존 인스턴스를 다시 시작한다. [암호화 절차](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html) · [볼륨 생성 조건](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-volume.html)
3. 인스턴스가 계속 `stopped`인지 확인하고 기존 루트만 정상 분리한다. 원본이 `available`이 되면 롤백용 보존 태그를 부여하고 자동 삭제 작업에서 제외한다. 새 볼륨은 EC2에서 확인한 동일한 루트 장치 이름으로 연결한다. OS가 표시하는 NVMe 장치 이름은 이 값의 대체물이 아니다. 새 루트 매핑과 종료 시 삭제 정책을 확인하고 검증 기간에는 `DeleteOnTermination=false`로 보존한다. 강제 분리와 인스턴스 종료는 사용하지 않는다. [루트 분리 조건](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-detaching-volume.html) · [종료 시 보존 설정](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configure-root-volume-delete-on-termination.html)
4. 인스턴스를 시작하고 AWS 상태 검사, 루트 파일시스템·추가 마운트, VPN/SSM·터널을 확인한다. EC2에서 같은 인스턴스의 루트에 **새 볼륨 ID·Encrypted=true·승인 키 ID**가 표시되는지 확인한다. 일반 사용자·worker의 쓰기 차단을 유지하고 운영자의 합성 검증만 허용한 채 서비스별 컨테이너·worker·DB 상태와 변경 전 공개 경로(기존 3000·3100·3200 포함)를 대조한다. 세 포트의 HTTP 응답에 더해 서비스 담당자가 각 핵심 경로를 확인한다.
5. GhostManual은 합성 계정 로그인·자료 CRUD·매뉴얼 게시·공유/회수·계정 삭제와 잔여물 정리를 검증한다. 앱 DB 사용자가 `ghostmanual_app`이고 관리자 역할 전환과 public DDL이 거부되는지 확인한다. 관리자 환경 파일의 root 소유·0600, 백업·배포 타이머의 이전 상태, S3 신규 백업과 격리 복원까지 확인한다. 결과를 ID·시각·상태만 기록하고 서비스 담당자 확인 후 사용자 쓰기와 배치를 재개한다.

## 롤백과 보존

부팅·마운트·암호화·핵심 서비스 검증 실패 또는 합의한 결정 시각 도달 시 인프라 담당자가 롤백한다. 신규 쓰기가 차단되어 있다면 인스턴스를 정상 중지하고 새 루트를 정상 분리한 뒤 원본 `vol-02e91bd89ed39c404`를 원래 장치 이름으로 재연결한다. 매핑과 보존 속성 확인 후 재기동하고 동일한 서비스 검증을 수행한다. 이미 사용자 또는 worker의 쓰기가 재개됐다면 다시 차단하고 신규 볼륨의 쓰기 차이와 각 DB를 보존한다. 서비스별 재반영 방안 합의 전 원본으로 전환하면 변경분이 유실된다.

원본 미암호화 볼륨·스냅샷은 접근을 제한하고 보존 만료를 담당자가 재검토한다. 암호화된 새 루트, 전체 서비스와 외부 복원 증거를 확인한 후 별도 삭제 승인을 받는다. 이 절차에는 자동 삭제 작업이 없다.
