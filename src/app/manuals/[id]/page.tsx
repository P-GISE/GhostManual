import { ManualDetail } from "../../../components/ManualDetail";
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManualDetail id={id} />;
}
