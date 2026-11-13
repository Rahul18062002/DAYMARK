import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/context";

export default async function Home() {
  const state = await getSessionState();
  redirect(state ? "/dashboard" : "/login");
}
