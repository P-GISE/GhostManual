# Independent visual review A — 2026-10-05

Final verdict: **PASS** after the targeted follow-up below. Initial verdict was REVISE for HEAD `ba306e0a5f34bf5f807fd59b46b9a05e8c660555` plus the nine added CSS lines for heading wrapping and nav/footer/manual-title targets. Final review covers that HEAD plus the ten-line CSS addition (button keep-all, nav/footer/all row anchors 44px, heading keep-all/anywhere) and the stabilized capture script; parent must stamp the resulting commit SHA. This is a visual evidence review, not a public deployment, live AI, Lighthouse or complete accessibility certification.

I read DESIGN.md, the capture report and all 27 DOM metric entries, and inspected all 27 PNGs using view_image. Ten routes have desktop and mobile artifacts; published, re-review, valid Reader, unavailable AI and revoked Reader states are covered. All metric entries report fullPage, scrollY 0, no horizontal overflow, and keep-all headings. The long mobile editor includes its bottom save/review controls and complete comparison/preview content. Reader captures hide Owner navigation and publishing controls; unavailable AI shows explicit fallback and search results; revoked Reader displays rejection.

## Findings

1. **Medium, target coverage:** `.row h3 a` covers manual titles but leaves the source-list title anchor outside the 44px target rule. `mobile-manuals-current.png` and `desktop-manuals-draft.png` show the source title with only its single text-line target; CodeGraph confirms the source anchor is a direct `.row` child at `src/components/ManualList.tsx:99`. Extend the rule and capture geometry assertion to `.row a`. Previously recorded metrics include only `.row h3 a`, so their all-44 values do not establish source-title coverage.

2. **Low, mobile CJK action labels:** `mobile-home.png` splits “열기” into “열 / 기” on the synthetic-example button, and `mobile-source-detail-current.png` splits “작성하기” into “작성하 / 기”. Keep words intact in button/.button text using native CSS, allowing whitespace wrapping between words. Heading wrapping itself is corrected.

3. **Medium, screenshot integrity:** `desktop-ask-empty.png` begins with navigation at the top edge and omits the wordmark; `desktop-terms.png` begins at the title and omits the eyebrow/header and footer. Their metrics report fullPage/scrollY 0, but these images do not visibly cover the whole route. The capture resets scroll immediately before screenshot with no rendering-frame wait. Wait for the reset to render and recapture these artifacts; visually check header and footer. Other images, including both long editors, visibly include the complete page.

No further blocking layout issue was found in the inspected artifacts. The report records three console errors, zero page errors and zero non-navigation request failures; this review does not reinterpret those errors as a clean console.

## Targeted follow-up

All three findings are resolved in the fresh capture set. I inspected original-detail `desktop-ask-empty.png` and `desktop-terms.png`: both now visibly include the complete GhostManual header, eyebrow, route content and policy footer. I inspected `mobile-home.png` and `mobile-source-detail-current.png`: “열기” and “작성하기” now remain whole words, with wrapping at spaces. The source-title row visibly has increased vertical space in `mobile-manuals-current.png`; current desktop/mobile manual-list metrics now include seven nav/footer/row anchors, each exactly 44px high, with no horizontal overflow and scrollY 0. The matching CSS rule is `.row a`, so it covers the direct source anchor as well as manual titles.

This follow-up rechecked only the three reported findings, relying on the preceding complete 27-image review for unchanged layout coverage. No unresolved finding remains from review A.

## Source commit binding

Reviewed layout is committed as `c83dafdbe00c9e2bf50609148b530d3cc7c22353`; CSS SHA-256 `6c95cc01f1a49caf6cd87b887758f4c507bc440726baae0e6db5c74b26128646` matches the reviewed snapshot. The later capture-script browser-finally cleanup changes failure handling only, not rendered UI or the saved screenshots. Final verdict remains PASS for that layout.
