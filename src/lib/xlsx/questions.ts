import type { ChangeGroup, RuleQuestion } from "./types.ts";

function shortText(value: string, length: number): string {
  return value.slice(0, length).replace(/[\uD800-\uDBFF]$/, "");
}

function questionText(group: ChangeGroup): string {
  const sheet = shortText(group.sheet ?? "", 40);
  const range = group.range ?? "";
  const before =
    typeof group.summary["before"] === "string" ? shortText(group.summary["before"], 80) : "";
  const after =
    typeof group.summary["after"] === "string" ? shortText(group.summary["after"], 80) : "";
  switch (group.kind) {
    case "sheet_added":
      return `시트 '${sheet}'은 무엇을 위해 만들었나요?`;
    case "sheet_removed":
      return `시트 '${sheet}'을 지운 이유는 무엇인가요?`;
    case "formula_added":
      return `'${sheet}' ${range}에 넣은 수식 \`${after}\`은 무엇을 계산하나요?`;
    case "formula_changed":
      return `'${sheet}' ${range}의 수식을 \`${before}\`에서 \`${after}\`로 바꾼 이유는 무엇인가요?`;
    case "formula_removed":
      return `'${sheet}' ${range}의 수식 \`${before}\`을 지운 이유는 무엇인가요?`;
    case "filter_changed":
      return `'${sheet}'의 필터 조건을 바꾼 기준은 무엇인가요?`;
    case "names_changed":
      return "이름 정의를 바꾼 이유는 무엇인가요?";
    case "size_changed":
      return `'${sheet}'의 행·열 수가 바뀐 이유는 무엇인가요?`;
    case "values_changed":
      return `'${sheet}'에서 바뀐 값 ${group.summary["count"]}개는 어떤 작업이었나요?`;
    default: {
      const exhaustive: never = group.kind;
      return exhaustive;
    }
  }
}

export function buildQuestions(
  groups: readonly ChangeGroup[] | null,
  first: boolean,
): RuleQuestion[] {
  if (first)
    return [
      { kind: "purpose", groupIndexes: [], question: "이 파일은 어떤 업무를 위한 것인가요?" },
      { kind: "origin", groupIndexes: [], question: "자료는 어디서 가져왔나요?" },
    ];
  if (groups === null)
    return [{ kind: "other", groupIndexes: [], question: "이번 버전에서 무엇을, 왜 바꿨나요?" }];
  const individualCount = groups.length > 10 ? 9 : groups.length;
  const questions: RuleQuestion[] = groups.slice(0, individualCount).map((group, index) => ({
    kind: "change",
    groupIndexes: [index],
    question: questionText(group),
  }));
  if (groups.length > 10)
    questions.push({
      kind: "other",
      groupIndexes: groups.slice(9).map((_, index) => index + 9),
      question: `나머지 변경 ${groups.length - 9}건은 어떤 작업이었나요?`,
    });
  return questions;
}
