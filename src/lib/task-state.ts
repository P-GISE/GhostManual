// 업무 한 줄의 상태와 지금 할 일. 업무 목록과 "내 문서함"이 같은 규칙을 쓴다.
export function taskState(work: {
  id: string;
  openQuestions: number;
  manualId: string | null;
  publishedVersion: number | null;
  needsReview: boolean;
  unpublishedChanges: boolean;
}) {
  const published = !!work.publishedVersion && !work.needsReview && !work.unpublishedChanges;
  const status = !work.manualId
    ? { label: "매뉴얼 없음", tone: "none" }
    : work.needsReview
      ? { label: "재검토 필요", tone: "review" }
      : work.unpublishedChanges
        ? { label: "미게시 변경", tone: "review" }
        : published
          ? { label: `게시됨 v${work.publishedVersion}`, tone: "done" }
          : { label: "검수 전", tone: "draft" };
  const action =
    work.openQuestions > 0
      ? { label: `답할 질문 ${work.openQuestions}개`, href: `/sources/${work.id}`, primary: true }
      : !work.manualId
        ? { label: "매뉴얼 만들기", href: `/sources/${work.id}`, primary: true }
        : !published
          ? { label: "검수하고 게시", href: `/manuals/${work.manualId}`, primary: false }
          : { label: "매뉴얼 보기", href: `/manuals/${work.manualId}`, primary: false };
  return { published, status, action, todo: !published || work.openQuestions > 0 };
}
