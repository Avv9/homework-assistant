import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("reviewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  const fileId = req.nextUrl.searchParams.get("fileId") ?? undefined;
  return NextResponse.json(await repo.getExtractedQuestions({ sourceFileId: fileId }));
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("reviewer");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const repo = await getAdminRepo();
  if (Array.isArray(body.publishQuestionIds)) {
    const ids = body.publishQuestionIds
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 500);

    for (const id of ids) {
      await repo.updateExtractedQuestion(id, { published: true });
    }

    await repo.addAuditEntry({
      adminId: guard.admin.id,
      adminEmail: guard.admin.email,
      action: "publish_selected_questions",
      entityType: "extracted_question",
      metadata: { count: ids.length },
    });
    return NextResponse.json({ ok: true, count: ids.length });
  }

  if (Array.isArray(body.deleteQuestionIds)) {
    const ids = body.deleteQuestionIds
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 500);

    for (const id of ids) {
      await repo.deleteExtractedQuestion(id);
    }

    await repo.addAuditEntry({
      adminId: guard.admin.id,
      adminEmail: guard.admin.email,
      action: "delete_selected_questions",
      entityType: "extracted_question",
      metadata: { count: ids.length },
    });
    return NextResponse.json({ ok: true, count: ids.length });
  }

  if (body.publishAllForFile) {
    await repo.publishQuestionsForFile(body.publishAllForFile);
    await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "publish_all", entityType: "source_file", entityId: body.publishAllForFile });
    return NextResponse.json({ ok: true });
  }
  const { id, ...data } = body;
  const item = await repo.updateExtractedQuestion(id, data);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("reviewer");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();
  await repo.deleteExtractedQuestion(id);
  return NextResponse.json({ ok: true });
}
