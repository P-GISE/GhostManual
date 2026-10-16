# 남은 검증의 실행 조건

후속 상태: 원격 배포 식별은 사용자 서버 실행 출력으로 [확인 완료](remote-deployment.md). 아래 접속 미준비 상태는 그 이전 관찰이다. AI·계정·예산은 사용자 지시로 범위에서 제외했다.

확인일: 2026-10-17 KST. 기존 공개 HTTPS 검증과 문서 변경을 보존했다.

## 이번에 실제 확인한 조건

- 환경 상태 API: observations_current=true. 등록된 secret은 CLOUDFLARE_API_TOKEN 하나이며 ready. OpenAI secret·런타임 변수·AWS outbound identity 없음.
- 실행기: OPENAI_API_KEY 미주입, SSH_AUTH_SOCK·AWS_PROFILE·AWS_WEB_IDENTITY_TOKEN_FILE·OIC_MANIFEST_PATH 미설정. SSH config 없음. 값은 출력하지 않고 설정 여부만 확인했다.
- 네트워크 정책: vpn_configured=false, tcp_network_access domains/ip_ranges 모두 빈 배열. ssh 바이너리는 있으나 Tailscale·AWS·cloudflared CLI는 없다. CLI 설치만으로 인증이나 네트워크 접근이 생기지 않는다.
- Cloudflare 토큰을 서버 셸 인증으로 재사용하거나 터널 관리 방식을 바꾸지 않았다.

## 서버 접속 후 실행할 읽기 전용 점검

기존 승인된 Tailscale/SSH 또는 AWS 관리 경로를 복구한 뒤 서버에서 실행한다. 아래 명령은 이번 환경에서 실행하지 않았다. 운영 컨테이너를 변경하거나 재시작하지 않는다.

```sh
cd /opt/ghostmanual
app_id=$(docker compose -f compose.yaml -f compose.no-logs.yaml --env-file .env ps -q app)
test -n "$app_id"
docker inspect --format 'image={{.Image}} configured_image={{.Config.Image}} status={{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$app_id"
image_id=$(docker inspect --format '{{.Image}}' "$app_id")
docker image inspect --format 'revision={{index .Config.Labels "org.opencontainers.image.revision"}} digests={{json .RepoDigests}}' "$image_id"
docker exec "$app_id" node -e 'const fs=require("node:fs");console.log(JSON.stringify({buildId:fs.readFileSync(".next/BUILD_ID","utf8").trim(),aiEnabled:process.env.AI_ENABLED==="true",keyConfigured:!!process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL}));'
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' "$app_id"
systemctl is-active ghostmanual-cleanup.timer
systemctl show ghostmanual-cleanup.service -p Result -p ExecMainStatus
curl --fail --silent --show-error --max-time 15 -o /dev/null -w 'GhostManual %{http_code}\n' http://127.0.0.1:3200/
curl --fail --silent --show-error --max-time 15 -o /dev/null -w 'existing3000 %{http_code}\n' http://127.0.0.1:3000/
curl --fail --silent --show-error --max-time 15 -o /dev/null -w 'existing3100 %{http_code}\n' http://127.0.0.1:3100/
```

Compose overlay가 실제 서버에 있는지 먼저 확인한다. revision label이 없으면 SHA 미확인으로 유지하고 image ID를 보관된 검증 이미지와 대조한다. build ID 일치만으로 서버 전체 소스 동일성을 단정하지 않는다.

## 실제 AI 실행 조건

OpenAI API 결제가 가능한 프로젝트와 예산을 준비하고, 키는 채팅에 붙이지 않고 환경 secret 설정의 OPENAI_API_KEY에 등록한다. 실행 환경의 api.openai.com HTTP 허용도 필요하다. 현재 키와 대상 호스트 허용이 없어 실제 호출은 하지 않았다.

기존 scripts/evaluate.ts는 deterministic-retrieval-fixture만 실행한다. injectionFixtures는 개수 표시이며 실제 모델 주입 내성 시험이 아니다. 이 스크립트의 성공을 AI 품질 합격으로 취급하지 않는다.

준비 후 격리된 합성 자료로 실제 매뉴얼 생성·답변을 실행하고, 설계 A13의 정답12건 중11건 이상 검색·근거 없음6건 보류·주입4건의 출력 및 권한 경계를 검증한다. 비용·timeout·근거 정합성과 실제 결과를 기록한 뒤 공개 AI를 활성화한다. 공개 정책은 현재 AI 비활성으로 설명하고 있으므로 활성화 시 외부 전송과 제공자 처리 안내도 함께 갱신해야 한다.
