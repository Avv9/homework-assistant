"use client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeFetch(url: string, fallback: any = []): Promise<any> {
  try {
    const res = await fetch(url);
    if (res.status === 401) { window.location.href = "/admin/login"; return fallback; }
    if (!res.ok) return fallback;
    const data = await res.json();
    if (Array.isArray(fallback) && !Array.isArray(data)) return fallback;
    return data ?? fallback;
  } catch { return fallback; }
}

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Alert } from "@/components/ui/primitives";
import { UploadCloud, Trash2, RotateCcw, FileSearch } from "lucide-react";
import Link from "next/link";
import type { Assignment, Course, SourceFile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const STATUS_VARIANT: Record<string, "outline" | "ai" | "success"> = {
  uploaded: "outline", processing: "outline", needs_review: "ai", published: "success", failed: "outline",
};

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: "queued" | "preparing" | "uploading" | "finalizing" | "done" | "failed";
  message?: string;
};

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readableUploadError(error: string, details?: Record<string, unknown>) {
  if (error === "file_too_large") return `File is larger than the configured limit (${details?.maxUploadSizeMb ?? "?"} MB).`;
  if (error === "invalid_type") return "Only PDF files are accepted.";
  if (error === "signed_upload_error") return `Could not prepare storage upload${details?.message ? `: ${details.message}` : "."}`;
  if (error === "direct_upload_unavailable") return "Direct upload is not configured. Check Supabase environment variables.";
  if (error === "unauthenticated") return "Your admin session expired. Please sign in again.";
  if (error === "forbidden") return "Your admin account does not have permission to upload files.";
  return error || "Upload failed.";
}

export default function FilesPage() {
  const { t, locale } = useLocale();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courseId, setCourseId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    safeFetch("/api/admin/files", []).then(setFiles);
    safeFetch("/api/admin/courses", []).then((cs: Course[]) => {
      setCourses(cs);
      if (!courseId && cs[0]) setCourseId(cs[0].id);
    });
    safeFetch("/api/admin/assignments", []).then(setAssignments);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const courseAssignments = assignments.filter(a => a.courseId === courseId);

  const upload = async (fileList: FileList | null) => {
    if (!fileList || !courseId || !assignmentId) {
      setUploadError("Please select a course and assignment first.");
      return;
    }
    const selectedFiles = Array.from(fileList);
    if (selectedFiles.length === 0) return;

    setUploadError(null);
    setUploadItems(selectedFiles.map(file => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      status: "queued",
    })));
    setUploading(true);

    const setItem = (id: string, patch: Partial<UploadItem>) => {
      setUploadItems(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
    };

    try {
      const supabase = createClient();
      for (const file of selectedFiles) {
        const id = `${file.name}-${file.size}-${file.lastModified}`;
        try {
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            setItem(id, { status: "failed", message: "Only PDF files are accepted." });
            continue;
          }

          setItem(id, { status: "preparing", message: "Preparing upload..." });
          const prepRes = await fetch("/api/admin/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_signed_upload",
              courseId,
              assignmentId,
              locale,
              fileName: file.name,
              sizeBytes: file.size,
              contentType: file.type || "application/pdf",
            }),
          });
          const prep = await prepRes.json().catch(() => ({}));
          if (!prepRes.ok) {
            setItem(id, { status: "failed", message: readableUploadError(prep.error, prep.details) });
            continue;
          }

          setItem(id, { status: "uploading", message: "Uploading to storage..." });
          const { error: uploadStorageError } = await supabase.storage
            .from(prep.bucket)
            .uploadToSignedUrl(prep.storagePath, prep.token, file, {
              contentType: file.type || "application/pdf",
            });
          if (uploadStorageError) {
            setItem(id, { status: "failed", message: uploadStorageError.message });
            continue;
          }

          setItem(id, { status: "finalizing", message: "Saving file record..." });
          const finishRes = await fetch("/api/admin/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "finalize_signed_upload",
              courseId,
              assignmentId,
              locale,
              storagePath: prep.storagePath,
              fileName: file.name,
              sizeBytes: file.size,
            }),
          });
          const finish = await finishRes.json().catch(() => ({}));
          if (!finishRes.ok) {
            setItem(id, { status: "failed", message: readableUploadError(finish.error, finish.details) });
            continue;
          }

          setItem(id, { status: "done", message: "Uploaded. Processing started." });
        } catch (e) {
          setItem(id, { status: "failed", message: e instanceof Error ? e.message : "Upload failed." });
        }
      }
      load();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const reprocess = async (id: string) => {
    await fetch("/api/admin/files", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reprocess: true, locale }) });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/files?id=${id}`, { method: "DELETE" });
    load();
  };

  const cName = (id: string) => { const c = courses.find(c => c.id === id); return c ? (locale === "ar" ? c.nameAr : c.nameEn) : ""; };
  const aName = (id: string) => { const a = assignments.find(a => a.id === id); return a ? (locale === "ar" ? a.nameAr : a.nameEn) : ""; };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.files.title")}</h1>

      <Card className="mb-6">
        <CardContent className="space-y-3 pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={courseId} onChange={e => { setCourseId(e.target.value); setAssignmentId(""); }}>
              {courses.map(c => <option key={c.id} value={c.id}>{locale === "ar" ? c.nameAr : c.nameEn}</option>)}
            </select>
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={assignmentId} onChange={e => setAssignmentId(e.target.value)}>
              <option value="">--</option>
              {courseAssignments.map(a => <option key={a.id} value={a.id}>{locale === "ar" ? a.nameAr : a.nameEn}</option>)}
            </select>
          </div>
          {uploadError && <Alert variant="destructive">{uploadError}</Alert>}
          {uploadItems.length > 0 && (
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              {uploadItems.map(item => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(item.size)}{item.message ? ` - ${item.message}` : ""}</p>
                  </div>
                  <Badge variant={item.status === "done" ? "success" : item.status === "failed" ? "outline" : "ai"}>
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border text-sm text-muted-foreground hover:border-accent/60"
          >
            <input ref={inputRef} type="file" accept="application/pdf" multiple hidden onChange={e => upload(e.target.files)}/>
            <UploadCloud className="mb-2" size={24}/>
            <p>{uploading ? "Uploading…" : t("admin.files.upload")}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {files.map(f => (
          <Card key={f.id} className="flex flex-row flex-wrap items-center justify-between gap-2 p-4">
            <div>
              <p className="font-medium">{f.fileName}</p>
              <p className="text-xs text-muted-foreground">{cName(f.courseId)} — {aName(f.assignmentId)} — {new Date(f.uploadedAt).toLocaleString(locale)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[f.status] ?? "outline"}>{f.status}</Badge>
              <Link href="/admin/questions-review"><Button variant="ghost" size="icon" title="review"><FileSearch size={16}/></Button></Link>
              <Button variant="ghost" size="icon" onClick={() => reprocess(f.id)} title={t("admin.files.reprocess")}><RotateCcw size={16}/></Button>
              <Button variant="ghost" size="icon" onClick={() => remove(f.id)}><Trash2 size={16} className="text-destructive"/></Button>
            </div>
          </Card>
        ))}
        {files.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
      </div>
    </div>
  );
}
