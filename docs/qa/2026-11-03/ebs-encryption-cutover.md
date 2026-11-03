# 공유 호스트 EBS 암호화 전환 완료 — 2026-11-03

사용자의 시간·비용 판단 위임과 재부팅 전 문제 해결·암호화 전환 지시에 따라 인프라 채팅과 조율해 원격에서 실행했다. 로컬 PC 저장소·Docker·설정은 수정하지 않았다. 앱 재배포·DB migration·IAM 권한 확대·볼륨 용량 확대·이미지/백업/업무 데이터 삭제는 하지 않았다.

## 실제 상태

| 항목 | 확인 결과 |
| --- | --- |
| EC2 | `i-0b4a251ecd2f5bd3e`, ap-southeast-2a, running |
| 운영 루트 | `vol-0a011c1401d09c6b3` → `/dev/sda1`, gp3 30 GiB, 3,000 IOPS·125 MiB/s |
| 암호화 | AWS 콘솔 Encrypted=true, AWS 관리 `aws/ebs`; 시스템·인스턴스·EBS 상태 검사 모두 통과 |
| 종료 시 삭제 | 새 루트 DeleteOnTermination=false |
| 실제 부팅 | 호스트 NVMe serial이 새 볼륨 ID와 일치, 부팅 ID 변경 확인 |
| 원본 | `vol-02e91bd89ed39c404`, 분리 후 available로 보존. 미암호화 원본이며 삭제하지 않았다. |
| 최종 스냅샷 | `snap-030d7e69deb2728a7`, 정상 종료된 원본에서 생성, completed·Private 확인 |
| 사전 측정 스냅샷 | `snap-03bf4570b8d42da60`, completed. 시간 측정용이며 최종 전환 원본으로 사용하지 않았다. |
| 앱 이미지 | `sha256:03a21bed081faa5d11c88ca8747ac11c64a8a80b93b33dd39c8c6962f1662024`; 전환 전후 기존 앱·DB·worker 컨테이너 ID와 이미지 전부 동일 |

기록된 준비 시작 11:15:29 KST부터 공개 확인 11:38:33 KST까지 23분 3초였다. 이 값은 준비를 포함한 점검 구간이며, 서비스별 HTTP 실패 시작·재개를 초 단위로 연속 측정한 실제 중단 길이는 아니다. 정지 최종 스냅샷 생성 요청은 11:18:19 KST였고 새 볼륨 생성 시각은 AWS 콘솔 11:20:56 KST였다. 최대 60분 작업 창 안에서 재개했다.

## 부팅 전 수정과 검증

- ZRAM: `ghostmanual-zram.service`와 최소 Python 진입점을 설치했다. 현재 활성 swap을 보존하는 모의 검사 4개와 실제 무변경 실행을 통과했다. 새 부팅에서 512 MiB·lzo-rle·우선순위 100으로 실제 생성됐고 서비스 success/0을 확인했다.
- LostArk: 실제 Tailscale 주소 준비 → 기존 PG healthy → 기존 앱 3개만 복구하는 `lostark-restore.service`를 추가했다. 기존 배포와 같은 두 잠금을 같은 순서·상한으로 획득한다. 모의·실제 잠금 경합 검사 9개와 실제 무변경 실행을 확인했다. 전환 중에는 hold로 건너뛰었고, 재개 후 실제 진입점 success와 컨테이너 불변을 확인했다. 지연 장애를 주입한 무인 재부팅 드릴을 한 것은 아니다.
- Chiikawa: Compose의 tunnel은 실제 eventops_default를 가리켜 네트워크 차이 가설을 철회했다. 다른 채팅의 승인된 10:48 KST 배포인 `/opt/chiikawa/releases/20261103-bounce`를 최신 기준으로 보존했다. 실패한 Compose가 남긴 `acb57dc7cefe_chiikawa-web`은 created 상태로 보존하며 restart=no로 격리했다. 기존 정지 롤백 컨테이너 3개는 기동·삭제하지 않았다.
- 커널: EBS 변경과 커널 변경을 섞지 않도록 기존 7.0.0-1009-aws를 일회 부팅으로 지정했다. 새 부팅의 실행 커널과 빈 next_entry를 확인했다. 기본 설정은 바꾸지 않았으므로 다음 일반 부팅 후보 1014의 실제 기동 검증은 별도다.

## 쓰기 차단과 재개

실제 기존 배포 잠금 5개를 모두 획득한 뒤 컨테이너·이미지·restart policy·설정 SHA-256 4개·유닛 상태를 root 전용 기록에 보존했다. SSM·호스트 터널·poll/backup/cleanup 타이머를 일시 억제했고 기존 SSM cgroup·하위 작업과 실행 중 배포·예약 작업이 없음을 확인했다. 유닛 inactive만으로 안전 판정하지 않았다. 작업 중 사용할 hold를 최종 스냅샷에 포함했다.

실행 중 10개만 restart=no로 바꾸고 프록시·worker·앱·DB를 강제 종료 없이 정상 중지했다. DB 3개 종료 코드 0·OOM 없음·running 0과 sync를 확인한 후 EC2를 정상 중지했다. 원본을 정상 분리하고 최종 스냅샷에서 만든 동일 사양의 암호화 루트만 연결해 시작했다.

새 루트의 파일·ID·부팅 보호를 먼저 확인하고 DB → 웹 → worker/외부 접속 단계로 재개했다. 외부 7개 호스트 GET 200, pc 호스트의 LostArk 리다이렉트 302, 내부 4포트 200과 GhostManual 비로그인 /api/me 401을 확인했다. PG 2개 SELECT 1, MariaDB 연결·InnoDB 준비, 앱 역할의 관리자 권한·관리자 역할 소속·public CREATE 부재와 migration 환경 파일 root 0600을 확인했다. 마지막으로 원래 restart policy·유닛 상태를 복구하고 자신이 만든 hold만 제거한 뒤 SSM을 마지막에 재개했다.

재개 후 실행 컨테이너 10개 모두 restart 0·OOM false, DB 3개 healthy를 재확인했다. **앱/worker와 사용자 쓰기는 이미 재개됐다. 지금 원본 볼륨으로 단순 복귀하면 이후 변경이 유실되므로 먼저 새 쓰기와 DB를 보존하고 재반영 방안을 정해야 한다.** 원본 보존을 무조건 즉시 롤백 가능하다는 뜻으로 해석하지 않는다.

## 새 백업과 복원

암호화 루트에서 운영 백업을 한 번 실행해 success/0을 확인했다. 객체 `postgres/20261103T023921Z-47b4b2a5-4c97-4e80-895e-086f756aed74.dump`, 81,405 bytes, SHA-256 `446774c062903d930b1c44214cf872ccb220c5d29ce44cd93d7fc8519f0e099b`다. S3에서 다시 내려받아 AES256·해시를 확인하고 네트워크·포트·운영 볼륨이 없는 격리 PG18에서 전체 트랜잭션 복원과 필수 테이블 5개를 확인했다. 임시 컨테이너와 /run 자료는 시험 종료 시 정리했다. 사용자 자료·SQL 회신 본문·비밀 값은 기록하지 않았다. 다음 예약 백업은 11월 4일 03:20 KST다.

## 비용·보존·검증 한계

[AWS EBS 요금](https://aws.amazon.com/ko/ebs/pricing/)의 시드니 공개 단가 gp3 USD 0.096/GiB-month, 표준 스냅샷 USD 0.055/GiB-month 기준이다. 원본 30 GiB와 사전/최종 스냅샷 각 최대 30 GiB를 추가 보존한다고 보수적으로 계산하면 월 추가 약 USD 6.18(세금 등 별도)다. 스냅샷은 실제 저장량에 따라 적을 수 있다. 11월 10일 보존 재검토 태그는 자동 삭제 설정이 아니다. **원본과 두 스냅샷은 미암호화 복구본이므로 비공개·접근 제한 상태를 유지한다. 삭제는 별도 승인 전 실행하지 않는다.** 공간 정리·용량 확대는 사용자 요청대로 계속 보류한다. 현재 여유 1,567,539,200 bytes로 2 GiB 배포 가드를 낮추거나 무시하지 않았다.

이번 검증은 운영 디스크·기동·연결·백업과 기본 HTTP 동작이다. 실제 사용자 업무·AI 호출·장시간 부하·장애 주입을 재시험한 것은 아니다. 새 부팅에서 LostArk 유닛은 쓰기 차단을 위해 hold로 건너뛰었으므로, 일반 무인 재부팅 전체의 성공을 주장하지 않는다.

운영 상세 메타·전환/복구 진입점은 root 전용 `/var/lib/ghostmanual-deploy/ebs-encryption-20261103/`에 보존했다. 서버 중지 이후의 작업은 AWS 콘솔 Aside 직접 조작과 호스트의 읽기/단계별 복구를 구분해 검증했다.

[사전 계획과 측정](../2026-11-02/ebs-encryption-plan.md) · [부팅 준비](ebs-preboot-readiness.md) · [ZRAM 코드·설치](../../../deploy/host-boot/README.md) · [LostArk 복구](../../../deploy/host-boot/LOSTARK.md)
