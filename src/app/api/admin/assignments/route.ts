import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  const courses = await repo.getCourses({});
  const all = await Promise.all(courses.map(c => repo.getAssignments(c.id)));
  return NextResponse.json(all.flat());
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const repo = await getAdminRepo();
  const item = await repo.createAssignment({ courseId: body.courseId, nameAr: body.nameAr, nameEn: body.nameEn, isActive: true });
  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const { id, ...data } = body;
  const repo = await getAdminRepo();
  const item = await repo.updateAssignment(id, data);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();
  await repo.deleteAssignment(id);
  return NextResponse.json({ ok: true });
}
