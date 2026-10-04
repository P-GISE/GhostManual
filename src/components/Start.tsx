"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";
export function Start() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start(mode: "blank" | "example") {
    setBusy(true);
    setError("");
    try {
      z.object({ expiresAt: z.string() }).parse(
        await http.post("/api/workspaces", { json: { mode } }).json(),
      );
      router.push("/manuals");
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <div className="start">
      <section>
        <span className="eyebrow">WORKSPACE / 업무 인수인계</span>
        <h1>
          담당자의 경험을,
          <br />
          다음 사람의 매뉴얼로.
        </h1>
        <p className="muted">
          업무 자료를 등록하고 내용을 직접 검수하세요.
          <br />
          후임자는 검수한 매뉴얼과 원본 근거를 함께 확인합니다.
        </p>
        <div className="notice">AI 초안은 검수 전까지 확정된 업무 규칙이 아닙니다.</div>
      </section>
      <section className="panel">
        <h2>작업 공간 시작</h2>
        <p>방문자별 임시 공간에서 업무 문서를 정리합니다.</p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => start("blank")}>
            빈 공간 시작
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => start("example")}
          >
            합성 예제 열기
          </button>
        </div>
        <p className="help">
          예제는 미리 작성된 합성 자료입니다. 실제 AI 생성 결과와 구분됩니다. 개인정보나 회사 기밀을
          입력하지 마세요.
        </p>
        {busy && <p role="status">작업 공간을 준비하고 있습니다.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
