import { SignupForm } from "../../components/AuthForm";
export default function Page() {
  return <SignupForm google={Boolean(process.env["GOOGLE_CLIENT_ID"])} />;
}
