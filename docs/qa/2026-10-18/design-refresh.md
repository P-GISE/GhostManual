# 전체 화면·한글 글꼴 개선 — 2026-10-18 KST

후속2026-10-19: 검증 이미지7efb284를 기존 서버 앱에 적용하고 공개 글꼴·정렬·키보드 변경을 직접 확인했다. [최종 배포·공개 검증](../2026-10-19/deployment-complete.md)을 따른다. 아래 미배포 표시는10월18일 당시 상태다.

## 승인된 범위

사용자가 전체 디자인을 자연스러운 업무 문서함으로 개선하고 좌우 대칭·글꼴을 맞추도록 요청했다. 기존 화면/기능을 유지하는 시각 개선으로 공통 스타일·네비게이션·시작 화면·문서함 필터·검수/근거 패널·편집 폼을 정리했다. API·DB·AI 설정·공개 배포는 변경하지 않았다. Docker runtime에 public 디렉터리를 복사해 글꼴 원본과 라이선스도 함께 포함하도록 패키징을 보완했다.

- 전체 최대 폭1200px과 공통 좌우 gutter를 header/main/footer에 적용했다. 단일 읽기/등록/질문 열은760px 한도에서 가운데 정렬한다.
- 문서/검수·편집/원본 비교의 두 열은 같은 폭이고 작은 화면에서는 한 열이다. 공통 패널 여백과48px 입력/선택 높이를 맞췄다.
- 한글 Pretendard Variable을 next/font/local로 자체 호스팅한다. 제목/본문/보조 글자의 크기·굵기·행간을 정리하고 녹색 강조와 중성 배경을 사용한다.
- 첫 화면은 소개·시작 버튼·실제 사용 순서로 구성한다. 모바일에서는 시작 버튼을 설명 목록 앞에 배치해 첫 viewport 안에서 시작할 수 있다.
- 현재 메뉴 표시·한국어 소제목·문서 개수 간격·체크박스·오류/상태·키보드 포커스·reduced motion을 함께 정리했다.

## 글꼴 출처·라이선스

[공식 Pretendard 저장소](https://github.com/orioncactus/pretendard)의 packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2를 가져왔다. 파일2057688bytes, SHA256 `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`. SIL Open Font License 원문은 [동봉 라이선스](../../../public/fonts/Pretendard-LICENSE.txt)에 보존했다. 원본 WOFF2의 signature와 실제 브라우저 loaded FontFace를 확인한다. 런타임에서 외부 글꼴 CDN에 의존하지 않는다.

## 재현·검증 범위

Playwright의1440×900·390×844·768×1024에서 실행한다. 시작·등록·질문·약관·개인정보는 실제 로컬 production 화면이다. 문서함·매뉴얼·편집·원본·Reader는 기존 합성 fixture를 API GET 경계에서 주입해 UI만 확인한다. 실제 DB/인증/권한·게시·공유 저장 성공을 주장하지 않는다. GET 외 요청과 예상 밖 API를 만나면 테스트를 실패시킨다.

기하 검사: 좌우 여백 차이≤2px, header/main/footer 기준선 차이≤2px, split 두 열 너비 차이≤2px, 가로 넘침 없음. 글꼴 로딩·placeholder 대비≥4.5:1·시작 버튼 완전 노출·기존 main 포커스와 화면 안쪽 outline도 검사한다.

RED 기록: 기존 등록 화면의 비대칭 여백과 로컬 웹 글꼴 부재2개 실패, 모바일 시작 버튼 viewport 미노출1개 실패, 새 placeholder4.22:1 대비 실패를 확인했다. 독립 리뷰가 지적한 목록 grid 스타일의 전역 유출은 실제 문서 li의 display:list-item 회귀 실패 후 .workflow > li로 범위를 한정해 수정했다.

검증 명령:

```sh
npm ci
npm run build
A11Y_CHROMIUM_PATH=/usr/bin/chromium npm run test:accessibility
npm test
npm run typecheck
npm run lint
```

최종 production 검사42/42·단위41/41·typecheck/build/lint 모두 종료0. lint는 오류/경고0, 기존 info66을 유지한다. Linux Chromium viewport 테스트는 실제 휴대폰/화면 낭독기/전체 WCAG 인증과 다르다.

## 실행 중 발견한 도구 문제

추가 검사를 기존 Playwright 실행과 겹쳐 시작해3320 포트 거부와 공유 trace 디렉터리의 ENOENT가 발생했다. 이 실행은 통과로 집계하지 않았다. 최종 검사는 같은 포트/출력 디렉터리를 동시에 사용하는 실행 없이 순차 수행한다. 테스트 타입 오류도 제품 동작 RED에 포함하지 않는다. 기존 next start standalone 권고·색상 환경 경고는 제품 오류와 구분한다.

## 공개 반영 상태

이번 변경은 로컬·GitHub 검토용이며 기존 공개58d9ebd 이미지에 배포하지 않았다. DNS·터널·서버·실제 AI 호출·원격 DB는 변경하지 않았다. 이전 공개 QA10개 흐름이나 통합40/E2E24 결과를 이번 디자인의 직접 검증으로 복사하지 않는다.

## 최종 캡처

각 화면은 desktop1440×900·mobile390×844·tablet768×1024의 실제 Chromium 렌더링이다. 문서 화면의 내용은 위에 명시한 합성 fixture다.

| 화면 | 데스크톱 | 모바일 | 태블릿 |
|---|---|---|---|
| 시작 | [desktop](screenshots/home-desktop.png) | [mobile](screenshots/home-mobile.png) | [tablet](screenshots/home-tablet.png) |
| 문서함 | [desktop](screenshots/library-desktop.png) | [mobile](screenshots/library-mobile.png) | [tablet](screenshots/library-tablet.png) |
| 자료 등록 | [desktop](screenshots/register-desktop.png) | [mobile](screenshots/register-mobile.png) | [tablet](screenshots/register-tablet.png) |
| 원본 | [desktop](screenshots/source-desktop.png) | [mobile](screenshots/source-mobile.png) | [tablet](screenshots/source-tablet.png) |
| 매뉴얼 검수 | [desktop](screenshots/manual-desktop.png) | [mobile](screenshots/manual-mobile.png) | [tablet](screenshots/manual-tablet.png) |
| 편집 | [desktop](screenshots/editor-desktop.png) | [mobile](screenshots/editor-mobile.png) | [tablet](screenshots/editor-tablet.png) |
| Reader 공유 | [desktop](screenshots/reader-desktop.png) | [mobile](screenshots/reader-mobile.png) | [tablet](screenshots/reader-tablet.png) |
| 질문 | [desktop](screenshots/ask-desktop.png) | [mobile](screenshots/ask-mobile.png) | [tablet](screenshots/ask-tablet.png) |
| 이용약관 | [desktop](screenshots/terms-desktop.png) | [mobile](screenshots/terms-mobile.png) | [tablet](screenshots/terms-tablet.png) |
| 개인정보 | [desktop](screenshots/privacy-desktop.png) | [mobile](screenshots/privacy-mobile.png) | [tablet](screenshots/privacy-tablet.png) |

## 독립 리뷰

React/공통 스타일과 데스크톱·모바일·태블릿 최종 캡처7장을 독립 reviewer가 확인했다. 목록 grid의 전역 적용 문제는 수정 후 번호/본문 표시와 회귀 검사를 확인했다. 최종 남은 Critical/Important/Minor 지적은 없다. reviewer는 테스트를 별도로 재실행하지 않았으며 합성 API 밖의 DB/인증·실 배포·AI·실기기·전체 접근성 인증은 판단하지 않았다.

Docker runtime의 public 복사 경로와 자산 존재를 확인했다. 이번에는 로컬 Docker 이미지 전체 빌드를 실행하지 않았으며 원격 CI의 이미지 빌드 결과는 별도 확인 대상이다. Next production build와 브라우저 검증을 Docker 이미지 검증으로 확대하지 않는다.
