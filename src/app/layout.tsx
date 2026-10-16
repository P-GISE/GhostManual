import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import "./responsive.css";
import { Navigation } from "../components/Navigation";
export const metadata: Metadata = {
  title: "GhostManual · 업무 인수인계",
  description: "원본을 근거로 검수하고 공유하는 업무 매뉴얼",
};
export default function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip" href="#main">
          본문으로 이동
        </a>
        <Navigation />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer>
          <span>원본 → 검수 매뉴얼 → 근거 답변</span>
          <div>
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy">개인정보 안내</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
