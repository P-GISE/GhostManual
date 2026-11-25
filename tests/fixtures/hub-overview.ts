import { taskState } from "../../src/lib/task-state";

export const hubTeamId = "30000000-0000-4000-8000-000000000001";
export const hubPersonalId = "30000000-0000-4000-8000-000000000002";
export const hubWork = {
  id: "30000000-0000-4000-8000-000000000003",
  title: "합성 팀 업무",
  manualTitle: null,
  kind: "text" as const,
  fileType: null,
  provenance: null,
  revision: 1,
  createdByName: "합성 담당자",
  openQuestions: 0,
  manualId: null,
  publishedVersion: null,
  needsReview: false,
  unpublishedChanges: false,
};
export function hubOverview(ready = false, personal = false) {
  return {
    counts: { all: personal ? 2 : 1, todo: personal ? 2 : 1, published: 0 },
    nextTeamCursor: null,
    teams: [
      {
        id: hubTeamId,
        name: "합성 업무 팀",
        role: "admin" as const,
        leadReady: ready,
        lead: ready,
        memberCount: 1,
        current: true,
        workCount: 1,
        matchingCount: 1,
        nextWorkCursor: null,
        works: [{ ...hubWork }] satisfies [typeof hubWork],
      },
    ] satisfies [unknown],
    personal: personal
      ? {
          id: hubPersonalId,
          current: false,
          workCount: 1,
          matchingCount: 1,
          nextWorkCursor: null,
          works: [
            {
              ...hubWork,
              id: "30000000-0000-4000-8000-000000000004",
              title: "합성 개인 업무",
              createdByName: null,
            },
          ],
        }
      : null,
  };
}

export function filteredHub(
  url: string,
  view: Omit<ReturnType<typeof hubOverview>, "teams"> & {
    teams: ReturnType<typeof hubOverview>["teams"][number][];
  },
) {
  const params = new URL(url).searchParams;
  const query = (params.get("query") ?? "").trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
  const filter = params.get("filter") ?? "all";
  const select = <
    T extends {
      works: (Parameters<typeof taskState>[0] & { title: string; manualTitle: string | null })[];
      matchingCount: number;
    },
  >(
    group: T,
  ) => {
    const works = group.works.filter((work) => {
      const state = taskState(work);
      return (
        `${work.title} ${work.manualTitle ?? ""}`
          .normalize("NFKC")
          .toLocaleLowerCase("ko-KR")
          .includes(query) &&
        (filter === "all" || (filter === "todo" ? state.todo : state.published))
      );
    });
    return { ...group, works, matchingCount: works.length };
  };
  return {
    ...view,
    teams: view.teams
      .map(select)
      .filter((group) => (!query && filter === "all") || group.works.length),
    personal: view.personal ? select(view.personal) : null,
  };
}
