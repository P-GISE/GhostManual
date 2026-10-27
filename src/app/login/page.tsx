import { LoginForm } from "../../components/AuthForm";

const notices: Record<string, string> = {
  invalid_link:
    "인증 링크가 만료됐거나 이미 사용됐습니다. 로그인하거나 인증 메일을 다시 받아 주세요.",
  unavailable: "인증을 처리하지 못했습니다. 잠시 후 다시 시도하세요.",
};
// Only same-site paths; "//host" or "/\host" would leave the site.
function safeNext(value: string | string[] | undefined) {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/manuals";
}
export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params["error"] === "string" ? params["error"] : "";
  return <LoginForm next={safeNext(params["next"])} notice={notices[error] ?? null} />;
}
