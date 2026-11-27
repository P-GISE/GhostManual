"use client";
import Link from "next/link";
import { useCurrentWorkspace } from "./Teams";
import { TemplateList } from "./TemplateList";

export function LegacyTemplates() {
  const workspace = useCurrentWorkspace();
  return (
    <section className="prose">
      <h1>기존 개인 양식</h1>
      {workspace === undefined ? (
        <p className="loading" role="status">
          문서함을 확인하고 있습니다.
        </p>
      ) : !workspace ? (
        <>
          <p className="error" role="alert">
            문서함을 확인하지 못했습니다. 새로고침하거나 내 문서함에서 다시 선택해 주세요.
          </p>
          <Link href="/library">내 문서함으로</Link>
        </>
      ) : workspace.name !== null ? (
        <>
          <p>
            현재 선택한 문서함은 {workspace.name}입니다. 팀 양식은 팀 화면에서 확인할 수 있습니다.
          </p>
          <Link href={`/teams/${workspace.id}?tab=forms`}>팀 양식 보기</Link>
          <p>
            <Link href="/library">내 문서함으로</Link>
          </p>
        </>
      ) : (
        <>
          <p>
            보관한 개인 양식은 계속 확인하고 수정할 수 있습니다. 새 양식은 팀 문서함에서 등록해
            주세요.
          </p>
          <Link href="/library">내 문서함으로</Link>
          <TemplateList allowUpload={false} />
        </>
      )}
    </section>
  );
}
