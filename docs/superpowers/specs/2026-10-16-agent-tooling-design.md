# GhostManual 개발 도구 구성

사용자가 9개 upstream 검토·적용을 요청했고 제시한 구성과 별도 브랜치·검증·PR 방식에 2026-10-16 “진행해”로 승인했다.

## 범위

앱의 Next.js·PostgreSQL·OpenAI SDK와 개발 도구를 분리한다. Node 24, Python 3.12, uv, GNU Make를 사용하는 Linux/macOS/WSL 개발 환경이 대상이다.
Superpowers는 기본 개발 절차, PM Skills는 기획, Ponytail은 재사용·간소화 보조로 구성한다. LazyCodex는 대체 오케스트레이션으로 선택 설치한다. 겹치는 절차는 동시에 강제하지 않는다.
CodeGraph MCP와 로컬 인덱스, Iron Laws CLI와 PR 검사, Strix 수동 검사를 제공한다. OmniRoute와 Headroom은 개발자의 선택 실행 서비스다.

## 파일과 검증

`tools/versions.mk`는 직접 버전과 plugin Git ref를 고정한다. `tools/Makefile`은 `.dev-tools/`에 CLI를 설치하고 실행하며 `.codex/config.toml`은 CodeGraph MCP를 등록한다.
Iron Laws PR workflow는 비밀 없이 실행하고 검사 실패와 도구 오류를 모두 실패로 처리한다. Strix workflow는 수동 실행이며 secret·Docker·LLM 예산이 필요하다.
AGENTS와 도구 가이드에 충돌 우선순위·설치 범위·연결 및 복구 방법을 기록한다. 인덱스·보고서·도구는 Git과 배포 이미지에서 제외한다.
Make dry-run, TOML/YAML 파싱, 실제 CLI 설치·help·인덱싱·Iron Laws 검사와 앱 unit/lint/typecheck/build를 검증한다. LLM 자격증명이 필요한 실 호출은 별도 상태로 기록한다.

## 제약

사용자 Codex 설치에 대한 plugin 변경은 `plugins` 또는 `lazycodex` 명령으로 명시한다. sandbox·승인 정책·모델·인증·제품 AI_ENABLED를 자동 변경하지 않는다. provider 계정·사용 가능 무료 한도는 사용자가 직접 연결한다.
