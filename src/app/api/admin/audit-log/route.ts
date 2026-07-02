import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const repo = await getAdminRepo();
  return NextResponse.json(await repo.getAuditLog(limit));
}
