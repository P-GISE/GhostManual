import type { ManualDraft } from "./schemas.ts";

export const exampleSource = {
  title: "신입 구성원 업무 계정 발급",
  text: "신입 구성원의 입사 일정이 확정되면 운영 담당자가 업무 계정을 발급합니다. 신청서에서 이름, 소속 팀, 입사일, 필요한 시스템을 확인합니다.\n\n팀 책임자의 승인을 확인한 뒤 요청된 시스템의 업무 계정을 발급합니다. 승인자가 부재하면 대체 승인 여부를 운영 담당자에게 확인하며 승인 전에는 발급하지 않습니다.\n\n신입 구성원이 최초 로그인에 성공하고 요청한 시스템에 접근할 수 있는지 확인하면 발급 업무를 완료합니다.",
};
export const exampleDraft: ManualDraft = {
  title: exampleSource.title,
  purpose: "신입 구성원이 업무에 필요한 시스템을 사용할 수 있게 합니다.",
  trigger: "입사 일정 확정",
  cadence: null,
  ownerRole: "운영 담당자",
  resources: ["신청서"],
  systems: [],
  steps: [
    "신청서에서 이름, 소속 팀, 입사일, 필요한 시스템을 확인합니다.",
    "팀 책임자의 승인을 확인한 뒤 요청된 시스템의 업무 계정을 발급합니다.",
    "최초 로그인과 요청 시스템 접근을 확인합니다.",
  ],
  warnings: ["승인 전에는 발급하지 않습니다."],
  exceptions: ["승인자가 부재하면 대체 승인 여부를 운영 담당자에게 확인합니다."],
  completion: "최초 로그인 및 요청한 시스템 접근 확인",
  unknowns: ["업무 주기는 미확인입니다."],
  references: [
    {
      field: "steps.0",
      paragraphId: "p1",
      quote: "신청서에서 이름, 소속 팀, 입사일, 필요한 시스템을 확인합니다.",
    },
  ],
};
