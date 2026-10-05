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

## 최종 이미지 재검증

배포 소스 SHA: `aaa4ad20e1a70026447c856c1667a59bfea06a28`.
앱 이미지 ID: `sha256:8c36fc4b2828095d9b627261b16dcc0d418fb2d3a4c185352f4aa25d9d9bfaf7`.
[CI 실행 37292793962](https://github.com/P-GISE/GhostManual/actions/runs/37292793962)은 부모 작업에서 전체 성공을 확인했다. 이미지 tar SHA256 `9e928748ef4a1ab36d59a5489212e4be46e5dff702f7875c8a1e29cda4f8def6`은 부모 작업에서 로컬·AWS 일치를 확인했다.

부모 작업의 실제 배포 증거: 최종 이미지로 전환 후 HTTP200 → `ba306e0`으로 롤백 후 HTTP200 → 최종 이미지로 다시 전환 후 HTTP200. 기존 3000·3100도 200이었다. 최초 시작 직후 curl 오류56(connection reset)이 있었으며, `--retry-all-errors`를 이용한 준비 상태 재확인 후 정상 응답을 확인했다.

이 보고서 담당자는 현재 실행 이미지 태그·ID를 SSH로 다시 확인하고, 최종 이미지에서 다음 검증을 직접 반복했다.

| 최종 이미지 관찰 | 결과 |
|---|---|
| 합성 예제 생성 → 게시 → 공유 → Reader 게시본 읽기 | 201 → 201 → 201 → 200; 게시 버전 1 |
| Reader 질문 | 200, `unavailable`, 검색 결과 있음; 실제 AI 호출 없음 |
| 공유 취소 → 동일 Reader 접근 | 취소 성공 → 401 |
| 이번 재검증에서 생성한 일회용 공간 삭제 → Owner 접근 | 삭제 성공 → 401 |
| 홈페이지 8개 동시 읽기 요청 | 모두 200, 전체 경과 73ms |
| 앱·DB 컨테이너 | 실행 중, OOM false, 재시작 0, 로그 드라이버 `none` |
| 네트워크 | 앱 `127.0.0.1:3200`만 바인딩, DB 호스트 포트 없음 |
| 검증 후 메모리 | 앱 63.82MiB/384MiB, DB 30.56MiB/128MiB; 호스트 가용 690MB |
| 기존 서비스 | 검증 전·후 3000·3100 모두 HTTP200 |
| 만료 정리 | timer `enabled`·`active`, service `Result=success`, `ExecMainStatus=0`; 이미지 변경 후 상태 확인 |

이 재검증도 토큰·세션·업무 ID를 출력하거나 파일에 저장하지 않았으며 이번에 만든 일회용 공간만 삭제했다. 환경 설정·DNS·기존 서비스는 변경하지 않았다. 이 증거는 최종 이미지의 비공개 HTTP/API 경로에 한정한다. 공개 HTTPS 전체 브라우저 흐름, 실제 AI 품질·비용, 지속 부하 용량은 별도 검증 대상이다.

## 인증된 DB 읽기 동시성 확인

같은 최종 이미지 `aaa4ad20e1a70026447c856c1667a59bfea06a28`에서 새로운 일회용 합성 예제 공간 하나를 생성하고, 해당 Owner 쿠키로 `GET /api/manuals` 8개를 동시에 요청했다. 각 응답 HTTP200 및 비어 있지 않은 배열을 `assert`로 확인했으며, 전체 배치 경과 시간은 **343ms**였다. 홈페이지 정적 요청과 구분되는 실제 인증·PostgreSQL 조회 경로다. 쿠키는 메모리에서만 사용했고 AI 호출은 수행하지 않았다.

배치 후 이번에 생성한 공간만 삭제하고 동일 Owner 세션의 HTTP401을 확인했다. 이후 앱 64.96MiB/384MiB, DB 45.1MiB/128MiB, 호스트 가용 메모리 720MB였다. 두 컨테이너는 실행 중, OOM false, 재시작 0이었고 기존 서비스 3000·3100은 모두 HTTP200이었다.

이 결과는 한 공간에 대한 8개의 짧은 동시 읽기 확인이며 지속 부하, 여러 사용자 규모, AI 생성 부하의 서버 용량을 보장하지 않는다.
