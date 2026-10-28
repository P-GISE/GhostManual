import { WelcomeForm } from "../../components/AuthForm";
import { safeNextPath } from "../../lib/next-path";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return <WelcomeForm next={safeNextPath(next)} />;
}
