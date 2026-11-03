# 백업 실패 알림 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백업 서비스 실패를 사용자 지정 수신자에게 일반 점검 안내 메일로 알린다.

**Architecture:** 사용자가 선택한 기존 Gmail SMTP를 호스트 Python 표준 라이브러리로 이용한다. 앱이나 DB에 의존하지 않는 별도 systemd oneshot을 기존 backup.service의 OnFailure에 연결한다. 수신자와 SMTP 자격 증명은 root0600 JSON으로만 보관하고 DynamicUser 서비스에는 LoadCredential로 전달한다. 정기 성공 메일·새 AWS 자원·자동 계정 삭제는 추가하지 않는다.

**Tech Stack:** Python 3 표준 라이브러리 SMTP_SSL/EmailMessage, systemd255, 기존 Gmail SMTP465 implicitTLS.

**Spec:** 사용자의 백업 실패 알림 방식/수신처 답변, 기존 src/lib/mailer.ts 및 deploy/backup/ghostmanual-backup.service. 실제 주소·비밀번호는 Git에 기록하지 않는다.

## Global Constraints

- 실패시에만 고정 점검 안내와 시각을 보낸다. SQL·업무 자료·오류 로그 본문·자격 증명을 메일/운영 로그에 넣지 않는다.
- 실제 백업을 고의로 실패시키지 않는다. 테스트 메일은 실패 통보와 구분되는 제목/본문으로 별도 승인 후1회 검증한다.
- 원본 .env/Compose·앱/DB·백업 명령·예약 시각·AWS 역할을 바꾸지 않는다.
- SMTP/네트워크 장애·호스트 정지·타이머 미실행을 이 호스트의 메일러가 독립 감지한다고 주장하지 않는다.

## Review Focus

- 제목/주소의 개행 삽입과 빈 자격 증명은 SMTP 접속 전에 거부한다.
- TLS 검증/접속 제한시간을 유지하고 오류는 일반 문구+비정상 종료만 기록한다.
- Gmail 수신자 거절과 인증 실패도 성공으로 처리하지 않는다.
- DynamicUser의 credential 전달과 root 원본0600을 실제 unit 문법·실행으로 확인한다.
- 정상 백업 성공과 알림 검증을 구분하고 업무서비스를 재시작하지 않는다.

## Task 1: 실패 알림 코드와 가짜 전송 회귀

- [x] notify.py, test_notify.py: 가짜 SMTP로 성공·인증 실패·수신 거절·누락/주입 입력·일반 오류·시험 제목 RED/GREEN.
- [x] 기존 backup.service OnFailure 한 줄, notify.service DynamicUser/LoadCredential/타임아웃, README 설정/중단/한계 추가.
- [x] 단위 검사·systemd-analyze verify·diff/포맷 검사 및 독립 검토.

## Task 2: 운영 연결과 기록

- [x] 첫 예약 백업11/3 03:20:03KST 실제S3재다운로드/SHA256/AES256/격리PG18전체복원PASS.
- [x] 기존 SMTP 주입값을 출력하지 않고 root 전용 별도 설정 생성, 검토된 파일만 설치·daemon-reload. 기존서비스 상태/원본파일/예약 보존 확인.
- [x] 별도 시험 발송 승인 후 --test1회 DynamicUser/LoadCredential 실실행, Gmail접수 exit0. 사용자 수신함 도착 미확인으로 별도 추적.
- [ ] 작업목록/보고서 현행화 및 PR. 정책 제안 병합과 실제 계정/복구본 삭제는 구분한다.

공식 자격 증명 전달 근거: [systemd.exec LoadCredential](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#LoadCredential=ID:PATH).
