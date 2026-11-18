"use client";
import { useEffect, useRef, useState } from "react";
import { QuestionForm } from "./QuestionForm";

// 매뉴얼 화면 어디서든 여는 질문 창. 닫아도 대화가 남도록 안쪽은 계속 붙어 있다.
export function ManualChat({
  manualId,
  reader,
  title,
}: {
  readonly manualId: string;
  readonly reader: boolean;
  readonly title: string;
}) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    // 좁은 화면에서는 창이 열린 동안 버튼이 숨겨지므로, 닫힌 화면이 그려진 뒤에 초점을 돌려준다.
    if (!open && wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
    if (!open) return;
    document.getElementById("question")?.focus();
    // 닫혀 있는 동안 쌓인 대화는 높이가 0이라 내려가지 못했으므로 열 때 맨 아래로 내린다.
    const log = document.querySelector(".chat-float .chat-log");
    log?.scrollTo({ top: log.scrollHeight });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <section className="chat-float" role="dialog" aria-label="이 매뉴얼에 질문" hidden={!open}>
        <header>
          <strong>{title}</strong>
          <button type="button" className="secondary" onClick={() => setOpen(false)}>
            닫기
          </button>
        </header>
        <QuestionForm manualId={manualId} reader={reader} />
      </section>
      <button
        ref={launcher}
        type="button"
        className="chat-launcher"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "질문 창 닫기" : "질문하기"}
      </button>
    </>
  );
}
