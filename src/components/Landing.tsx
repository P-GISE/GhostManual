const features = [
  [
    "업무 자료 등록",
    "업무 순서와 주의할 점을 원본 자료로 남깁니다. 고쳐도 이전 내용이 보존됩니다.",
    true,
  ],
  [
    "매뉴얼 작성·검수",
    "AI가 질문과 답변을 바탕으로 초안을 쓰고, 확인이 필요한 항목을 모두 확인해야 게시됩니다.",
    true,
  ],
  [
    "게시 버전 관리",
    "게시할 때마다 버전이 남고, 원본이 바뀌면 재검토 필요로 표시됩니다. 완성본은 PDF로 저장·인쇄합니다.",
    true,
  ],
  ["후임자 공유", "읽기 전용 링크로 공유하고 언제든 취소할 수 있습니다.", true],
  [
    "근거 확인 질문",
    "후임자가 채팅처럼 여러 번 물으면 AI가 검수된 매뉴얼 문단만 근거로 답합니다.",
    true,
  ],
  [
    "파일 버전 기록·변경 질문",
    "엑셀(.xlsx)을 올릴 때마다 버전으로 쌓고, 바뀐 시트·수식·값을 칸별로 기록한 뒤 AI가 바꾼 이유를 묻습니다.",
    true,
  ],
] as const;
export function Landing() {
  return (
    <div className="landing">
      <section aria-labelledby="landing-features">
        <h2 id="landing-features">GhostManual로 할 수 있는 일</h2>
        <ul className="feature-list" aria-label="GhostManual 기능">
          {features.map(([title, description, available]) => (
            <li key={title}>
              <span className={available ? "badge" : "badge upcoming"}>
                {available ? "사용 가능" : "준비 중"}
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="landing-example">
        <h2 id="landing-example">바뀐 부분은 이렇게 묻습니다</h2>
        <div className="change-example">
          <div className="change-example-head">
            <strong>구매요청_집계.xlsx · v1 → v2</strong>
            <span className="badge">예시</span>
          </div>
          <p className="change-line">
            &apos;원본&apos; F14 <del>SUM(F2:F13)</del> → <ins>SUBTOTAL(9,F2:F13)</ins>
          </p>
          <dl>
            <dt>질문</dt>
            <dd>F14 수식을 SUBTOTAL로 바꾼 이유는 무엇인가요?</dd>
            <dt>답변</dt>
            <dd>필터로 숨긴 행을 합계에서 빼려고</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
