import type { DocumentChange, DocumentQuestion } from "./types.ts";
export function documentQuestions(
  changes: readonly DocumentChange[],
  first: boolean,
): DocumentQuestion[] {
  if (first)
    return [
      { kind: "purpose", question: "이 문서는 어떤 업무에 사용하나요?", groupIndexes: [] },
      { kind: "origin", question: "문서의 작성 근거와 확인 방법은 무엇인가요?", groupIndexes: [] },
    ];
  const result: DocumentQuestion[] = [];
  const labels = { block_added: "추가", block_removed: "삭제", block_modified: "수정" };
  for (const kind of ["block_added", "block_removed", "block_modified"] as const) {
    const indexes = changes.flatMap((c, i) => (c.kind === kind ? [i] : []));
    if (!indexes.length) continue;
    const path = changes[indexes[0] ?? 0]?.path ?? "";
    // Only generated coordinates may enter questions that can later reach AI.
    const position = /^(?:body|section|slide|page|row)(?:\/(?:block|row|table|cell|\d+))*$/.test(
      path,
    )
      ? path.slice(0, 120)
      : "문서";
    result.push({
      kind: "change",
      question: `${position} 등 ${indexes.length}개 위치의 내용이 ${labels[kind]}되었습니다. 변경 이유와 업무에서 확인할 점은 무엇인가요?`,
      groupIndexes: indexes,
    });
  }
  return result;
}
