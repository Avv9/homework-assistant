import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";

export default async function AdminIndex() {
  const session = await getAdminSession();
  redirect(session ? "/admin/dashboard" : "/admin/login");
}
