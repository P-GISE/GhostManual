# 시작 화면 hydration 전 클릭 유실 — 로컬 재현과 보완

2026-10-26 KST. 기준 소스 `4dc281b8767169a5510f1b3681062fa72486d4f8`, 별도 작업 트리 `C:/코덱스/ghost-hydration-20261026`. 공개 요청·공개 공간 생성·GitHub push·배포·DB/인프라 변경은 하지 않았다.

## 확인됨

실제 Next production 화면을 loopback TLS에서 열고 **모든 Next JavaScript 응답을 보류**했다. 서버 렌더링된 ‘빈 공간 시작’과 ‘합성 예제 열기’가 visible/enabled인 채 실제 pointer click을 받았지만 `/api/workspaces` 요청은0이었다. HTML이 보이는 시점과 React handler가 준비된 시점 사이의 클릭 유실을 두 모드 모두 재현했다.

회귀는 mock HTML을 쓰지 않는다. 기존 TLS fixture가 실제 Next UI를 프록시하고 세션 API·쿠키 속성을 사용하며 저장만 메모리 합성 자료로 대체한다. JavaScript 보류 중 pointer click→POST0 확인→disabled 요구가 수정 전 두 번 모두 실패했다. 임의 sleep이나 쿠키 강제 주입 없이 네트워크 gate를 사용한다.

## 최소 보완

`Start`의 기존 mount effect에서 `ready` 상태를 true로 바꾸고 두 시작 버튼의 disabled 조건에 `!ready`를 추가했다. SSR에서는 비활성화하고 실제 client mount 후 활성화한다. 기존 busy·중복 생성 방지·세션 확인·진단·재시도는 유지한다. API·쿠키·DB·Origin·캐시는 변경하지 않는다.

보완 후 같은 회귀는 gate가 닫혔을 때 disabled·POST0, gate 해제 후 enabled→사용자 클릭→생성1회→Secure/HttpOnly 쿠키→문서함 정상 표시를 확인한다.

## 직접 실행 결과

Node24.20.0·Next16.4.1·실제 로컬 Chrome. 수정 전 오류 context는 `.omo/evidence/hydration/red`에 보존했다.

| 명령 | 결과 |
|---|---|
| `node node_modules/next/dist/bin/next build --webpack` | 보완 전/후 production build 성공 |
| `node node_modules/@playwright/test/cli.js test --config playwright.transport.config.ts hydration.spec.ts --reporter=line` | 수정 전 **2/2 실패**: enabled SSR·early click·POST0, disabled 요구 실패 |
| `node node_modules/@playwright/test/cli.js test --config playwright.transport.config.ts --reporter=line` | 보완 후 **9/9 통과** (기존 TLS7+신규2), 17.1초 |
| `node node_modules/@playwright/test/cli.js test --config playwright.session.config.ts --reporter=line` | 기존 시작/세션/목록 **11/11 통과**, 6.5초 |
| `npm run typecheck`, `npm test` | 타입 성공·unit **43/43 통과** |
| `node node_modules/@biomejs/biome/bin/biome check --write src/components/Start.tsx tests/session-transport/hydration.spec.ts` | 소유 두 파일 포맷/검사 통과 |
| `git diff --check` | 성공 |

TLS 인증서는 로컬 합성용이다. openssl은 기존 `C:/Program Files/Git/usr/bin`을 테스트 프로세스 PATH에만 추가했다. 실제 인증서·계정·비밀을 사용하지 않는다.

## 도구 제약과 미확인

기존 node_modules를 읽는 로컬 junction 때문에 기본 Turbopack가 filesystem root 밖 symlink라며 빌드를 거절했다. junction만 제거하고 별도 `npm ci`를 하려던 PowerShell 명령은 **자동 승인 검토가 차단**해 중단했다. 별도 사유는 제공되지 않았고 다른 도구로 삭제를 우회하지 않았다. junction은 유지하고 독립적인 `next build --webpack`으로 실제 production UI를 빌드했다. standalone trace는 외부 node_modules 경로27개를 제외한다는 경고가 있어 이 결과물을 배포 artifact로 사용하지 않는다. 이 `next start` 로컬 시험은 표준 Linux Turbopack CI·운영 이미지 빌드를 대체하지 않는다.

**미확인:** 이 독립 재현 결함이 지인의 document GET401 원인이라고 입증한 것은 아니다. 원래 기기의 진단 단계·응답 상태·실제 재시험이 필요하다. 다른 네트워크·iPhone 전체 해결, 운영 적용 또는 전체 보안 승인으로 확대하지 않는다.
