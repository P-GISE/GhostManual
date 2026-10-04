import { QuestionForm } from "../../components/QuestionForm";
export default function Page() {
  return (
    <div className="prose">
      <span className="eyebrow">ANSWER / 근거 답변</span>
      <h1>업무에 대해 질문하기</h1>
      <p className="muted">
        검수한 문서에서 업무 방법을 확인합니다. 미검수 초안은 답변 근거에 포함되지 않습니다.
      </p>
      <QuestionForm />
    </div>
  );
}
