# 내 문서함 제한 조회 Implementation Plan

> For agentic workers: use superpowers:executing-plans. 원격 checkout만수정하고 구현담당별파일소유를지킨다.

**Goal:** 누락없는 제한조회와전역검색/필터.
**Architecture:** 서버 two-level keyset page, 화면교체형탐색.
**Tech Stack:** 기존PostgreSQL/TypeScript/React/Zod/Playwright, 새의존성/migration없음.
**Spec:** docs/superpowers/specs/2026-11-24-overview-pagination-design.md

## Global Constraints
팀20·업무10, RR인증/013/014/개인/공유유지, 운영/014미실행, S1테스트금지.
## Review Focus
검색결과가뒤page에만있음; cursor위조로타인metadata조회; microsecond동률누락; 늦은검색/페이지응답덮어쓰기; 조회실패후입력손실.

### Task1 서버 API
- [x] tests/integration/overview.test.ts에query422·상한·tie-break·전역검색·커서권한test추가, 구코드GHA RED확인.
- [x] src/lib/overview.ts·src/app/api/overview/route.ts boundedSQL/cursor검증구현.
- [x] RR회귀유지·실제DB GREEN.
### Task2 화면
- [x] tests/e2e/hub-safety.spec.ts·fixtures에paging/검색응답테스트추가하고GHA RED확인.
- [x] Hub.tsx contract·서버검색·paging·pending/failure/stale응답처리.
- [ ] 기존hub/a11y API형식업데이트하고desktop/mobile/tablet검증.
### Task3 최종
- [ ] 코드독립검토·전체CI·합성화면직접검토.
- [ ] PROJECT_GUIDE·문서가이드·해야할일·구현기록업데이트. 별도PR, 병합/배포/014미실행.
