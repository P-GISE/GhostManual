# AWS 비공개 런타임 검증

검증일: 2026-10-05 (한국 시간). 공개 DNS·HTTPS 검증과 구분한다.

## 검증 대상

- 배포 소스 SHA: `ba306e0a5f34bf5f807fd59b46b9a05e8c660555`
- 앱 이미지 ID: `sha256:f26420f7c09513099c6d42cfed8bb4491dbc281da4067270bba7dfbaf0a80ba6`
- AWS 전용 Compose 프로젝트 `/opt/ghostmanual`, 앱·DB 로그 드라이버 `none`.
- 앱은 `127.0.0.1:3200`에만 바인딩. DB 5432는 호스트에 공개되지 않음.

## 관찰 결과

| 실제 실행 확인 | 결과 |
|---|---|
| 앱 홈페이지 HTTP | 200 |
| 기존 서비스 3000·3100 | 검증 전·후 모두 200 |
| 합성 예제 공간 생성 → 매뉴얼 목록 조회 | 201 → 200 |
| 검수 게시 → 공유 생성 → Reader 교환·게시본 읽기 | 201 → 201 → 200 → 200, 게시 버전 1 |
| Reader 질문 | 200, `unavailable`, 검색 자료 있음; 실제 AI 답변 없음 |
| 공유 취소 → 동일 Reader 접근 | 취소 성공 → 401 |
| 이번 검증에서 생성한 일회용 공간 삭제 → Owner 세션 확인 | 삭제 성공 → 401 |
| 홈페이지 8개 동시 요청 | 모두 200, 전체 경과 209ms |
| 앱·DB 상태 | 실행 중, OOM false, 재시작 0 |
| 검증 후 메모리 | 앱 74.84MiB/384MiB, DB 47.73MiB/128MiB, 호스트 가용 725MB |
| 만료 정리 타이머 | 최초 점검 시 미등록. 이후 부모 작업에서 설치·활성화, 첫 실행 `Result=success`, `ExecMainStatus=0` 확인 |

검증은 SSH를 통해 실행한 Node `fetch`와 `assert`, `docker inspect`의 지정 필드, `docker stats`, `curl`, `systemctl`로 수행했다. 세션·공유 토큰은 프로세스 메모리에서만 사용했고 출력·파일에 저장하지 않았다. 이 검증에서 직접 생성한 공간만 삭제했다. 기존 서비스와 설정은 변경하지 않았다.

## 한계와 남은 조건

8개 홈페이지 요청은 작은 동시성 확인이며 지속 부하·AI 생성 부하의 용량 보장이 아니다. 공개 DNS·HTTPS, 공개 브라우저의 전체 흐름, 실제 AI 품질·비용, 운영자 안내는 이 검증 범위 밖이다. 만료 정리 타이머는 최초 점검 후 부모 작업에서 설치·활성화하고 첫 실행을 확인했다. 이 보고서 작성 작업은 직접 설치하지 않았다. 이후 배포 이미지가 변경되면 해당 이미지에 대한 검증을 다시 기록해야 한다.

## 만료 정리 등록 검토

`systemd-analyze verify`는 서버의 두 unit 파일을 오류 없이 검증했다. `/usr/bin/docker`가 존재하고 현재 앱 이미지에 `scripts/cleanup.ts`가 있다. 스크립트는 만료 데이터 정리 후 DB pool을 닫는다. service의 작업 디렉터리·명시적 `.env`·기본 Compose 및 `none` 로그 overlay·컨테이너 실행 명령은 현재 배포 배치와 일치한다. `.env` 권한은 600이다. 서비스 표준 출력·오류는 `null`, 타이머는 매일 03:30 및 최대 10분 지연이며 `Persistent=true`다. 시간은 서버 systemd 시간대를 따른다.

다음은 검토한 설치 명령이다. 이 보고서 작성 작업은 실행하지 않았으며, 이후 부모 작업에서 프로젝트 전용 unit 설치·활성화·첫 실행을 수행했다고 실행 증거를 전달했다.

```sh
sudo install -m 644 /opt/ghostmanual/ghostmanual-cleanup.service /etc/systemd/system/ghostmanual-cleanup.service
sudo install -m 644 /opt/ghostmanual/ghostmanual-cleanup.timer /etc/systemd/system/ghostmanual-cleanup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ghostmanual-cleanup.timer
sudo systemctl start ghostmanual-cleanup.service
systemctl show ghostmanual-cleanup.service -p Result -p ExecMainStatus
systemctl list-timers ghostmanual-cleanup.timer --all
```

부모 작업의 SSH 실행 확인: `Result=success`, `ExecMainStatus=0`, 타이머 활성화 및 다음 예약 `2026-10-06 03:37:18 UTC`. 만료된 프로젝트 데이터만 대상으로 하는 수동 첫 실행을 완료했다. 배포된 `ba306e0` 검증은 이후 모바일 CSS 변경이 포함된 이미지의 증거를 대신하지 않는다.
