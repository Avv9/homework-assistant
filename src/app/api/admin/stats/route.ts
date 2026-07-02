import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  return NextResponse.json(await repo.getStats());
}
