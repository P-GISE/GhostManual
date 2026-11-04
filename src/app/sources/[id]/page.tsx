import { SourceDetail } from "../../../components/SourceDetail";
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ upload?: string }>;
}) {
  const { id } = await params;
  // The library card's "새 버전 올리기" opens the upload form directly.
  return <SourceDetail id={id} upload={(await searchParams).upload === "1"} />;
}
