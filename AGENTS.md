# GhostManual 작업 지침

먼저 PROJECT_GUIDE.md와 docs/00_문서_가이드.md를 읽고, 구현 작업은 상세 설계·구현 계획·docs/구현_진행_기록.md를 함께 확인한다.
사용자 지시와 승인 이력은 파일의 기본 절차보다 우선한다. 완료된 작업을 기억만으로 재실행하지 말고 파일·실행 결과·Git 이력을 확인한다.
현재는 AI 비활성 공개 데모 배포·검증 완료 후 후속 작업 단계다. 기준 commit·현재/과거 상태·검증 출처는 PROJECT_GUIDE.md를 따른다. 완료된 검증/배포를 이유 없이 반복하지 않고 AI·계정·예산은 별도 지시 전 범위 제외로 유지한다. 제품 기능의 실제 존재는 코드·기록으로 확인한다. source·manual·answer, 검수 여부·revision·workspace 권한을 구분한다.
기존 서비스·다른 작업자의 변경을 되돌리지 않는다. 비밀 값·토큰·개인 연락처는 문서·로그·Git에 기록하지 않는다.

## GitHub 협업 규칙

사람과 AI 도구(Claude Code·Codex) 모두 같은 규칙을 따른다. Codex는 이 파일을, Claude Code는 이 파일을 불러오는 CLAUDE.md를 읽는다. 규칙은 이 파일에서만 고친다.

### 작업 시작
- `git fetch` 후 최신 기본 브랜치 `feat/ghostmanual-mvp`에서 새 브랜치를 만든다.
- 열린 PR을 확인해 같은 파일을 고치는 작업이 있으면 먼저 팀에 알린다.
- 브랜치 이름은 `feat/`·`fix/`·`docs/`·`design/`·`chore/` 뒤에 짧은 영문 설명을 붙인다.
- 한 브랜치는 한 사람(과 그 사람의 AI 도구)만 push한다. 다른 사람의 브랜치에 push·force-push하지 않는다.

### 커밋
- 메시지는 `type: 요약` 형식이다. type은 feat·fix·docs·design·test·chore 중 하나다. 요약은 한국어나 영어로 쓴다.
- 커밋 작성자는 작업을 맡은 사람의 git 계정이다. AI 도구의 공동 작성자(`Co-Authored-By`)나 생성 도구 문구는 커밋·PR에 넣지 않는다.
- `.env`, 비밀 값, 실제 업무 자료, 자동 생성 파일(`next-env.d.ts`의 dev 경로 변경 등)은 커밋하지 않는다.

### PR과 병합
- 기본 브랜치에 직접 push하지 않고 PR로 반영한다.
- PR 본문에는 요약, 배경, 영향 범위, 검증(실행한 명령과 결과), 팀 확인이 필요한 부분을 쓴다.
- **병합은 박기성과 박효민이 할 수 있다.** 자기 PR도 CI 통과와 내용 확인 후 병합할 수 있다.
- CI가 통과한 뒤 병합한다. 병합 전에 PR 작성자가 최신 기본 브랜치를 반영하고 충돌을 해결한다.
- 다른 사람의 PR은 작성자 동의 없이 닫거나 수정하지 않는다. AI 도구는 사람이 병합을 지시한 PR만 병합한다.

### AI 도구 사용
- AI가 만든 변경도 사람이 내용을 확인한 뒤 커밋·PR한다.
- 제품 방향·범위를 바꾸는 결정은 docs/00_문서_가이드.md 결정 기록에 남기고 PR에 팀 확인 필요로 표시한다.
- 도구별 개인 설정(개인 CLAUDE.md, Codex 설정)은 저장소에 올리지 않는다.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
