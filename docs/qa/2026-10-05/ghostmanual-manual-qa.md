# GhostManual manual QA — 2026-10-05

Base URL: http://localhost:3200

This report was generated from the real Chrome Playwright surface after the production build. The workspace and source mutation used synthetic disposable example data; AI generation was not invoked. Share fragments were held in memory and redacted from logs.

## Capture scope

Ten routes were captured at 1440x900 and 390x844: /, /manuals, /sources/new, /sources/:id, /manuals/:id, /manuals/:id/edit, /ask, /share, /privacy, and /terms. State captures include published, AI unavailable, source re-review, and reader revoked. 27 surface scenarios passed and 0 failed.

## manualQa.surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| route-home-desktop | A1 | ownerPage | ownerPage.goto("http://localhost:3200/") at 1440x900 | PASS | route-home-desktop-screenshot, route-home-desktop-metrics |
| route-manuals-desktop | A1 | ownerPage | ownerPage.goto("http://localhost:3200/manuals") at 1440x900 | PASS | route-manuals-desktop-screenshot, route-manuals-desktop-metrics |
| route-sources-new-desktop | A1 | ownerPage | ownerPage.goto("http://localhost:3200/sources/new") at 1440x900 | PASS | route-sources-new-desktop-screenshot, route-sources-new-desktop-metrics |
| route-source-detail-desktop | A5 | ownerPage | ownerPage.goto("http://localhost:3200/sources/d84c0617-5768-4cc1-90b3-1e5b4082e3ad") at 1440x900 | PASS | route-source-detail-desktop-screenshot, route-source-detail-desktop-metrics |
| route-manual-detail-desktop | A3 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4") at 1440x900 | PASS | route-manual-detail-desktop-screenshot, route-manual-detail-desktop-metrics |
| route-manual-edit-desktop | A3 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit") at 1440x900 | PASS | route-manual-edit-desktop-screenshot, route-manual-edit-desktop-metrics |
| route-ask-desktop | A6 | ownerPage | ownerPage.goto("http://localhost:3200/ask") at 1440x900 | PASS | route-ask-desktop-screenshot, route-ask-desktop-metrics |
| route-privacy-desktop | A12 | ownerPage | ownerPage.goto("http://localhost:3200/privacy") at 1440x900 | PASS | route-privacy-desktop-screenshot, route-privacy-desktop-metrics |
| route-terms-desktop | A12 | ownerPage | ownerPage.goto("http://localhost:3200/terms") at 1440x900 | PASS | route-terms-desktop-screenshot, route-terms-desktop-metrics |
| state-published-desktop | A3 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4") at 1440x900 | PASS | state-published-desktop-screenshot, state-published-desktop-metrics |
| route-share-desktop | A4 | readerPage | readerPage.goto("http://localhost:3200/share") at 1440x900 | PASS | route-share-desktop-screenshot, route-share-desktop-metrics |
| state-unavailable-desktop | A8 | readerPage | readerPage.goto("http://localhost:3200/share") at 1440x900 | PASS | state-unavailable-desktop-screenshot, state-unavailable-desktop-metrics |
| route-share-mobile | A4 | readerPage | readerPage.goto("http://localhost:3200/share") at 390x844 | PASS | route-share-mobile-screenshot, route-share-mobile-metrics |
| state-unavailable-mobile | A8 | readerPage | readerPage.goto("http://localhost:3200/share") at 390x844 | PASS | state-unavailable-mobile-screenshot, state-unavailable-mobile-metrics |
| state-reader-revoked-desktop | A9 | readerPage | readerPage.goto("http://localhost:3200/share") at 1440x900 | PASS | state-reader-revoked-desktop-screenshot, state-reader-revoked-desktop-metrics |
| state-rereview-desktop | A7 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4") at 1440x900 | PASS | state-rereview-desktop-screenshot, state-rereview-desktop-metrics |
| state-rereview-edit-desktop | A7 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit") at 1440x900 | PASS | state-rereview-edit-desktop-screenshot, state-rereview-edit-desktop-metrics |
| route-home-mobile | A1 | ownerPage | ownerPage.goto("http://localhost:3200/") at 390x844 | PASS | route-home-mobile-screenshot, route-home-mobile-metrics |
| route-manuals-mobile | A1 | ownerPage | ownerPage.goto("http://localhost:3200/manuals") at 390x844 | PASS | route-manuals-mobile-screenshot, route-manuals-mobile-metrics |
| route-sources-new-mobile | A1 | ownerPage | ownerPage.goto("http://localhost:3200/sources/new") at 390x844 | PASS | route-sources-new-mobile-screenshot, route-sources-new-mobile-metrics |
| route-source-detail-mobile | A5 | ownerPage | ownerPage.goto("http://localhost:3200/sources/d84c0617-5768-4cc1-90b3-1e5b4082e3ad") at 390x844 | PASS | route-source-detail-mobile-screenshot, route-source-detail-mobile-metrics |
| route-manual-detail-mobile | A3 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4") at 390x844 | PASS | route-manual-detail-mobile-screenshot, route-manual-detail-mobile-metrics |
| route-manual-edit-mobile | A3 | ownerPage | ownerPage.goto("http://localhost:3200/manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit") at 390x844 | PASS | route-manual-edit-mobile-screenshot, route-manual-edit-mobile-metrics |
| route-ask-mobile | A6 | ownerPage | ownerPage.goto("http://localhost:3200/ask") at 390x844 | PASS | route-ask-mobile-screenshot, route-ask-mobile-metrics |
| route-privacy-mobile | A12 | ownerPage | ownerPage.goto("http://localhost:3200/privacy") at 390x844 | PASS | route-privacy-mobile-screenshot, route-privacy-mobile-metrics |
| route-terms-mobile | A12 | ownerPage | ownerPage.goto("http://localhost:3200/terms") at 390x844 | PASS | route-terms-mobile-screenshot, route-terms-mobile-metrics |
| state-reader-revoked-mobile | A9 | readerPage | readerPage.goto("http://localhost:3200/share") at 390x844 | PASS | state-reader-revoked-mobile-screenshot, state-reader-revoked-mobile-metrics |

## manualQa.adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| state-published-desktop | A3 | published-version-boundary | 검수 확인 후 게시 버전 1이 표시되고 초안과 게시본 상태가 구분된다. | PASS | state-published-desktop-screenshot, state-published-desktop-metrics |
| share-fragment-scrub | A4 | share-token-url-leak | 공유 fragment 교환 후 주소는 /share로 정리되고 hash가 비어 있다. | PASS | route-share-desktop-screenshot, route-share-desktop-metrics |
| state-unavailable-desktop | A8 | ai-unavailable-fallback | 실 AI 호출 없이 이용 불가 안내와 검색 결과를 표시한다. | PASS | state-unavailable-desktop-screenshot, state-unavailable-desktop-metrics |
| state-unavailable-mobile | A8 | ai-unavailable-fallback-mobile | 390x844에서도 실 AI 호출 없이 이용 불가 안내와 검색 결과를 표시한다. | PASS | state-unavailable-mobile-screenshot, state-unavailable-mobile-metrics |
| state-reader-revoked-desktop | A9 | revoked-reader-session | 공유 취소 후 기존 reader 세션 reload가 alert로 거부된다. | PASS | state-reader-revoked-desktop-screenshot, state-reader-revoked-desktop-metrics |
| state-rereview-desktop | A7 | source-revision-invalidates-manual | 원본 변경 후 매뉴얼에 재검토 필요가 표시되고 신규 공유/답변 근거에서 제외된다. | PASS | state-rereview-desktop-screenshot, state-rereview-desktop-metrics |
| state-reader-revoked-mobile | A9 | revoked-reader-session-mobile | 390x844에서도 취소된 공유가 alert로 거부되고 가로 overflow가 없다. | PASS | state-reader-revoked-mobile-screenshot, state-reader-revoked-mobile-metrics |

## manualQa.artifactRefs

| id | kind | description | path |
|---|---|---|---|
| route-home-desktop-screenshot | screenshot | desktop / rendered UI | docs/qa/2026-10-05/screenshots/desktop-home.png |
| route-home-desktop-metrics | metrics | desktop / DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-manuals-desktop-screenshot | screenshot | desktop /manuals rendered UI | docs/qa/2026-10-05/screenshots/desktop-manuals-draft.png |
| route-manuals-desktop-metrics | metrics | desktop /manuals DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-sources-new-desktop-screenshot | screenshot | desktop /sources/new rendered UI | docs/qa/2026-10-05/screenshots/desktop-sources-new.png |
| route-sources-new-desktop-metrics | metrics | desktop /sources/new DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-source-detail-desktop-screenshot | screenshot | desktop /sources/d84c0617-5768-4cc1-90b3-1e5b4082e3ad rendered UI | docs/qa/2026-10-05/screenshots/desktop-source-detail.png |
| route-source-detail-desktop-metrics | metrics | desktop /sources/d84c0617-5768-4cc1-90b3-1e5b4082e3ad DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-manual-detail-desktop-screenshot | screenshot | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 rendered UI | docs/qa/2026-10-05/screenshots/desktop-manual-detail-draft.png |
| route-manual-detail-desktop-metrics | metrics | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-manual-edit-desktop-screenshot | screenshot | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit rendered UI | docs/qa/2026-10-05/screenshots/desktop-manual-edit-draft.png |
| route-manual-edit-desktop-metrics | metrics | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-ask-desktop-screenshot | screenshot | desktop /ask rendered UI | docs/qa/2026-10-05/screenshots/desktop-ask-empty.png |
| route-ask-desktop-metrics | metrics | desktop /ask DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-privacy-desktop-screenshot | screenshot | desktop /privacy rendered UI | docs/qa/2026-10-05/screenshots/desktop-privacy.png |
| route-privacy-desktop-metrics | metrics | desktop /privacy DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-terms-desktop-screenshot | screenshot | desktop /terms rendered UI | docs/qa/2026-10-05/screenshots/desktop-terms.png |
| route-terms-desktop-metrics | metrics | desktop /terms DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-published-desktop-screenshot | screenshot | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 rendered UI | docs/qa/2026-10-05/screenshots/desktop-manual-detail-published.png |
| state-published-desktop-metrics | metrics | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-share-desktop-screenshot | screenshot | desktop /share rendered UI | docs/qa/2026-10-05/screenshots/desktop-share-reader.png |
| route-share-desktop-metrics | metrics | desktop /share DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-unavailable-desktop-screenshot | screenshot | desktop /share rendered UI | docs/qa/2026-10-05/screenshots/desktop-share-unavailable.png |
| state-unavailable-desktop-metrics | metrics | desktop /share DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-share-mobile-screenshot | screenshot | mobile /share rendered UI | docs/qa/2026-10-05/screenshots/mobile-share-reader-mobile.png |
| route-share-mobile-metrics | metrics | mobile /share DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-unavailable-mobile-screenshot | screenshot | mobile /share rendered UI | docs/qa/2026-10-05/screenshots/mobile-share-unavailable-mobile.png |
| state-unavailable-mobile-metrics | metrics | mobile /share DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-reader-revoked-desktop-screenshot | screenshot | desktop /share rendered UI | docs/qa/2026-10-05/screenshots/desktop-share-reader-revoked.png |
| state-reader-revoked-desktop-metrics | metrics | desktop /share DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-rereview-desktop-screenshot | screenshot | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 rendered UI | docs/qa/2026-10-05/screenshots/desktop-manual-detail-rereview.png |
| state-rereview-desktop-metrics | metrics | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-rereview-edit-desktop-screenshot | screenshot | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit rendered UI | docs/qa/2026-10-05/screenshots/desktop-manual-edit-rereview.png |
| state-rereview-edit-desktop-metrics | metrics | desktop /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-home-mobile-screenshot | screenshot | mobile / rendered UI | docs/qa/2026-10-05/screenshots/mobile-home.png |
| route-home-mobile-metrics | metrics | mobile / DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-manuals-mobile-screenshot | screenshot | mobile /manuals rendered UI | docs/qa/2026-10-05/screenshots/mobile-manuals-current.png |
| route-manuals-mobile-metrics | metrics | mobile /manuals DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-sources-new-mobile-screenshot | screenshot | mobile /sources/new rendered UI | docs/qa/2026-10-05/screenshots/mobile-sources-new.png |
| route-sources-new-mobile-metrics | metrics | mobile /sources/new DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-source-detail-mobile-screenshot | screenshot | mobile /sources/d84c0617-5768-4cc1-90b3-1e5b4082e3ad rendered UI | docs/qa/2026-10-05/screenshots/mobile-source-detail-current.png |
| route-source-detail-mobile-metrics | metrics | mobile /sources/d84c0617-5768-4cc1-90b3-1e5b4082e3ad DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-manual-detail-mobile-screenshot | screenshot | mobile /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 rendered UI | docs/qa/2026-10-05/screenshots/mobile-manual-detail-current.png |
| route-manual-detail-mobile-metrics | metrics | mobile /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4 DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-manual-edit-mobile-screenshot | screenshot | mobile /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit rendered UI | docs/qa/2026-10-05/screenshots/mobile-manual-edit-current.png |
| route-manual-edit-mobile-metrics | metrics | mobile /manuals/3a8a4315-72bc-409c-b434-a6a9e92a21b4/edit DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-ask-mobile-screenshot | screenshot | mobile /ask rendered UI | docs/qa/2026-10-05/screenshots/mobile-ask-empty.png |
| route-ask-mobile-metrics | metrics | mobile /ask DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-privacy-mobile-screenshot | screenshot | mobile /privacy rendered UI | docs/qa/2026-10-05/screenshots/mobile-privacy.png |
| route-privacy-mobile-metrics | metrics | mobile /privacy DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| route-terms-mobile-screenshot | screenshot | mobile /terms rendered UI | docs/qa/2026-10-05/screenshots/mobile-terms.png |
| route-terms-mobile-metrics | metrics | mobile /terms DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| state-reader-revoked-mobile-screenshot | screenshot | mobile /share rendered UI | docs/qa/2026-10-05/screenshots/mobile-share-reader-revoked.png |
| state-reader-revoked-mobile-metrics | metrics | mobile /share DOM and overflow metrics | docs/qa/2026-10-05/dom-metrics.json |
| dom-metrics | metrics | DOM, viewport, PNG dimensions, and horizontal overflow for every capture | docs/qa/2026-10-05/dom-metrics.json |
| browser-action-log | action-log | Redacted browser actions, page errors, console errors, and failed requests | docs/qa/2026-10-05/browser-action-log.json |
| browser-action-log | action-log | Redacted browser actions and runtime errors | docs/qa/2026-10-05/browser-action-log.json |
| dom-metrics | metrics | DOM and screenshot metrics | docs/qa/2026-10-05/dom-metrics.json |
| manual-qa-report | report | This manualQa matrix | docs/qa/2026-10-05/ghostmanual-manual-qa.md |

## Runtime evidence

- Page errors: 0; console errors: 3; failed requests: 0; expected navigation aborts: 219 (aggregated with five samples). See [browser-action-log.json](docs/qa/2026-10-05/browser-action-log.json).
- PNG signatures and requested dimensions were checked for every screenshot; DOM overflow metrics are in [dom-metrics.json](docs/qa/2026-10-05/dom-metrics.json).
- Every PASS references a non-empty screenshot and metrics artifact.
