import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";
import { createServiceClient } from "@/lib/supabase/server";
import { mapLevel } from "@/lib/repo/mappers";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;

  const db = await createServiceClient();
  const { data, error } = await db
    .from("levels")
    .select("*")
    .order("number");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map(mapLevel));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const repo = await getAdminRepo();

  const item = await repo.createLevel({
    specializationId: body.specializationId,
    number: Number(body.number),
    nameAr: body.nameAr,
    nameEn: body.nameEn,
    isActive: true,
  });

  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const { id, ...data } = body;
  const repo = await getAdminRepo();

  const item = await repo.updateLevel(id, data);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();

  await repo.deleteLevel(id);
  return NextResponse.json({ ok: true });
}