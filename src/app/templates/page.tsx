import { redirect } from "next/navigation";

// 예전 주소. 목록은 내 문서함과 팀 화면의 탭으로 옮겼다.
export default function Page() {
  redirect("/library");
}
