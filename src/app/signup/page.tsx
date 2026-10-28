import { SignupForm } from "../../components/AuthForm";
import { safeNextPath } from "../../lib/next-path";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <SignupForm google={Boolean(process.env["GOOGLE_CLIENT_ID"])} next={safeNextPath(next)} />
  );
}
