// 회사 양식 품질 측정(설계 10절): 합성 양식 3종 × 합성 업무 3건을 실제 AI로 돌린다.
// 실행: DATABASE_URL=<..._test> AI_ENABLED=true node --env-file-if-exists=.env scripts/measure-templates.ts
// AI 호출 12회(항목 정리 3, 초안 9). 테스트 DB에만 쓴다. 합성 자료만 보낸다.
import { pool } from "../src/lib/db.ts";
import { generateDraft } from "../src/lib/generation.ts";
import { createSource } from "../src/lib/sources.ts";
import { getTemplate, registerTemplate, runTemplateJob } from "../src/lib/template-extraction.ts";
import { readTemplate, updateTemplate } from "../src/lib/templates.ts";
import { newId } from "../src/lib/types.ts";
import { docx, pack, wp } from "../tests/fixtures/documents/native/build.ts";
import { setupFileMail, signedInUser } from "../tests/integration/mail-helper.ts";

if (!/_test$/.test(new URL(process.env["DATABASE_URL"] ?? "postgres://x/x").pathname))
  throw new Error("측정은 이름이 _test로 끝나는 DB에서만 실행합니다.");

const row = (...cells: string[]) =>
  `<w:tr>${cells.map((cell) => `<w:tc>${wp(cell)}</w:tc>`).join("")}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl>${rows.join("")}</w:tbl>`;
type Item = { name: string; guide: string; kind: "text" | "list" };
// expected: 사람이 보기에 맞는 항목. decoy: 어떤 업무 자료에도 근거가 없는 항목(비어 있어야 한다).
const templates: { name: string; body: string; expected: Item[]; decoy: string[] }[] = [
  {
    name: "표형 인계인수서",
    body:
      wp("업무 인계·인수서") +
      table(
        row("담당", "팀장", "부서장"),
        row("", "", ""),
        row("소속", "총무과", "작성일", "2026. 11. 18."),
        row("인계자", "홍길동", "인수자", "김철수"),
        row("인계 사유", ""),
        row("담당 업무 개요", ""),
        row("업무 처리 절차(순서대로)", ""),
        row("진행 중인 사항", ""),
        row("예산 집행 현황", ""),
        row("유의 사항", ""),
      ),
    expected: [
      { name: "인계 사유", guide: "", kind: "text" },
      { name: "담당 업무 개요", guide: "", kind: "text" },
      { name: "업무 처리 절차", guide: "순서대로", kind: "list" },
      { name: "진행 중인 사항", guide: "", kind: "list" },
      { name: "예산 집행 현황", guide: "", kind: "text" },
      { name: "유의 사항", guide: "", kind: "list" },
    ],
    decoy: ["예산 집행 현황", "인계 사유"],
  },
  {
    name: "문서형 업무 편람",
    body: [
      "○○공사 업무 편람",
      "제1장 업무 개요",
      "1. 업무의 목적 (이 업무를 왜 하는지 2~3문장으로 작성)",
      "2. 관련 규정 (근거가 되는 법령·내규의 이름을 나열)",
      "제2장 업무 수행",
      "3. 처리 주기와 시기",
      "4. 세부 처리 절차 (단계별로 작성)",
      "5. 사용 시스템과 권한",
      "제3장 점검",
      "6. 자주 발생하는 오류와 조치",
      "7. 완료 확인 방법",
      "작성자 서명:              (인)",
    ]
      .map(wp)
      .join(""),
    expected: [
      { name: "업무의 목적", guide: "이 업무를 왜 하는지 2~3문장으로 작성", kind: "text" },
      { name: "관련 규정", guide: "근거가 되는 법령·내규의 이름을 나열", kind: "list" },
      { name: "처리 주기와 시기", guide: "", kind: "text" },
      { name: "세부 처리 절차", guide: "단계별로 작성", kind: "list" },
      { name: "사용 시스템과 권한", guide: "", kind: "list" },
      { name: "자주 발생하는 오류와 조치", guide: "", kind: "list" },
      { name: "완료 확인 방법", guide: "", kind: "text" },
    ],
    decoy: ["관련 규정"],
  },
  {
    name: "민간형 인수인계 노트",
    body: [
      "인수인계 노트",
      "한 줄 요약",
      "매일/매주/매월 하는 일",
      "쓰는 도구와 계정 위치",
      "연락할 사람 (이름 말고 역할로)",
      "거래처별 특이 사항",
      "실수하기 쉬운 것",
    ]
      .map(wp)
      .join(""),
    expected: [
      { name: "한 줄 요약", guide: "", kind: "text" },
      { name: "매일/매주/매월 하는 일", guide: "", kind: "list" },
      { name: "쓰는 도구와 계정 위치", guide: "", kind: "list" },
      { name: "연락할 사람", guide: "이름 말고 역할로", kind: "list" },
      { name: "거래처별 특이 사항", guide: "", kind: "list" },
      { name: "실수하기 쉬운 것", guide: "", kind: "list" },
    ],
    decoy: ["거래처별 특이 사항"],
  },
];
const tasks = [
  {
    title: "월간 출장비 정산",
    text: "매월 5일까지 전월 출장비를 정산합니다. 직원이 그룹웨어 경비 메뉴에 올린 신청서와 영수증을 대조합니다.\n\n영수증 금액과 신청 금액이 다르면 신청자에게 반려하고 사유를 댓글로 남깁니다. 일치하면 회계 시스템에 전표를 입력합니다.\n\n전표 입력 후 팀장 결재가 끝나면 지급 요청을 올립니다. 지급일은 매월 10일입니다. 숙박비 상한을 넘는 건이 자주 반려됩니다.\n\n지급 요청 상태가 '지급 완료'로 바뀌고 신청자에게 알림이 가면 그 달 정산이 끝납니다.",
  },
  {
    title: "신규 입사자 장비 지급",
    text: "입사 확정 메일을 받으면 인사 담당자가 입사일 3일 전까지 노트북과 모니터를 준비합니다. 자산 관리 시스템에서 재고를 확인하고 없으면 구매 요청을 올립니다.\n\n노트북에는 표준 이미지를 설치하고 보안 프로그램 설치 여부를 확인합니다. 자산 번호 스티커를 붙이고 자산 관리 시스템에 사용자를 등록합니다.\n\n입사 당일 장비 수령 확인서에 서명을 받습니다. 서명받은 확인서를 스캔해 공유 드라이브의 자산 폴더에 올리면 완료입니다. 스티커를 붙이지 않고 지급하는 실수가 잦습니다.",
  },
  {
    title: "주간 재고 실사",
    text: "매주 금요일 오후에 창고 재고를 실사합니다. 재고 관리 프로그램에서 실사 목록을 출력해 선반 번호 순서대로 수량을 셉니다.\n\n프로그램 수량과 실제 수량이 다르면 차이를 목록에 적고 사진을 찍습니다. 차이가 10개 이상이면 창고 책임자에게 바로 알립니다.\n\n실사가 끝나면 차이 수량을 프로그램에 조정 입력하고 조정 사유를 적습니다. 조정 내역을 주간 보고에 붙여 운영 담당자에게 보내면 끝납니다. 유통기한이 임박한 품목을 따로 표시하지 않아 폐기가 늦어진 적이 있습니다.",
  },
];
const norm = (text: string) => text.replace(/[^가-힣a-z0-9]/gi, "");
const same = (a: string, b: string) => norm(a).includes(norm(b)) || norm(b).includes(norm(a));

const results: object[] = [];
try {
  const mail = setupFileMail();
  for (const template of templates) {
    // 초안 생성 한도가 문서함당 하루 5회라 양식마다 계정을 따로 쓴다.
    const { ctx } = await signedInUser(mail);
    const { id } = await registerTemplate(ctx, `${template.name}.docx`, pack(docx(template.body)));
    while (await runTemplateJob());
    const extraction = (await getTemplate(ctx, id))["extraction"] as {
      candidates: { candidateId: string; name: string }[];
    };
    const read = await readTemplate(
      ctx,
      id,
      extraction.candidates.map((candidate) => candidate.candidateId),
    );
    const matched = template.expected.filter((item) =>
      read.items.some((got) => same(got.name, item.name)),
    );
    results.push({
      stage: "read",
      template: template.name,
      candidates: extraction.candidates.length,
      expected: template.expected.length,
      extracted: read.items.length,
      matched: matched.length,
      missed: template.expected.filter((item) => !matched.includes(item)).map((item) => item.name),
      extra: read.items
        .filter((got) => !template.expected.some((item) => same(got.name, item.name)))
        .map((got) => got.name),
      kindWrong: matched.filter(
        (item) => read.items.find((got) => same(got.name, item.name))?.kind !== item.kind,
      ).length,
    });
    // 초안 측정은 항목 추출 결과와 섞이지 않게 사람이 정한 항목으로 확정한다.
    await updateTemplate(ctx, id, { items: template.expected });
    // MEASURE_READ_ONLY=1이면 항목 정리만 잰다(AI 3회).
    if (process.env["MEASURE_READ_ONLY"] === "1") continue;
    for (const task of tasks) {
      const source = await createSource(ctx, task);
      const generated = await generateDraft(ctx, {
        sourceId: source.id,
        expectedRevision: 1,
        key: newId(),
        templateId: id,
      });
      if (!("manual" in generated) || !("sections" in generated.manual.draft))
        throw new Error("양식 형태 초안이 아닙니다.");
      const sections = generated.manual.draft.sections;
      results.push({
        stage: "draft",
        template: template.name,
        task: task.title,
        items: sections.length,
        filled: sections.filter((section) => section.state === "filled").length,
        empty: sections.filter((section) => section.state === "empty").map((s) => s.name),
        ungrounded: sections
          .filter((s) => s.state === "filled" && template.decoy.includes(s.name))
          .map((s) => ({ name: s.name, text: s.text ?? s.items.join(" / ") })),
        references: generated.manual.draft.references.length,
        unknowns: generated.manual.draft.unknowns.length,
      });
    }
  }
} finally {
  for (const result of results) console.log(JSON.stringify(result));
  await pool.end();
}
