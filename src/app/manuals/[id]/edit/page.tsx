import { ManualEditor } from "../../../../components/ManualEditor";
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManualEditor id={id} />;
}
