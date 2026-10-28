import { SignupForm } from "../../components/AuthForm";

export const dynamic = "force-dynamic";

export default function Page() {
  return <SignupForm google={Boolean(process.env["GOOGLE_CLIENT_ID"])} />;
}
