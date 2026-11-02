# GhostManual 배포

Task8 배포 구성이다. 실제 컨테이너 실행·AWS 부하·공개 HTTPS 검증은 별도 실행 결과로 기록한다. 로컬 Docker 엔진이 고장난 상태에서 Compose 문법 검사와 이미지 manifest 조회만 성공한 결과를 배포 성공으로 해석하지 않는다.

## 이미지와 사전 조건

Node 24.20.0 bookworm-slim 및 PostgreSQL 18.4 bookworm의 Docker Official Images registry manifest digest를 2026-10-04 `docker buildx imagetools inspect`로 확인해 고정했다. 앱은 Next standalone이며 migration·cleanup용 Node TypeScript 소스 및 production 의존성을 포함한다. 빌드에 비밀 값을 전달하지 않는다.

로컬/CI에서 `npm ci`, lint, typecheck, unit, 실제 PostgreSQL integration, build, Playwright E2E를 완료하고 `docker build -t ghostmanual:<commit> .`로 빌드한다. `docker save`/`docker load` 또는 승인된 private registry를 통해 검증 이미지를 전달한다. 서버에서는 Next 빌드를 수행하지 않는다. 배포 이미지의 immutable digest 또는 보관한 image ID와 이전 image ID를 기록한다.

배포 전 `free -m`, `df -h`, `docker stats --no-stream`, `docker ps`, `ss -ltn`으로 기존 서비스와 3200 포트를 다시 확인한다. 기존 3000·3100 서비스 URL도 사전/사후 확인한다. 관찰된 가용 805MB는 보장값이 아니다. 앱 384MB/CPU0.75, DB128MB/CPU0.5는 초기 후보 한도이며 실제 동시 요청·AI timeout·cleanup 시점의 메모리/OOM·응답시간을 측정해야 한다. 충분한 기존 서비스 여유를 확인하기 전 공개하지 않는다.

## 전용 디렉터리와 설정

전용 `/opt/ghostmanual`에 compose.yaml과 로컬 root 전용 `.env`를 둔다. `.env` 권한은 0600이며 Git·빌드 context에 포함하지 않는다. `GHOSTMANUAL_IMAGE`, 관리자용 `POSTGRES_PASSWORD`, 별도로 생성한 앱용 `APP_DATABASE_PASSWORD`, `APP_ORIGIN`, `IP_HASH_SECRET`를 설정한다. 비밀번호는 URL 안전한 무작위 hex 등으로 생성한다. `AI_ENABLED=false`가 기본이며 키 없이도 자료 저장/수정/검수가 가능하다. 실제 AI 활성화에는 계정·키·금액 예산과 live 평가가 필요하다. production은 fixture를 제공하지 않는다.

Compose project `ghostmanual`은 자체 DB와 `ghostmanual_database` 볼륨을 사용한다. DB host 포트는 없다. 앱만 `127.0.0.1:3200`에 바인딩한다. 다른 Compose project/볼륨/DB를 재사용하지 않는다. PostgreSQL18 볼륨 경로는 `/var/lib/postgresql`이다. migration이 pg_trgm extension을 생성한다.

서버 root 셸에서 `/opt/ghostmanual`을 사용한다. 관리자 연결은 root:root 0600 `/etc/ghostmanual-migration.env`에 `DATABASE_URL=postgresql://ghostmanual:<관리자 비밀번호>@db:5432/ghostmanual` 형식으로 별도 보관한다. Docker `--env-file`은 따옴표를 제거하지 않으므로 값에 따옴표를 붙이지 않는다. 비밀번호는 URL 안전 문자로 생성하고 원문을 명령 인자·로그에 넣지 않는다. Compose가 만드는 앱에는 관리자 환경 파일을 전달하지 않는다.

최초 구축 시에는 검증 이미지 이름을 현재 root 셸의 `GHOSTMANUAL_IMAGE`에도 지정하고 아래 순서로 수행한다. 운영에 이미 역할이 있으면 일회성 SQL/비밀번호 설정을 반복하지 않는다. `database-runtime-role.sql`은 이 저장소의 `deploy/`에서 서버 전용 디렉터리로 복사한다. 스키마 migration 후 제한 역할을 만들고, 숨김 프롬프트에서 `.env`의 앱 비밀번호와 같은 값을 설정한다:

```sh
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --wait db
docker run --rm --network ghostmanual_default \
  --env-file /etc/ghostmanual-migration.env \
  "${GHOSTMANUAL_IMAGE:?Set the verified image in this root shell}" node scripts/migrate.ts
docker exec -i ghostmanual-db-1 psql -X -v ON_ERROR_STOP=1 \
  -U ghostmanual -d ghostmanual < database-runtime-role.sql
docker exec -it ghostmanual-db-1 psql -X -U ghostmanual -d ghostmanual \
  -c '\password ghostmanual_app'
docker compose --env-file .env up -d app
curl --fail --silent http://127.0.0.1:3200/ > /dev/null
docker compose --env-file .env exec -T app node scripts/cleanup.ts
```

기존 구축의 후속 migration은 새로 배포할 검증 이미지와 관리자 전용 환경을 사용한다. 현재 root 셸의 `GHOSTMANUAL_IMAGE`를 새 릴리스의 검증된 immutable 이미지로 지정한다. 앱의 `DATABASE_URL`은 DDL 권한이 없어 migration에 사용하지 않는다.

```sh
docker run --rm --network ghostmanual_default \
  --env-file /etc/ghostmanual-migration.env \
  "${GHOSTMANUAL_IMAGE:?Set the verified target release image in this root shell}" node scripts/migrate.ts
```

`.env` 설정을 포함하는 `docker compose config` 전체 출력을 로그에 저장하지 않는다. cleanup은 본문을 로그로 출력하지 않고 삭제 건수만 출력한다. `db:seed`는 production에서 실행하지 않는다.

## 정리·로그·개인정보

동봉한 service/timer는 `/opt/ghostmanual`에서 하루 한 번 별도 app container로 만료 데이터를 삭제한다. 두 파일을 `/etc/systemd/system/`에 설치하고 `systemctl daemon-reload`, `systemctl enable --now ghostmanual-cleanup.timer`, `systemctl start ghostmanual-cleanup.service`를 실행한다. `systemctl status ghostmanual-cleanup.timer`와 service 종료 결과를 확인한다. cleanup 중 transient 자원도 부하 측정에 포함한다. 접근 만료 즉시 거부와 물리 삭제 시점은 다르다.

Compose 로그는 journald로 전달한다. 원문·질문·답변·세션 token·IP·비밀 설정을 application/프록시 로그에 쓰지 않는다. DB statement 및 parameter 로그는 억제했다. 기존 호스트 journal 설정이 최대 7일 보관을 실제로 보장하는지 먼저 확인한다. journald 보관은 호스트 전체에 적용되므로 이 프로젝트 때문에 전역 retention 변경·vacuum을 실행하지 않는다. 기존 정책이 맞지 않으면 GhostManual 서비스의 logging driver를 `none`으로 설정해 보관을 중단하거나, 승인된 전용 7일 보관 log sink를 준비한 후 공개한다. cleanup systemd unit의 건수 로그도 같은 정책으로 처리한다.

초기 데모의 백업 미생성 정책은 2026-11-02 사용자 승인으로 갱신했다. 현재 운영 DB는 전용 비공개 S3에 매일 암호화 백업하고 30일 보관한다. [백업/복구 절차](backup/README.md)와 [실제 운영 검증](../docs/운영_DB권한_외부백업_2026-11-02.md)을 따른다. 영구 볼륨은 현재 데이터 저장용이다. Cloudflare에서 인증 API와 사용자 문서에 Cache Everything·공유 cache rule을 적용하지 않는다. 앱 no-store/no-referrer/CSP 헤더가 외부 HTTPS에서도 유지되는지 확인한다. Next bootstrap을 위한 inline script/style 허용은 현재 CSP에 명시되어 있다.

## 공개 검증과 롤백

Cloudflare의 GhostManual 전용 hostname을 loopback3200에 연결한 후 외부 HTTPS에서 입력→수정→검수→별도 Reader context→질문/근거→취소→삭제를 검증한다. AI 비활성화와 실 모델 품질 검증을 구분한다. 운영자 연락처·개인정보 안내가 준비돼야 공개 시연이 완료된다.

이전 앱 image digest와 이전 compose/.env 설정을 배포 전 보관한다(비밀 설정은 안전한 서버 내부에만). 실패 시 `GHOSTMANUAL_IMAGE`를 이전 digest로 바꾸고 `docker compose --env-file .env up -d --no-deps app`를 실행한다. DB image/볼륨은 그대로 둔다. 현재 migration은 자동 down migration을 제공하지 않으므로 이전 앱이 새 schema와 호환되는지 사전 격리 DB에서 확인해야 한다. 호환되지 않는 schema 변경은 공개 전 롤백 계획을 별도로 준비한다. `docker compose down -v`, 다른 프로젝트 restart, host-wide Docker prune은 사용하지 않는다.

Cloudflare tunnel이 host loopback3200만 호출하는 배포에서 Compose는 TRUST_CLOUDFLARE=true로 CF-Connecting-IP를 신뢰한다. 임의 외부 클라이언트가 앱 포트에 직접 접근할 수 있는 구성에서는 true를 사용하지 않는다. 로컬 개발은 false이며 공유 local bucket을 사용한다.

2026-10-05 실제 호스트 journal의 MaxRetentionSec 미설정 및 syslog forwarding을 확인했다. 이 호스트에서는 deploy/compose.no-logs.yaml을 서버 compose.yaml과 같은 디렉터리에 두고 모든 compose 명령에 -f compose.yaml -f compose.no-logs.yaml을 적용한다. cleanup unit도 같은 overlay를 사용하며 출력은 null로 보내 전역 journal 정책을 변경하지 않는다. 프로젝트 로그 영구 보관은 없으며 별도 요청/내용 로그도 만들지 않는다.
