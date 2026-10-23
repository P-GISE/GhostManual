"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";
export function Start() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  async function verifySession(expiresAt: string) {
    setBusy(true);
    setError("");
    try {
      z.object({ role: z.literal("owner"), expiresAt: z.literal(expiresAt) }).parse(
        await http.get("/api/session", { cache: "no-store", timeout: 10000 }).json(),
      );
      router.push("/manuals");
    } catch {
      setError("작업 공간은 생성됐지만 이 브라우저에서 세션을 확인하지 못했습니다.");
      setBusy(false);
    }
  }
  async function start(mode: "blank" | "example") {
    setBusy(true);
    setError("");
    try {
      const workspace = z
        .object({ expiresAt: z.iso.datetime() })
        .parse(await http.post("/api/workspaces", { json: { mode } }).json());
      setCreated(workspace.expiresAt);
      await verifySession(workspace.expiresAt);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <div className="start">
      <section className="start-intro">
        <span className="eyebrow">업무 인수인계 문서함</span>
        <h1>
          업무를 남기고,
          <br />
          다음 사람에게 이어주세요.
        </h1>
        <p className="muted">
          업무 자료를 등록하고 내용을 직접 검수하세요.
          <br />
          후임자는 검수한 매뉴얼과 원본 근거를 함께 확인합니다.
        </p>
      </section>
      <section className="panel">
        <span className="eyebrow">시작하기</span>
        <h2>어떤 업무를 남길까요?</h2>
        <p>방문자별 임시 공간에서 업무 문서를 정리합니다.</p>
        <div className="start-actions">
          <button type="button" disabled={busy || created !== null} onClick={() => start("blank")}>
            빈 공간 시작
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || created !== null}
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
        {created && error && (
          <div>
            <p className="help">
              연결 상태를 확인한 뒤 세션을 다시 확인하세요. 앱 안에서 연 경우 메뉴에서 Safari 또는
              Chrome으로 이 주소를 열고 시작해 주세요. 브라우저마다 작업 공간이 다를 수 있습니다.
            </p>
            <button type="button" disabled={busy} onClick={() => verifySession(created)}>
              세션 다시 확인
            </button>
          </div>
        )}
      </section>
      <ol className="workflow" aria-label="매뉴얼 작성 과정">
        {[
          ["01", "자료 등록", "업무의 순서와 주의할 점을 원본으로 남깁니다."],
          ["02", "내용 검수", "담당자가 확인한 내용을 게시 버전으로 보존합니다."],
          ["03", "후임자에게 공유", "읽기 전용 문서와 원문 근거를 함께 전달합니다."],
        ].map(([number, title, description]) => (
          <li key={number}>
            <span className="step-number" aria-hidden="true">
              {number}
            </span>
            <div>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
