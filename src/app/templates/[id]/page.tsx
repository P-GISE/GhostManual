import { TemplateDetail } from "../../../components/TemplateDetail";
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateDetail id={id} />;
}
