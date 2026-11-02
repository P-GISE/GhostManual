import Link from "next/link";

export const metadata = { title: "도움말 · GhostManual" };

const steps = [
  {
    who: "전임자",
    title: "업무 엑셀 등록",
    body: "자료 등록에서 업무에 쓰는 엑셀(.xlsx)을 올립니다. '어떤 업무용인지', '자료를 어디서 가져오는지' 두 질문에 답합니다.",
    where: "상단 자료 등록",
  },
  {
    who: "전임자",
    title: "작업을 마치면 새 버전 올리기",
    body: "같은 파일로 일을 마칠 때마다 그 자료 화면에서 '새 버전 올리기'를 누릅니다. 비슷한 이름의 파일을 자료 등록으로 올리면 새 버전인지 먼저 물어봅니다.",
    where: "자료 화면 › 새 버전 올리기",
  },
  {
    who: "전임자",
    title: "바뀐 부분 질문에 답하기",
    body: "이전 버전과 비교해 바뀐 시트·수식·값을 찾아 AI가 '왜 바꿨는지' 묻습니다. 칸별 변경(이전 값 → 새 값)도 확인할 수 있습니다. 답하지 않은 질문은 '확인 필요'로 남습니다.",
    where: "자료 화면 › 이번 버전 질문",
  },
  {
    who: "전임자",
    title: "매뉴얼 만들기",
    body: "'AI 초안 요청'을 누르면 지금까지의 질문과 답변으로 매뉴얼 초안을 씁니다. 직접 작성할 수도 있습니다. 답을 많이 할수록 초안이 정확해집니다.",
    where: "자료 화면 › 매뉴얼 만들기",
  },
  {
    who: "전임자",
    title: "검수하고 게시하기",
    body: "초안 내용과 '확인 필요' 항목을 모두 확인하고 '검수 완료·버전 게시'를 누릅니다. 게시한 버전만 후임자에게 보입니다.",
    where: "매뉴얼 화면 › 검수 완료·버전 게시",
  },
  {
    who: "후임자",
    title: "공유하고 물어보기",
    body: "매뉴얼에서 '링크가 있는 사용자 볼 수 있음'을 켜고 링크를 보냅니다. 후임자는 로그인 후 매뉴얼·변경 이력·원본을 보고, 아래 질문 창에서 여러 번 물어볼 수 있습니다.",
    where: "매뉴얼 화면 › 공유 설정, 질문 창",
  },
] as const;

const faqs = [
  [
    "자료 등록과 새 버전 올리기는 무엇이 다른가요?",
    "자료 등록은 새 업무 파일을 처음 올릴 때, 새 버전 올리기는 같은 파일의 다음 판을 올릴 때 씁니다. 새 버전으로 올려야 이전 버전과 비교해 바뀐 부분을 묻습니다.",
  ],
  [
    "'확인 필요'는 무엇인가요?",
    "아직 답하지 않은 질문이나 자료만으로는 알 수 없는 내용입니다. 게시하기 전에 모두 확인해야 합니다.",
  ],
  [
    "'미검수 초안'은 무엇인가요?",
    "저장만 하고 아직 검수·게시하지 않은 매뉴얼입니다. 후임자와 질문 답변에는 쓰이지 않습니다.",
  ],
  [
    "AI에는 무엇이 전송되나요?",
    "엑셀은 자료 제목·시트 이름·첫 행의 수식이 아닌 문자열·수식·바뀐 위치와 개수, 그리고 질문과 답변을 보냅니다. 첫 행 문자열과 답변에 개인정보나 기밀이 포함될 수 있습니다. 그 외 일반 데이터 셀 값과 원본 파일, 계정 이름·이메일·소속을 별도 항목으로 보내지는 않습니다. 자세한 내용은 개인정보 안내를 확인하세요.",
  ],
  [
    "저장 공간은 얼마나 되나요?",
    "엑셀 원본 기준 계정당 100 MB, 파일 하나는 5 MB까지입니다. 사용량은 계정 › 설정에서 볼 수 있습니다.",
  ],
] as const;

export default function Page() {
  return (
    <article className="prose help-page">
      <span className="eyebrow">도움말</span>
      <h1>GhostManual 이용 방법</h1>
      <p className="muted">
        전임자는 엑셀 작업을 마칠 때마다 올리고 질문에 답합니다. 쌓인 답변이 후임자가 따라 할 수
        있는 인수인계 매뉴얼이 됩니다.
      </p>
      <ol className="help-steps" aria-label="이용 순서">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="help-step-number" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <span className={s.who === "후임자" ? "badge" : "badge upcoming"}>{s.who}</span>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              <p className="help">어디서: {s.where}</p>
            </div>
          </li>
        ))}
      </ol>
      <h2>자주 묻는 질문</h2>
      {faqs.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
      <p className="help">
        더 궁금한 점은 <Link href="/privacy">개인정보 안내</Link>와{" "}
        <Link href="/terms">이용약관</Link>을 확인하세요.
      </p>
    </article>
  );
}
