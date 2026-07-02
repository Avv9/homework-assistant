import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET() {
  const guard = await requireAdmin("reviewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  return NextResponse.json(await repo.getAiAnswers());
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("reviewer");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const repo = await getAdminRepo();
  if (body.action === "approve") {
    await repo.approveAiAnswer(body.id, body.answerText);
    await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "approve_ai_answer", entityType: "ai_generated_answer", entityId: body.id });
    return NextResponse.json({ ok: true });
  }
  const { id, ...data } = body;
  const item = await repo.updateAiAnswer(id, { ...data, reviewed: true });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("reviewer");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();
  await repo.deleteAiAnswer(id);
  return NextResponse.json({ ok: true });
}
