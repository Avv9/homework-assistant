import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";
import type { AdminRole } from "@/lib/types";

export async function GET() {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  return NextResponse.json(await repo.getAdmins());
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  if (!body.email || !body.role) {
    return NextResponse.json({ error: "email and role required" }, { status: 400 });
  }
  const validRoles: AdminRole[] = ["owner", "editor", "reviewer", "viewer"];
  if (!validRoles.includes(body.role as AdminRole)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  const repo = await getAdminRepo();
  const admin = await repo.createAdmin({ email: body.email, role: body.role as AdminRole, fullName: body.fullName });
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "create_admin", entityType: "admin", entityId: admin.id, metadata: { role: body.role, email: body.email } });
  return NextResponse.json(admin, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Owner cannot demote themselves
  if (id === guard.admin.id && data.role && data.role !== "owner") {
    return NextResponse.json({ error: "cannot_demote_self" }, { status: 400 });
  }
  const repo = await getAdminRepo();
  const updated = await repo.updateAdmin(id, data);
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "update_admin", entityType: "admin", entityId: id, metadata: data });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("owner");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === guard.admin.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }
  const repo = await getAdminRepo();
  await repo.deleteAdmin(id);
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "delete_admin", entityType: "admin", entityId: id });
  return NextResponse.json({ ok: true });
}
