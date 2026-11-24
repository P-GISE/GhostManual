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
    teams: [
      {
        id: hubTeamId,
        name: "합성 업무 팀",
        role: "admin" as const,
        leadReady: ready,
        lead: ready,
        memberCount: 1,
        current: true,
        works: [hubWork],
      },
    ],
    personal: personal
      ? {
          id: hubPersonalId,
          current: false,
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
