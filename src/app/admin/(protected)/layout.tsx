import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  return <AdminShell email={session.email}>{children}</AdminShell>;
}
