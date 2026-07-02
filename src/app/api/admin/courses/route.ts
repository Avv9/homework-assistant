import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  const items = await repo.getCourses({});
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const repo = await getAdminRepo();
  const item = await repo.createCourse({ categoryId: body.categoryId, specializationId: body.specializationId || null, levelId: body.levelId || null, code: body.code || undefined, nameAr: body.nameAr, nameEn: body.nameEn, descriptionAr: body.descriptionAr || "", descriptionEn: body.descriptionEn || "", isActive: true });
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "create", entityType: "course", entityId: item.id, metadata: { nameEn: item.nameEn } });
  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const { id, ...data } = body;
  const repo = await getAdminRepo();
  const item = await repo.updateCourse(id, data);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();
  await repo.deleteCourse(id);
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "delete", entityType: "course", entityId: id });
  return NextResponse.json({ ok: true });
}
