# Agent Tooling Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 승인한 9개 도구를 재현 가능한 프로젝트 개발 설정과 보안 검사로 제공한다.

**Architecture:** 앱 의존성과 분리된 Make 설정, 고정된 직접 버전, project CodeGraph MCP, 별도 보안 workflows.

**Tech Stack:** GNU Make, Node 24, Python 3.12, uv, Codex CLI, GitHub Actions.

**Spec:** [도구 설계](../specs/2026-10-16-agent-tooling-design.md)

## Global Constraints

- 제품 코드·AI_ENABLED·인증·sandbox 정책을 변경하지 않는다.
- 도구·인덱스·보고서·자격증명은 Git과 배포 이미지에서 제외한다.
- 직접 실행은 이번 사용자 승인 범위이며 기존 제품 CI를 유지한다.

## Review Focus

1. plugin이 사용자 전역에 설치된다는 사실과 다른 프로젝트 영향.
2. 스캐너의 발견 종료 코드와 실행 오류를 구분하고 숨기지 않는지.
3. 수동 Strix에 secret이 없거나 fork PR에 secret을 제공하는 경로.
4. 두 압축 계층·두 오케스트레이터의 중복 활성화.
5. 로컬 경로·공백 경로·Docker 빌드에 도구가 섞이는 경우.

## Task 1: 개발 도구 구성

**Files:** tools/Makefile, tools/versions.mk, .codex/config.toml, .gitignore, .dockerignore.
**Interfaces:** `make -f tools/Makefile install|plugins|lazycodex|index|check|report|strix|gateway|headroom|doctor`.
- [x] 직접 버전과 Git ref 확인, 기존 unit baseline 실행.
- [x] 구성 파일 작성 후 Make dry-run·TOML 파싱과 실제 설치·CLI help·인덱싱 확인.

## Task 2: 보안 CI와 운영 가이드

**Files:** .github/workflows/iron-laws.yml, .github/workflows/strix.yml, AGENTS.md, docs/개발_도구_가이드.md, README.md, docs/구현_진행_기록.md.
**Interfaces:** Task 1의 고정 버전·실행 명령 사용.
- [x] Iron Laws PR 검사·수동 Strix workflow와 9개 도구 사용 가이드 작성.
- [x] YAML 파싱·actionlint·Iron Laws 실제 실행 결과 확인.
- [x] 앱 unit/lint/typecheck/build와 독립 리뷰. 실제 호출이 막힌 항목은 진행 기록에 기록. 커밋·PR 결과는 GitHub 이력에서 확인한다.
