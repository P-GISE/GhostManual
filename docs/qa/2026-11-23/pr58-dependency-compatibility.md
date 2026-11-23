# PR #58 최신 기본 통합·호환성 검증

## 범위

PR #96 병합6d58eef 기준으로 Dependabot PR #58 head6baa76ba의 package.json·lock12종을 별도 소유 브랜치에 통합했다. 원 PR 브랜치를 수정·닫지 않았고 이 보완은 [PR #100](https://github.com/P-GISE/GhostManual/pull/100)으로 검토한다. 운영은 PR95의2ff147b이며 앱·워커·환경·DB·AI 한도·OCR을 변경하지 않는다.

Node24 지원과 picomatch override를 유지한다. SDK1.11.0·fast-xml-parser5.12.1·Ky2.2.0·Next16.4.6·Nodemailer10.6.0·React/DOM19.3.1·Zod4.6.7·Biome2.6.8·Playwright1.65.1·types/node26.6.6·Vitest5.1.1이 대상이다.

## 실패 재현과 수정

원 PR의 CI45128855880은 설치 후 lint71오류·9경고·231정보에서 중단됐으며 진단291개가 생략됐다. 표시 오류는 MD16·YAML2 format이었고 숨겨진 항목은 단정하지 않았다.

공식 [Biome2.6.8 schema](https://biomejs.dev/schemas/2.6.8/schema.json)에 맞춰 버전을 맞추고 recommended:true를 preset:recommended로 이전했다. 이전에 검사하지 않던 Markdown·YAML formatter만 꺼 광범위한 문서 재작성을 피한다. JS/TS/JSON/CSS formatter와 명시적 lint규칙·includes는 유지하며 Markdown/YAML lint도 끄지 않았다. [CLI](https://biomejs.dev/reference/cli/)의 max-diagnostics=none으로 전체 진단을 보존한다.

통합 초기492c061의 CI45156103855에서 오류가1개로 줄었고 전체 진단을 확인했다. 새 usePlaywrightValidDescribeCallback 규칙이 AdminPage의 일반 describe(e) 함수를 테스트 describe로 오인했다. 규칙을 끄지 않고 함수 선언과 한 호출을 describeAuditEvent로 이름만 바꿨다. 기존 관리 이벤트 설명·권한·동작은 바꾸지 않았다.

9경고는 기존 globals.css의 descending specificity7·important1과 capture-qa.mjs의 innerText1이다. 229정보도 기존 코드 스타일 제안이며 이번 업데이트에서 일괄 재작성하지 않는다. 오류0이나 경고0은 최종 CI 로그를 확인한 뒤 구분해 보고한다.

## 검증·한계

이 기록 작성 시 최종 전체 CI는 진행 전/진행 중이며 [PR #100 최신 CI](https://github.com/P-GISE/GhostManual/pull/100/checks)를 따른다. 설치·lint·typecheck·단위·DB통합·빌드·E2E·세션·쿠키·접근성과 동일46개 parser corpus를 새 의존성 이미지에서 검사한다. 이전 코드의 검증 결과를 새 의존성 통과로 대신하지 않는다.

원격 공유 서버에서 설치·빌드·fixture생성·파싱 부하는 실행하지 않고 GitHub 격리 runner에서 수행한다. 실제 Anthropic 호출·메일 발송은 하지 않는다. SDK 로컬 HTTP fixture와 mailer file-driver 테스트를 실제 Anthropic·SMTP 검증으로 표시하지 않는다. 병합·운영 반영은 별도 지시 대상이다.
