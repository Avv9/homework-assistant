import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";
import { createServiceClient } from "@/lib/supabase/server";
import { mapSpecialization } from "@/lib/repo/mappers";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;

  const categoryId = req.nextUrl.searchParams.get("categoryId");

  if (categoryId) {
    const repo = await getAdminRepo();
    return NextResponse.json(await repo.getSpecializations(categoryId));
  }

  const db = await createServiceClient();
  const { data, error } = await db
    .from("specializations")
    .select("*")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map(mapSpecialization));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const repo = await getAdminRepo();

  const item = await repo.createSpecialization({
    categoryId: body.categoryId,
    nameAr: body.nameAr,
    nameEn: body.nameEn,
    isActive: true,
    sortOrder: body.sortOrder ?? 99,
  });

  await repo.addAuditEntry({
    adminId: guard.admin.id,
    adminEmail: guard.admin.email,
    action: "create",
    entityType: "specialization",
    entityId: item.id,
  });

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