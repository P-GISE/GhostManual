import { TeamPage } from "../../../components/TeamPage";
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamPage id={id} />;
}
