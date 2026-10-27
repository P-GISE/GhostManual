"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http } from "../lib/client";
export function Start() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    http
      .get("/api/me", { cache: "no-store" })
      .json()
      .then((body) => {
        if (active) setSignedIn(z.object({ name: z.string() }).safeParse(body).success);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
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
        <p>가입하면 나만의 문서함에서 업무 문서를 정리합니다.</p>
        <div className="start-actions">
          {signedIn ? (
            <Link className="button" href="/manuals">
              내 문서함으로
            </Link>
          ) : (
            <>
              <Link className="button" href="/signup">
                시작하기
              </Link>
              <Link className="button secondary" href="/login">
                로그인
              </Link>
            </>
          )}
        </div>
        <p className="help">
          문서함에서 합성 예제를 불러와 기능을 먼저 살펴볼 수 있습니다. 개인정보나 회사 기밀을
          입력하지 마세요.
        </p>
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
