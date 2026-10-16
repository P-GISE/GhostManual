# 키보드 본문 바로가기 회귀 검증 — 2026-10-17 KST

## 범위와 재현

프로젝트 가이드의 UX-A11Y 후속 후보에서 UX-KEYBOARD를 선택했다. 기존 공개10개 사용자 흐름과 다른 로컬 키보드 탐색 검사이며 공개 서비스·DB에 쓰기를 수행하지 않는다. 기준은 가이드 commit3f7201d다.

기존 바로가기 href는 #main을 가리켰지만 대상 main은 포커스를 받을 수 없었다. 로컬 배포 모드에서 첫 Tab으로 ‘본문으로 이동’ 선택 → Enter 후 main의 toBeFocused 검사가 inactive로 실패했다. 개발 모드에서는4경로×2뷰포트 모두 실패했으나 CSP/eval 경고가 있어 배포 모드의 홈페이지 실패를 별도로 재현한 뒤 수정했다. 테스트 설정의 optional executablePath 타입 오류를 고친 과정은 동작 RED로 집계하지 않는다.

main에 tabIndex=-1을 부여해 일반 Tab 순서에는 추가하지 않고 바로가기의 포커스 대상으로 만들었다. 기존3px focus-visible 규칙에 main을 포함하고 main의 outline-offset을-3px로 설정해 좁은 화면 안쪽에 그린다. 기존 기능·권한·API·AI·배포 설정은 변경하지 않았다.

## 독립 리뷰와 회귀 보완

독립 reviewer가 실제 production Chromium의 mobile390×844에서 긴 본문 전체의 테두리가 viewport 밖에 그려져 보이지 않는 P2를 발견했다. 기존 computed-style 검사만으로는 이를 놓쳤다. outline의4개 painted edge와 viewport의 교차 여부를 검사에 추가했고, 수정 전 mobile 자료 등록 화면에서 false로 실패하는 것을 확인했다. main 전용 inset offset으로 보완했다. focus 이동과 indicator 가시성은 별도의 RED→GREEN 근거로 기록한다. 새로운 제품 구조나 전면 접근성 개편은 추가하지 않았다.

## 직접 실행한 검증

| 검사 | 결과 |
|---|---|
| 수정 전 production 키보드 검사 | homepage desktop1개 실패. main inactive 확인 |
| 포커스 테두리 회귀 RED | mobile 자료 등록 화면의 모든 outline edge가 viewport 밖이라 실패 |
| 수정 후 production 키보드 검사 | /·/sources/new·/terms·/privacy ×1440×900/390×844, 8/8 통과 |
| 검사 항목 | ko 언어·단일 main/h1·첫 Tab의 바로가기 노출·Enter 후 본문 포커스·3px outline과 viewport 내부 painted edge·다음 Tab이 본문 내부 요소로 이동 |
| npm test | 단위41/41 통과 |
| npm run typecheck | 종료0 |
| npm run build | 수정 소스 production build 종료0 |
| npm run lint | 최종 종료0. 기존 warning1/info66은 유지 |
| CI workflow | actionlint 종료0. 기존 build/Chromium 설치 후 접근성 회귀 step 추가, 원격 CI 결과와 구분 |

재현 명령(이미 설치된 Chromium 사용):

```sh
npm ci
npm run build
A11Y_CHROMIUM_PATH=/usr/bin/chromium npm run test:accessibility
```

Playwright 관리 Chromium이 설치돼 있으면 A11Y_CHROMIUM_PATH 없이 실행한다. 별도 config는3320 loopback의 production 앱을 띄우며 DB 초기화 globalSetup을 사용하지 않는다. 빈번한 자료 생성·삭제나 기존 공개 QA를 반복하지 않는다.

## 제한과 환경 정리

모바일은 Linux Chromium154.0.8037.57의390px viewport이며 실제 휴대폰·화면 낭독기·Firefox/WebKit·확대/고대비/전체 WCAG 인증을 시험한 것은 아니다. 입력 검증·인증·DB·기존 통합40/E2E24는 이번 수정으로 변경하지 않아 로컬에서 재실행하지 않았다. 공개 서버 재배포·DNS·터널·재시작·AI 호출도 하지 않았다.

초기 전체 lint는 이전 작업에서 남은 .dev-tools의 외부 패키지까지 검사해 실패했다. 이 캐시는 삭제하지 않고 /workspace/scratch/GhostManual-legacy-dev-tools-a11y로 보존 이동했다. 이후 기존 public-assets.json의 마지막 줄바꿈 format 오류를 정리했고 JSON 파싱 값이 HEAD와 같은 것을 확인했다. 기존 QA 결과값은 변경하지 않았다. Biome의 기존 권고1개와 info66, production test server의 standalone 사용 권고/색상 환경 경고는 남아 있으며 성공 결과를 경고0으로 표시하지 않는다.

배포/원격 상태는 기존58d9ebd 태그의 인계 기록 그대로다. 이 변경이 공개 사이트에 적용됐다고 주장하지 않는다.
