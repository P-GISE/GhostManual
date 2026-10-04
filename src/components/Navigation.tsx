"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Navigation() {
  const reader = usePathname() === "/share";
  return (
    <header className="shell-header">
      <Link className="brand" href={reader ? "/share" : "/"}>
        GhostManual<span>업무를 남기는 문서함</span>
      </Link>
      {reader ? (
        <span className="badge">읽기·질문 전용 공유</span>
      ) : (
        <nav aria-label="주 메뉴">
          <Link href="/manuals">문서함</Link>
          <Link href="/sources/new">자료 등록</Link>
          <Link href="/ask">질문하기</Link>
        </nav>
      )}
    </header>
  );
}
