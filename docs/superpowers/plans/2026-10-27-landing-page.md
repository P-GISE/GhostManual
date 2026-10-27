# 랜딩 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 첫 화면(`/`)에서 GhostManual이 무엇을 하는 서비스인지, 지금 쓸 수 있는 기능과 준비 중인 기능이 무엇인지 한눈에 보이게 한다.

**Architecture:** 로그인 전까지는 기존 `Start`(작업 공간 시작 버튼)를 첫 화면 위쪽에 그대로 두고, 아래에 정적 서버 컴포넌트 `Landing`(기능 목록·변경 질문 예시)을 붙인다. `Start`의 세션 처리 코드는 바꾸지 않는다. 로그인 구현 때 `Start`의 버튼 영역만 가입·로그인 버튼으로 바꾼다.

**Tech Stack:** Next.js 16 App Router, React 19, 기존 `globals.css`·`responsive.css`, Playwright 접근성 설정(`playwright.accessibility.config.ts`, DB 불필요).

**Spec:** `docs/superpowers/specs/2026-10-23-landing-login-design.md` 5.1절

## Global Constraints

- 간결하게: 한 화면 반 정도. 장식 이미지·그라데이션·광고형 히어로 없음(`DESIGN.md`).
- 아직 없는 기능은 "준비 중"으로 표시하고 되는 것처럼 쓰지 않는다. 상태는 색만이 아니라 글자로 표시한다.
- 기존 시작 버튼 `빈 공간 시작`은 데스크톱·태블릿·모바일 첫 화면 안에 보여야 한다(기존 검사 유지).
- 가로 넘침 없음(390px 포함).
- 기존 `Start` 세션·진단 동작과 이를 검사하는 session·transport·E2E 테스트를 깨지 않는다.

## Review Focus

- 390px 모바일에서 기능 카드와 예시 카드의 긴 한국어·코드 문구가 가로로 넘친다 → 줄바꿈되고 페이지 가로 스크롤이 없어야 한다. (Task 1 검사)
- 기능 목록이 길어져 시작 버튼이 첫 화면 밖으로 밀린다 → 시작 버튼이 계속 첫 화면 안에 있어야 한다. (기존 검사 유지)
- 상태를 색으로만 구분 → "사용 가능"/"준비 중" 글자가 있어야 한다. (Task 1 검사)
- 제목 구조가 깨져 화면 낭독기 탐색이 어렵다 → h1 하나, 섹션은 h2, 카드는 h3. (Task 1 검사)
- 준비 중 기능 예시를 실제 화면으로 오해 → 예시 카드에 "예시 · 준비 중 기능" 표시. (Task 1 검사)

---

### Task 1: 기능 목록·변경 질문 예시 섹션

**Files:**
- Create: `src/components/Landing.tsx`
- Modify: `src/app/page.tsx` (`<Start />` 아래에 `<Landing />`)
- Modify: `src/app/globals.css` (`.workflow p` 규칙 뒤에 `.landing` 관련 규칙), `src/app/responsive.css` (960px·760px 구간)
- Test: `tests/accessibility/design.spec.ts`

**Interfaces:**
- Produces: `export function Landing(): JSX.Element` (서버 컴포넌트, props 없음). 로그인 작업은 `Start`만 바꾸고 `Landing`은 그대로 쓴다.

- [ ] **Step 1: 실패하는 검사 작성** — `tests/accessibility/design.spec.ts`에 추가

```ts
test("home lists available and upcoming features in text", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const features = page.getByRole("list", { name: "GhostManual 기능" }).getByRole("listitem");
  await expect(features).toHaveCount(6);
  await expect(features.filter({ hasText: "사용 가능" })).toHaveCount(5);
  await expect(
    features.filter({ has: page.getByRole("heading", { level: 3, name: "파일 버전 기록·변경 질문" }) }),
  ).toContainText("준비 중");
  await expect(page.getByText("예시 · 준비 중 기능")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run build && npx playwright test --config playwright.accessibility.config.ts -g "available and upcoming"`
Expected: FAIL (`GhostManual 기능` 목록 없음)

- [ ] **Step 3: `Landing` 구현**

구성(문구 확정):
- 섹션 1 `h2` "GhostManual로 할 수 있는 일", `ul aria-label="GhostManual 기능"`, 카드 6개(`h3` 제목, 설명, 상태 배지):
  1. 업무 자료 등록 — 사용 가능 — 업무 순서와 주의할 점을 원본 자료로 남깁니다. 고쳐도 이전 내용이 보존됩니다.
  2. 매뉴얼 작성·검수 — 사용 가능 — 자료를 바탕으로 매뉴얼을 쓰고, 확인이 필요한 항목을 모두 확인해야 게시됩니다.
  3. 게시 버전 관리 — 사용 가능 — 게시할 때마다 버전이 남고, 원본이 바뀌면 재검토 필요로 표시됩니다.
  4. 후임자 공유 — 사용 가능 — 읽기 전용 링크로 공유하고 언제든 취소할 수 있습니다.
  5. 근거 확인 질문 — 사용 가능 — 질문하면 관련 매뉴얼 문단을 근거와 함께 찾아 줍니다. AI 답변은 연결 전입니다.
  6. 파일 버전 기록·변경 질문 — 준비 중 — 엑셀 등 작업 파일을 올리면 이전 버전과 비교해 바뀐 부분의 이유를 묻습니다.
- 섹션 2 `h2` "바뀐 부분은 이렇게 묻습니다", 라벨 "예시 · 준비 중 기능", 카드 하나: 파일 `구매요청_집계.xlsx` v1 → v2, 변경 `'원본' F14 SUM(F2:F13) → SUBTOTAL(9,F2:F13)`, 질문 "F14 수식을 SUBTOTAL로 바꾼 이유는 무엇인가요?", 답변 "필터로 숨긴 행을 합계에서 빼려고".
- 상태 배지는 기존 `.badge`, 준비 중은 `.badge.upcoming`(테두리만, 글자색 `--muted`).

- [ ] **Step 4: CSS** — 카드 그리드 3열(데스크톱) → 2열(≤960px) → 1열(≤760px). 예시 카드의 코드 줄은 `overflow-wrap: anywhere`. 토큰은 기존 `--border`·`--surface`·`--muted`·`--radius`만 사용.

- [ ] **Step 5: 통과 확인**

Run: `npm run build && npm run test:accessibility` (로컬은 `A11Y_CHROMIUM_PATH`에 Chrome 경로)
Expected: 새 검사 3개 프로젝트 통과, 기존 `starting a workspace is visible without scrolling` 포함 전체 통과

- [ ] **Step 6: lint·타입**

Run: `npm run lint && npm run typecheck`
Expected: 오류 0

- [ ] **Step 7: Commit**

```bash
git add src/components/Landing.tsx src/app/page.tsx src/app/globals.css src/app/responsive.css tests/accessibility/design.spec.ts docs/superpowers/plans/2026-10-27-landing-page.md
git commit -m "feat: 첫 화면에 기능 목록과 변경 질문 예시 추가"
```
