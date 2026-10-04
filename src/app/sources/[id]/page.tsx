import { SourceDetail } from "../../../components/SourceDetail";
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SourceDetail id={id} />;
}
