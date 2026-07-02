import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";
import { config } from "@/lib/config";
import { isPdfBuffer, processPdfFile } from "@/lib/pdf-pipeline";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  const courseId = req.nextUrl.searchParams.get("courseId") ?? undefined;
  const assignmentId = req.nextUrl.searchParams.get("assignmentId") ?? undefined;
  return NextResponse.json(await repo.getFiles({ courseId, assignmentId }));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    // ── Real binary upload ────────────────────────────────────────────────────
    const formData = await req.formData();
    const courseId = formData.get("courseId") as string;
    const assignmentId = formData.get("assignmentId") as string;
    const locale = (formData.get("locale") as "ar" | "en") ?? "en";
    const files = formData.getAll("files") as File[];

    if (!courseId || !assignmentId || files.length === 0) {
      return NextResponse.json({ error: "courseId, assignmentId, and at least one file are required" }, { status: 400 });
    }

    const repo = await getAdminRepo();
    const created = [];

    for (const file of files) {
      // Extension + MIME validation
      const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: `invalid_type: ${file.name}` }, { status: 400 });
      }
      if (file.size > config.maxUploadSizeMb * 1024 * 1024) {
        return NextResponse.json({ error: `file_too_large: ${file.name}` }, { status: 400 });
      }

      const arrBuf = await file.arrayBuffer();
      const buf = Buffer.from(arrBuf);

      // Magic-byte check
      if (!isPdfBuffer(buf)) {
        return NextResponse.json({ error: `not_a_pdf: ${file.name}` }, { status: 400 });
      }

      let storagePath = `course-files/${courseId}/${assignmentId}/${Date.now()}_${name}`;


      if (!config.isDemoMode && config.supabaseUrl && config.supabaseServiceRoleKey) {
        // Upload to private Supabase Storage
        const { createServiceClient } = await import("@/lib/supabase/server");
        const sb = await createServiceClient();
        const { error: uploadError } = await sb.storage.from("course-files").upload(storagePath, buf, {
          contentType: "application/pdf", upsert: false,
        });
        if (uploadError) {
          return NextResponse.json({ error: `storage_error: ${uploadError.message}` }, { status: 500 });
        }
      } else {
        // Demo: use a pseudo path (no actual upload)
        storagePath = `demo/${courseId}/${assignmentId}/${name}`;
      }

      const record = await repo.createFile({
        courseId, assignmentId, storagePath, fileName: name,
        sizeBytes: file.size, status: "uploaded",
      });
      const fileId = record.id;
      created.push(record);
      await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "upload_file", entityType: "source_file", entityId: fileId, metadata: { fileName: name, sizeBytes: file.size } });

      // Start async processing (non-blocking in production; awaited here to keep response manageable)
      // In production, offload to a queue/background worker.
      processPdfFile({ fileId, buf, fileName: name, courseId, assignmentId, locale, repo }).catch(console.error);
    }

    return NextResponse.json(created, { status: 201 });
  }

  // ── JSON metadata-only path (used by demo admin UI) ───────────────────────
  const body = await req.json();
  const { fileName, sizeBytes, courseId, assignmentId } = body;
  if (!fileName || !courseId || !assignmentId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const repo = await getAdminRepo();
  const record = await repo.createFile({
    courseId, assignmentId, storagePath: `demo/${courseId}/${assignmentId}/${fileName}`,
    fileName, sizeBytes: Number(sizeBytes ?? 0), status: "uploaded",
  });
  // Simulate processing for demo JSON-upload path
  const demoText = "(Demo) Sample extracted question. Please edit before publishing.";
  const { normalize } = await import("@/lib/search");
  await repo.createExtractedQuestion({
    sourceFileId: record.id, courseId, assignmentId, questionNumber: 1,
    questionText: demoText, normalizedText: normalize(demoText),
    answerText: "(Demo answer) Please review and edit.", confidence: 0.5, published: false,
  });
  await repo.updateFile(record.id, { status: "needs_review" });
  return NextResponse.json(record, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const body = await req.json();
  const { id, ...data } = body;
  const repo = await getAdminRepo();

  if (data.reprocess) {
    // Reprocess: fetch storage file, run pipeline again
    if (!config.isDemoMode && config.supabaseUrl) {
      const files = await repo.getFiles({});
      const f = files.find(f => f.id === id);
      if (f && f.storagePath) {
        const { createServiceClient } = await import("@/lib/supabase/server");
        const sb = await createServiceClient();
        const { data: dl } = await sb.storage.from("course-files").download(f.storagePath);
        if (dl) {
          const buf = Buffer.from(await dl.arrayBuffer());
          const locale = (body.locale as "ar" | "en") ?? "en";
          await repo.updateFile(id, { status: "processing" });
          processPdfFile({ fileId: id, buf, fileName: f.fileName, courseId: f.courseId, assignmentId: f.assignmentId, locale, repo }).catch(console.error);
          return NextResponse.json({ ok: true, status: "processing" });
        }
      }
    }
    const updated = await repo.updateFile(id, { status: "needs_review" });
    return NextResponse.json(updated);
  }

  const updated = await repo.updateFile(id, data);
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin("editor");
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const repo = await getAdminRepo();
  await repo.deleteFile(id);
  await repo.addAuditEntry({ adminId: guard.admin.id, adminEmail: guard.admin.email, action: "delete_file", entityType: "source_file", entityId: id });
  return NextResponse.json({ ok: true });
}
