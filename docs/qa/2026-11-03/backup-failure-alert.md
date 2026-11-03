# 백업 실패 알림 운영 연결 — 2026-11-03 KST

사용자가 기존 Gmail SMTP 방식과 수신처를 지정했다. 실제 수신 주소·SMTP 계정·앱 비밀번호는 Git/문서/로그에 기록하지 않는다.

- notify.py/Python 표준 라이브러리 SMTP_SSL+인증서 검증+15초 timeout, 일반 실패 안내만 전송한다. 수신 거절·인증 오류·구성 오류는 비정상 종료하고 고정 오류 문구만 기록한다.
- root:root0600 /etc/ghostmanual-backup-mail.json의 별도 설정을 LoadCredential로 알림용 DynamicUser에 전달한다. 앱·DB에 알림 실행을 의존하지 않는다.
- 기존 백업 단위 변경은 OnFailure=ghostmanual-backup-notify.service 한 줄뿐이며, daemon-reload로 반영했다. 백업 타이머·주기·명령과 원본 .env/Compose·DB 접속 설정은 그대로다.
- 단위 설치 전후 모든 컨테이너의 ID/이미지/시작/재시작/OOM 및 원본 설정 해시가 동일했고 백업 timer active를 확인했다. 운영 백업을 고의로 실패시키지 않았다.
- 모의 SMTP7건, 기존 백업·복원 회귀6건, systemd 단위 검증, 독립 보안/코드 검토 APPROVE.
- 사용자 별도 승인 후 --test transient DynamicUser unit을 1회 실행했다. 실제 credential 전달·TLS 접속·Gmail 인증·SMTP 접수까지 exit0/result success를 확인했다. 제목은 시험 메일로 구분하며 실제 백업 실패라고 통보하지 않았다.
- 사용자에게는 수신함에서 아직 확인되지 않았다는 답변을 받았다. 수신 주소 일치/검토된 설치 코드 일치/전송 unit 성공을 다시 검사했고 추가 발송은 하지 않았다. 전체 메일함/스팸 검색 결과를 기다리며 수신 완료로 표시하지 않는다.

호스트 정지·타이머 비활성화는 OnFailure 이벤트를 만들지 않을 수 있고 Gmail/네트워크 장애도 감지 수단을 함께 막을 수 있다. 이 알림은 호스트 밖의 생존 감시를 대체하지 않는다. [설치·중단·시험 절차](../../../deploy/backup/README.md#백업-실패-알림).
