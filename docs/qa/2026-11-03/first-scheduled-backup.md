# 첫 예약 백업 검증 — 2026-11-03 KST

systemd LastTriggerUSec=2026-11-02 18:20:03 UTC(11/3 03:20:03 KST), backup.timer active, service Result=success/ExecMainStatus=0 및 성공 로그를 확인했다.

객체 postgres/20261102T182003Z-9f65515e-b9ba-480d-ba03-719e5b34a148.dump / 81,405bytes / SHA256 0ba4cb5de26ce5d9cc02a208258c9603fda22703ebae0b79faf6e8a2460df999.

기존 restore-drill.sh로 실제S3에서 다시 다운로드하여 AES256 속성과 SHA256을 확인했다. 네트워크·운영 볼륨이 없는 임시 PG18에서 전체 트랜잭션 복원 및 중요 테이블5개 확인 PASS. 스크립트 exit0, 임시컨테이너/다운로드 디렉터리 정리. 운영 DB/환경/앱 재시작 없음. 다음 예약은 11/4 03:20 KST다.

운영 역할/복구 설정·업무 본문·계정 식별자·비밀 값은 이 기록에 포함하지 않는다. 이 예약 백업 검증 후 사용자가 실패 알림 수신처를 지정했다. 알림 설치·시험 발송 결과는 별도 기록한다.
