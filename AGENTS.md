# GhostManual 작업 지침

먼저 PROJECT_GUIDE.md와 docs/00_문서_가이드.md를 읽고, 구현 작업은 상세 설계·구현 계획·docs/구현_진행_기록.md를 함께 확인한다.
사용자 지시와 승인 이력은 파일의 기본 절차보다 우선한다. 완료된 작업을 기억만으로 재실행하지 말고 파일·실행 결과·Git 이력을 확인한다.
현재는 승인된 구현 계획 실행 단계다. 제품 기능이 존재한다고 가정하지 않는다. source·manual·answer, 검수 여부·revision·workspace 권한을 구분한다.
기존 서비스·다른 작업자의 변경을 되돌리지 않는다. 비밀 값·토큰·개인 연락처는 문서·로그·Git에 기록하지 않는다.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
