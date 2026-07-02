import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  return NextResponse.json(await repo.getSpecializations(""));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const repo = await getAdminRepo();
  const item = await repo.createSpecialization({ categoryId: body.categoryId, nameAr: body.nameAr, nameEn: body.nameEn, isActive: true, sortOrder: body.sortOrder ?? 99 });
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "create", entityType: "specialization", entityId: item.id });
  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const { id, ...data } = body;
  const repo = await getAdminRepo();
  const item = await repo.updateSpecialization(id, data);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();
  await repo.deleteSpecialization(id);
  return NextResponse.json({ ok: true });
}
