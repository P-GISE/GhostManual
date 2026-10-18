"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Navigation() {
  const pathname = usePathname();
  const reader = pathname === "/share";
  return (
    <header className="shell-header">
      <Link className="brand" href={reader ? "/share" : "/"}>
        GhostManual<span>업무를 남기는 문서함</span>
      </Link>
      {reader ? (
        <span className="badge">읽기·질문 전용 공유</span>
      ) : (
        <nav aria-label="주 메뉴">
          {[
            { href: "/manuals", label: "문서함" },
            { href: "/sources/new", label: "자료 등록" },
            { href: "/ask", label: "질문하기" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              data-active={href === "/manuals" ? pathname.startsWith(href) : pathname === href}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
