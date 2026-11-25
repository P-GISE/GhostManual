"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http } from "../lib/client";

// 화면을 본뜬 예시 조각. 이름과 숫자는 모두 지어낸 것이다.
function Shot({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <figure className="lp-shot">
      <figcaption>
        {title} <span className="badge">예시</span>
      </figcaption>
      <div className="lp-shot-body">{children}</div>
    </figure>
  );
}
function Work({
  type,
  name,
  meta,
  status,
  tone,
}: {
  readonly type: string;
  readonly name: string;
  readonly meta: string;
  readonly status: string;
  readonly tone: "done" | "review" | "draft";
}) {
  return (
    <div className="lp-row">
      <span className={`task-icon ${type === "TXT" ? "text" : "file"}`} aria-hidden="true">
        {type}
      </span>
      <span className="lp-row-main">
        <strong>{name}</strong>
        <span className="help">{meta}</span>
      </span>
      <span className={`task-status ${tone}`}>{status}</span>
    </div>
  );
}

export function Landing() {
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
  const actions = signedIn ? (
    <Link className="button" href="/library">
      내 문서함으로
    </Link>
  ) : (
    <>
      <Link className="button" href="/signup">
        팀 문서함 만들기
      </Link>
      <Link className="button secondary" href="/login">
        로그인
      </Link>
    </>
  );
  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-hero-text">
          <span className="eyebrow">팀의 업무 인수인계 문서함</span>
          <h1>
            업무를 남기고,
            <br />
            다음 사람에게 이어주세요.
          </h1>
          <p className="lp-lead">
            평소 쓰던 업무 파일을 올리면 AI가 원문 근거를 붙여 인수인계 매뉴얼 초안을 씁니다. 팀이
            함께 쓰고, 사람이 바뀌어도 자료는 팀에 남습니다.
          </p>
          <div className="actions">{actions}</div>
          <p className="help">
            구글 계정이나 이메일로 가입합니다. 혼자 쓰는 경우에도 팀을 하나 만들어 씁니다.
          </p>
        </div>
        <Shot title="내 문서함">
          <p className="lp-team">
            <strong>재무팀</strong> <span className="badge">관리자</span>{" "}
            <span className="help">팀원 4명 · 업무 3개</span>
          </p>
          <Work
            type="XLSX"
            name="월간 거래처 정산"
            meta="올린 사람 김지원 · 버전 2개"
            status="답할 질문 2개"
            tone="review"
          />
          <Work
            type="HWP"
            name="법인카드 한도 변경"
            meta="올린 사람 이도윤"
            status="검수 전"
            tone="draft"
          />
          <Work
            type="TXT"
            name="월간 출장비 정산"
            meta="올린 사람 박효민"
            status="게시됨 v1"
            tone="done"
          />
          <p className="lp-team">
            <strong>신제품 출시 프로젝트</strong> <span className="badge">팀원</span>{" "}
            <span className="help">팀원 6명 · 업무 2개</span>
          </p>
          <Work
            type="PPT"
            name="통큰세일 홍보 담당"
            meta="올린 사람 박효민"
            status="게시됨 v2"
            tone="done"
          />
        </Shot>
      </section>

      <section aria-labelledby="lp-problem">
        <span className="eyebrow">담당자가 바뀔 때마다</span>
        <h2 id="lp-problem">인수인계 문서는 늘 급하게, 처음부터 다시 씁니다.</h2>
        <ul className="lp-pains">
          <li>
            <h3>처음부터 다시 씁니다</h3>
            <p>업무는 파일에 다 있는데, 인수인계 문서는 빈 양식에서 새로 시작합니다.</p>
          </li>
          <li>
            <h3>빠진 내용을 모릅니다</h3>
            <p>급하게 쓴 문서에서 무엇이 빠졌는지는 후임자가 일을 하다가 알게 됩니다.</p>
          </li>
          <li>
            <h3>물어볼 사람이 없습니다</h3>
            <p>전임자가 떠난 뒤에는 "이건 왜 이렇게 하나요?"를 물을 곳이 없습니다.</p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="lp-flow">
        <span className="eyebrow">이렇게 씁니다</span>
        <h2 id="lp-flow">파일을 올리는 것으로 시작해, 후임자의 질문까지.</h2>
        <ol className="lp-steps" aria-label="GhostManual을 쓰는 순서">
          <li>
            <div className="lp-step-text">
              <span className="lp-step-no" aria-hidden="true">
                01
              </span>
              <h3>팀 문서함을 만들고 함께 쓸 사람을 초대합니다</h3>
              <p>
                부서나 프로젝트마다 팀을 만듭니다. 여러 팀에 속해 있어도 내 문서함 한 화면에서 모든
                팀의 업무와 상태를 봅니다.
              </p>
              <ul>
                <li>이메일로 초대하고, 관리자와 부관리자가 팀을 관리합니다</li>
                <li>나가거나 계정을 지워도 올린 자료는 팀에 남습니다</li>
              </ul>
            </div>
            <Shot title="팀원·초대">
              <div className="lp-row">
                <span className="lp-field">초대할 사람의 이메일</span>
                <span className="lp-fake-button">초대 메일 보내기</span>
              </div>
              <div className="lp-row">
                <span className="lp-row-main">
                  <strong>박효민 (나)</strong>
                </span>
                <span className="badge">관리자</span>
              </div>
              <div className="lp-row">
                <span className="lp-row-main">
                  <strong>김지원</strong>
                  <span className="help">재무 1파트</span>
                </span>
                <span className="badge">부관리자</span>
              </div>
              <div className="lp-row">
                <span className="lp-row-main">
                  <strong>최서연</strong>
                  <span className="help">후임자 · 11월 20일 합류</span>
                </span>
                <span className="badge">팀원</span>
              </div>
            </Shot>
          </li>
          <li>
            <div className="lp-step-text">
              <span className="lp-step-no" aria-hidden="true">
                02
              </span>
              <h3>평소 쓰던 업무 파일을 그대로 올립니다</h3>
              <p>
                인수인계용 문서를 따로 쓰지 않습니다. 같은 업무의 새 파일을 올리면 이전 버전과
                달라진 곳을 찾아, 인수인계에 필요한 내용을 담당자에게 묻습니다.
              </p>
              <p className="lp-formats">
                <span className="visually-hidden">올릴 수 있는 파일: </span>
                {["엑셀", "한글", "워드", "PPT", "PDF", "CSV", "텍스트"].map((format) => (
                  <span key={format} className="badge">
                    {format}
                  </span>
                ))}
              </p>
              <p className="help">
                스캔한 PDF는 글자 인식 결과를 원본과 대조하라는 안내가 붙습니다.
              </p>
            </div>
            <Shot title="구매요청_집계.xlsx · v1 → v2">
              <dl className="lp-pairs">
                <dt>달라진 곳</dt>
                <dd>
                  &apos;원본&apos; F14 <del>SUM(F2:F13)</del> → <ins>SUBTOTAL(9,F2:F13)</ins>
                </dd>
                <dt>질문</dt>
                <dd>F14 수식을 SUBTOTAL로 바꾼 이유는 무엇인가요?</dd>
                <dt>담당자의 답</dt>
                <dd>필터로 숨긴 행을 합계에서 빼려고</dd>
              </dl>
            </Shot>
          </li>
          <li>
            <div className="lp-step-text">
              <span className="lp-step-no" aria-hidden="true">
                03
              </span>
              <h3>AI가 근거를 붙여 초안을 쓰고, 담당자가 검수해 게시합니다</h3>
              <p>
                회사에서 쓰는 인수인계 양식을 올리면 그 양식의 항목 순서대로 채웁니다. 원문에 근거가
                없는 항목은 채우지 않고 담당자에게 묻습니다.
              </p>
              <ul>
                <li>초안의 내용에는 원문의 어느 문단에서 왔는지 인용이 붙습니다</li>
                <li>미확인 항목을 확인해야 게시할 수 있고, 게시할 때마다 버전이 남습니다</li>
              </ul>
            </div>
            <Shot title="월간 출장비 정산 · 양식: 업무 인계인수서">
              <dl className="lp-pairs">
                <dt>담당 업무 개요</dt>
                <dd>
                  매월 5일까지 전월 출장비를 정산합니다. <span className="lp-cite">원본 p1</span>
                </dd>
                <dt>업무 처리 절차</dt>
                <dd>
                  신청서와 영수증을 대조합니다. <span className="lp-cite">원본 p1</span>
                  <br />
                  금액이 다르면 반려하고 사유를 남깁니다. <span className="lp-cite">원본 p2</span>
                </dd>
              </dl>
              <p className="lp-unknown">
                <strong>채우지 못한 항목 2개</strong> · 인계 사유, 예산 집행 현황
                <br />
                답하거나 "해당 없음"으로 표시해야 게시할 수 있습니다.
              </p>
            </Shot>
          </li>
          <li>
            <div className="lp-step-text">
              <span className="lp-step-no" aria-hidden="true">
                04
              </span>
              <h3>후임자는 매뉴얼에 바로 묻습니다</h3>
              <p>
                매뉴얼 화면의 질문 창에서 물으면 검수된 매뉴얼과 원본에서 근거를 찾아 답합니다.
                앞에서 물은 것에 이어서 물을 수 있습니다.
              </p>
              <ul>
                <li>답마다 근거가 된 문단이 함께 나옵니다</li>
                <li>자료에 없는 것은 지어내지 않고 "근거 부족"으로 답합니다</li>
              </ul>
            </div>
            <Shot title="질문하기">
              <p className="lp-ask">일치하면요?</p>
              <p className="lp-answer">
                <span className="help">
                  이렇게 이해했습니다: 영수증 금액과 신청 금액이 일치하면 어떻게 해요?
                </span>
                회계 시스템에 전표를 입력합니다. <span className="lp-cite">매뉴얼 v1 · p3</span>
              </p>
              <p className="lp-ask">숙박비 상한은 얼마예요?</p>
              <p className="lp-answer">
                <span className="task-status review">근거 부족</span>
                상한이 있다는 언급만 있고 금액은 자료에 없습니다. 담당자에게 확인해 주세요.
              </p>
            </Shot>
          </li>
        </ol>
      </section>

      <section className="lp-trust" aria-labelledby="lp-trust">
        <span className="eyebrow">AI가 쓴 글을 믿어도 되나요</span>
        <h2 id="lp-trust">지어내지 못하게 만들었습니다.</h2>
        <ul className="lp-rules">
          <li>
            <h3>인용을 서버가 다시 확인합니다</h3>
            <p>AI가 붙인 인용이 원문에 실제로 있는 문장인지 서버가 대조한 뒤에 저장합니다.</p>
          </li>
          <li>
            <h3>모르는 것은 비워 둡니다</h3>
            <p>근거가 없는 항목은 채우지 않고 "미확인 항목"으로 남겨 담당자에게 묻습니다.</p>
          </li>
          <li>
            <h3>사람이 검수해야 게시됩니다</h3>
            <p>후임자가 보는 것은 담당자가 확인하고 게시한 버전뿐입니다.</p>
          </li>
          <li>
            <h3>답에는 근거가 붙습니다</h3>
            <p>질문의 답은 검수된 문단에서만 찾고, 없으면 "근거 부족"이라고 답합니다.</p>
          </li>
        </ul>
        <dl className="lp-measure">
          <div>
            <dd>12칸 중 0칸</dd>
            <dt>근거 없는 항목을 AI가 채운 수</dt>
          </div>
          <div>
            <dd>19개 중 19개</dd>
            <dt>양식에서 찾아낸 항목</dt>
          </div>
          <div>
            <dd>12개 중 11개</dd>
            <dt>이어지는 질문에 맞게 답한 수</dt>
          </div>
        </dl>
        <p className="lp-note">
          2026년 11월, 직접 만든 합성 양식 3종과 합성 업무 3건으로 한 번씩 잰 값입니다. 실제 회사
          자료로 잰 값이 아닙니다.
        </p>
      </section>

      <section aria-labelledby="lp-team">
        <span className="eyebrow">팀으로 씁니다</span>
        <h2 id="lp-team">사람이 바뀌어도 업무는 팀에 남습니다.</h2>
        <ul className="lp-roles">
          <li>
            <span className="badge">관리자</span>
            <h3>팀을 책임집니다</h3>
            <p>
              부관리자를 지정하고, 떠날 때는 관리자를 다른 사람에게 넘깁니다. 팀은 관리자만 지울 수
              있습니다.
            </p>
          </li>
          <li>
            <span className="badge">부관리자</span>
            <h3>함께 관리합니다</h3>
            <p>팀원을 초대하고 내보냅니다.</p>
          </li>
          <li>
            <span className="badge">팀원</span>
            <h3>올리고, 쓰고, 묻습니다</h3>
            <p>
              팀의 모든 업무를 보고, 새 버전을 올리고, 매뉴얼을 쓰고 게시합니다. 후임자도 팀원으로
              초대받습니다.
            </p>
          </li>
        </ul>
      </section>

      <section className="lp-final" aria-labelledby="lp-final">
        <h2 id="lp-final">첫 업무 파일 하나로 시작해 보세요.</h2>
        <p className="lp-lead">
          가입하고 팀 문서함을 만든 뒤 파일을 올리면 됩니다. 합성 예제로 먼저 둘러볼 수도 있습니다.
        </p>
        <div className="actions">
          {signedIn ? (
            <Link className="button" href="/library">
              내 문서함 열기
            </Link>
          ) : (
            <Link className="button" href="/signup">
              가입하고 시작하기
            </Link>
          )}
          <Link className="button secondary" href="/help">
            도움말 보기
          </Link>
        </div>
        <p className="help">
          개인정보나 회사 기밀이 담긴 자료는 올리기 전에 가려 주세요. AI 기능을 쓰면 필요한 원문이
          외부 AI 제공자에게 전송될 수 있습니다.
        </p>
      </section>
    </div>
  );
}
