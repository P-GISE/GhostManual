// 이어지는 질문 품질 측정(플로팅 질문 창 설계 10절): 합성 매뉴얼 3건에 첫 질문 1개와 이어지는 질문 4개씩.
// 실행: DATABASE_URL=<..._test> AI_ENABLED=true AI_DAILY_LIMIT=1000 node --env-file-if-exists=.env scripts/measure-rewrite.ts
// AI 호출은 많아야 27회(첫 질문 3, 이어지는 질문 12 × 2). 테스트 DB에만 쓴다. 합성 자료만 보낸다.
import { ask } from "../src/lib/answers.ts";
import { pool } from "../src/lib/db.ts";
import { publishManual, saveDraft } from "../src/lib/manuals.ts";
import { retrieve } from "../src/lib/retrieval.ts";
import type { DefaultDraft } from "../src/lib/schemas.ts";
import { createWorkspace, requireSession } from "../src/lib/session.ts";
import { createSource } from "../src/lib/sources.ts";

if (!/_test$/.test(new URL(process.env["DATABASE_URL"] ?? "postgres://x/x").pathname))
  throw new Error("측정은 이름이 _test로 끝나는 DB에서만 실행합니다.");

// evidence: 맞는 답이라면 근거나 답에 들어 있어야 할 말. null이면 매뉴얼에 답이 없는 질문이다(근거 부족이 맞다).
type Turn = { question: string; evidence: string | null };
const draft = (
  title: string,
  purpose: string,
  steps: string[],
  completion: string,
): DefaultDraft => ({
  title,
  purpose,
  trigger: null,
  cadence: null,
  ownerRole: null,
  resources: [],
  systems: [],
  steps,
  warnings: [],
  exceptions: [],
  completion,
  unknowns: [],
  references: [],
});
const manuals: { title: string; text: string; draft: DefaultDraft; first: Turn; follow: Turn[] }[] =
  [
    {
      title: "월간 출장비 정산",
      text: "매월 5일까지 전월 출장비를 정산합니다. 직원이 그룹웨어 경비 메뉴에 올린 신청서와 영수증을 대조합니다.\n\n영수증 금액과 신청 금액이 다르면 신청자에게 반려하고 사유를 댓글로 남깁니다. 일치하면 회계 시스템에 전표를 입력합니다.\n\n전표 입력 후 팀장 결재가 끝나면 지급 요청을 올립니다. 지급일은 매월 10일입니다. 숙박비 상한을 넘는 건이 자주 반려됩니다.\n\n지급 요청 상태가 '지급 완료'로 바뀌고 신청자에게 알림이 가면 그 달 정산이 끝납니다.",
      draft: draft(
        "월간 출장비 정산",
        "전월 출장비를 매월 5일까지 정산합니다.",
        ["그룹웨어 경비 메뉴의 신청서와 영수증을 대조합니다.", "회계 시스템에 전표를 입력합니다."],
        "지급 요청 상태가 지급 완료로 바뀌면 끝납니다.",
      ),
      first: { question: "출장비 정산은 언제까지 해야 하나요?", evidence: "5일" },
      follow: [
        { question: "그건 누가 승인해?", evidence: "팀장" },
        { question: "돈은 언제 나가?", evidence: "10일" },
        { question: "그 사람이 없으면 어떻게 해?", evidence: null },
        { question: "반려는 어떤 때 해?", evidence: "금액" },
      ],
    },
    {
      title: "신규 입사자 장비 지급",
      text: "입사 확정 메일을 받으면 인사 담당자가 입사일 3일 전까지 노트북과 모니터를 준비합니다. 자산 관리 시스템에서 재고를 확인하고 없으면 구매 요청을 올립니다.\n\n노트북에는 표준 이미지를 설치하고 보안 프로그램 설치 여부를 확인합니다. 자산 번호 스티커를 붙이고 자산 관리 시스템에 사용자를 등록합니다.\n\n입사 당일 장비 수령 확인서에 서명을 받습니다. 서명받은 확인서를 스캔해 공유 드라이브의 자산 폴더에 올리면 완료입니다. 스티커를 붙이지 않고 지급하는 실수가 잦습니다.",
      draft: draft(
        "신규 입사자 장비 지급",
        "신규 입사자에게 노트북과 모니터를 지급합니다.",
        ["자산 관리 시스템에서 재고를 확인합니다.", "노트북에 표준 이미지를 설치합니다."],
        "수령 확인서를 스캔해 자산 폴더에 올리면 완료입니다.",
      ),
      first: { question: "신규 입사자 장비는 언제까지 준비하나요?", evidence: "3일" },
      follow: [
        { question: "재고가 없으면?", evidence: "구매 요청" },
        { question: "거기에 뭘 깔아야 해?", evidence: "표준 이미지" },
        { question: "받은 사람한테는 뭘 받아?", evidence: "서명" },
        { question: "퇴사자 장비는 어떻게 회수해?", evidence: null },
      ],
    },
    {
      title: "주간 재고 실사",
      text: "매주 금요일 오후에 창고 재고를 실사합니다. 재고 관리 프로그램에서 실사 목록을 출력해 선반 번호 순서대로 수량을 셉니다.\n\n프로그램 수량과 실제 수량이 다르면 차이를 목록에 적고 사진을 찍습니다. 차이가 10개 이상이면 창고 책임자에게 바로 알립니다.\n\n실사가 끝나면 차이 수량을 프로그램에 조정 입력하고 조정 사유를 적습니다. 조정 내역을 주간 보고에 붙여 운영 담당자에게 보내면 끝납니다. 유통기한이 임박한 품목을 따로 표시하지 않아 폐기가 늦어진 적이 있습니다.",
      draft: draft(
        "주간 재고 실사",
        "매주 창고 재고의 수량을 확인합니다.",
        ["실사 목록을 출력해 선반 번호 순서대로 수량을 셉니다.", "차이 수량을 조정 입력합니다."],
        "조정 내역을 주간 보고에 붙여 운영 담당자에게 보내면 끝납니다.",
      ),
      first: { question: "재고 실사는 언제 하나요?", evidence: "금요일" },
      follow: [
        { question: "수량이 안 맞으면 어떻게 해?", evidence: "사진" },
        { question: "많이 차이 나면 누구한테 말해?", evidence: "책임자" },
        { question: "끝나면 그걸 누구한테 보내?", evidence: "운영 담당자" },
        { question: "입사 확정 메일은 누가 보내나요?", evidence: null },
      ],
    },
  ];

const results: object[] = [];
try {
  for (const manual of manuals) {
    // 질문 한도가 문서함당 하루 20회라 매뉴얼마다 문서함을 따로 쓴다.
    const owner = await requireSession((await createWorkspace()).token);
    const source = await createSource(owner, { title: manual.title, text: manual.text });
    const saved = await saveDraft(owner, source.revisionId, manual.draft);
    await publishManual(owner, saved.id, 1, []);
    const after: string[] = [];
    for (const [index, turn] of [manual.first, ...manual.follow].entries()) {
      // 고쳐 쓰지 않았다면: 원래 질문만으로 검색했을 때 맞는 근거가 잡히는지(AI 호출 없음).
      const rawFound =
        turn.evidence !== null &&
        (await retrieve(owner, turn.question, saved.id)).some((c) =>
          c.quote.includes(turn.evidence ?? ""),
        );
      const started = Date.now();
      const result = await ask(
        owner,
        { question: turn.question, manualId: saved.id, ...(after.length ? { after } : {}) },
        crypto.randomUUID(),
      );
      const text = [
        result.answer,
        ...result.procedure.map((step) => step.text),
        ...result.evidence.map((item) => item.quote),
      ].join(" ");
      results.push({
        manual: manual.title,
        turn: index,
        question: turn.question,
        understoodAs: result.understoodAs,
        status: result.status,
        expectAnswer: turn.evidence !== null,
        // 답이 있어야 하는 질문이면 맞는 말이 답이나 근거에 있는지, 없어야 하는 질문이면 근거 부족인지.
        correct:
          turn.evidence === null
            ? result.status === "insufficient"
            : result.status !== "insufficient" && text.includes(turn.evidence),
        rawFound,
        ms: Date.now() - started,
        answer: result.answer.slice(0, 160),
      });
      after.push(result.id);
      if (after.length > 3) after.shift();
    }
  }
} finally {
  for (const result of results) console.log(JSON.stringify(result));
  await pool.end();
}
