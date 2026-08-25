import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;

  const { admin } = guard;
  return NextResponse.json({
    ok: true,
    admin: {
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
    },
  });
}
