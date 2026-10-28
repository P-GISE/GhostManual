import { LoginForm } from "../../components/AuthForm";
import { safeNextPath } from "../../lib/next-path";

const notices: Record<string, string> = {
  invalid_link:
    "인증 링크가 만료됐거나 이미 사용됐습니다. 로그인하거나 인증 메일을 다시 받아 주세요.",
  unavailable: "인증을 처리하지 못했습니다. 잠시 후 다시 시도하세요.",
  google_failed: "구글 로그인을 완료하지 못했습니다. 다시 시도하세요.",
  google_unavailable: "구글 로그인이 아직 설정되지 않았습니다. 이메일로 로그인하세요.",
  rate_limit: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
};
export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error, next } = await searchParams;
  return (
    <LoginForm
      next={safeNextPath(next)}
      notice={(typeof error === "string" && notices[error]) || null}
      google={Boolean(process.env["GOOGLE_CLIENT_ID"])}
    />
  );
}
