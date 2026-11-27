# 문서 초기 조회 왕복 축소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** 권한 경계를 유지하면서 등록 metadata2회→1회, 문서 읽기9회→7회를 검증한다.
**Architecture:** route 수명의 context와 단일 transaction의 revisions/latest opt-in. 기존 상세/폴링과 Reader 게시 snapshot 유지.
**Tech Stack:** 기존 React/Next/PostgreSQL/Playwright/GitHub Actions, 새 의존성 없음.
**Spec:** [설계](../specs/2026-11-27-document-read-roundtrips-design.md)

## Global Constraints
운영·014·AI·실메일·S1/로컬 빌드 금지. 원본/공유/권한·기존2초 polling 유지.

## Review Focus
- 이전 route의 늦은 metadata/bootstrap 응답이 현재 화면을 덮지 않는가.
- Reader에 미게시 답변/원문/다른 revision이 노출되지 않는가.
- 이름 갱신과 실패 입력 차단이 유지되는가.
- 초기 요청 통합 뒤 수동 버전 선택·새버전·재처리·폴링이 정상인가.
- 작은 localhost 기준선을 운영/대형파일 전체 성능으로 확대하지 않는가.

### Task1: 실패 재현과 최소 구현
- [ ] 기존 API route와 실제 DB/브라우저로 metadata1회·bootstrap 동등성 RED 확인.
- [ ] CurrentWorkspace provider·layout/Teams 연결, 이전 route 응답 차단.
- [ ] 목록 helper의 첫 상세 재사용·preview helper·includeLatest opt-in, Reader 검사 보존.
- [ ] FileVersions 최초 effect만 통합하고 cleanup/generation으로 늦은 응답 차단.
- [ ] 전체 CI와 native3형식30표본 재측정·원시 재계산·독립 검토 후 PR.

### Task2: 기록
- [ ] PR121 병합/기준선과 새 요청 수/지연/미측정 한계를 가이드에 반영.
운영 반영과 새 PR 병합은 하지 않는다. 진행/실행 근거는 후속 PR 최신 head를 따른다.
