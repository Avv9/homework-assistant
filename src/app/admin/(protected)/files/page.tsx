"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileSearch, Play, RefreshCw, RotateCcw, Square, Trash2, UploadCloud } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/primitives";
import type { Assignment, Course, SourceFile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

async function safeFetch<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return fallback;
    }
    if (!res.ok) return fallback;
    const data = await res.json();
    if (Array.isArray(fallback) && !Array.isArray(data)) return fallback;
    return (data ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const STATUS_VARIANT: Record<string, "outline" | "ai" | "success"> = {
  uploaded: "outline",
  processing: "ai",
  needs_review: "ai",
  published: "success",
  failed: "outline",
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

function queueCounts(files: SourceFile[]) {
  return files.reduce(
    (acc, file) => {
      acc.total += 1;
      acc[file.status] += 1;
      return acc;
    },
    { total: 0, uploaded: 0, processing: 0, needs_review: 0, published: 0, failed: 0 },
  );
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
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopQueueRef = useRef(false);
  const queueRunningRef = useRef(false);
  const isAr = locale === "ar";

  const load = async () => {
    const [nextFiles, nextCourses, nextAssignments] = await Promise.all([
      safeFetch<SourceFile[]>("/api/admin/files", []),
      safeFetch<Course[]>("/api/admin/courses", []),
      safeFetch<Assignment[]>("/api/admin/assignments", []),
    ]);

    setFiles(nextFiles);
    setCourses(nextCourses);
    setAssignments(nextAssignments);
    if (!courseId && nextCourses[0]) setCourseId(nextCourses[0].id);
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([
      safeFetch<SourceFile[]>("/api/admin/files", []),
      safeFetch<Course[]>("/api/admin/courses", []),
      safeFetch<Assignment[]>("/api/admin/assignments", []),
    ]).then(([nextFiles, nextCourses, nextAssignments]) => {
      if (!mounted) return;
      setFiles(nextFiles);
      setCourses(nextCourses);
      setAssignments(nextAssignments);
      setCourseId(current => current || nextCourses[0]?.id || "");
    });
    return () => { mounted = false; };
  }, []);

  const courseAssignments = assignments.filter(a => a.courseId === courseId);
  const visibleFiles = useMemo(
    () => files.filter(file => {
      if (courseId && file.courseId !== courseId) return false;
      if (assignmentId && file.assignmentId !== assignmentId) return false;
      return true;
    }),
    [assignmentId, courseId, files],
  );
  const counts = useMemo(() => queueCounts(visibleFiles), [visibleFiles]);

  const setItem = (id: string, patch: Partial<UploadItem>) => {
    setUploadItems(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const upload = async (fileList: FileList | null) => {
    if (!fileList || !courseId || !assignmentId) {
      setUploadError(isAr ? "اختر المقرر والواجب أولًا." : "Please select a course and assignment first.");
      return;
    }
    const selectedFiles = Array.from(fileList);
    if (selectedFiles.length === 0) return;

    setUploadError(null);
    setQueueMessage(null);
    setUploadItems(selectedFiles.map(file => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      status: "queued",
    })));
    setUploading(true);

    try {
      const supabase = createClient();
      for (const file of selectedFiles) {
        const id = `${file.name}-${file.size}-${file.lastModified}`;
        try {
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            setItem(id, { status: "failed", message: "Only PDF files are accepted." });
            continue;
          }

          setItem(id, { status: "preparing", message: isAr ? "تجهيز رابط الرفع..." : "Preparing upload..." });
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

          setItem(id, { status: "uploading", message: isAr ? "رفع الملف إلى التخزين..." : "Uploading to storage..." });
          const { error: uploadStorageError } = await supabase.storage
            .from(prep.bucket)
            .uploadToSignedUrl(prep.storagePath, prep.token, file, {
              contentType: file.type || "application/pdf",
            });
          if (uploadStorageError) {
            setItem(id, { status: "failed", message: uploadStorageError.message });
            continue;
          }

          setItem(id, { status: "finalizing", message: isAr ? "حفظ سجل الملف..." : "Saving file record..." });
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

          setItem(id, {
            status: "done",
            message: isAr ? "تم الرفع. الملف دخل الطابور." : "Uploaded. Queued for processing.",
          });
        } catch (e) {
          setItem(id, { status: "failed", message: e instanceof Error ? e.message : "Upload failed." });
        }
      }
      await load();
      setQueueMessage(isAr
        ? "انتهى الرفع. شغّل الطابور لمعالجة الملفات واحدًا واحدًا."
        : "Upload finished. Start the queue to process files one by one.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const runQueue = async () => {
    if (queueRunningRef.current) return;
    if (!courseId || !assignmentId) {
      setQueueMessage(isAr ? "اختر المقرر والواجب قبل تشغيل الطابور." : "Select a course and assignment before starting the queue.");
      return;
    }

    stopQueueRef.current = false;
    queueRunningRef.current = true;
    setQueueRunning(true);
    setQueueMessage(isAr ? "بدأت معالجة الطابور..." : "Queue processing started...");

    let processedCount = 0;
    try {
      for (;;) {
        if (stopQueueRef.current) {
          setQueueMessage(isAr ? "تم إيقاف الطابور بعد آخر ملف." : "Queue stopped after the current file.");
          break;
        }

        const res = await fetch("/api/admin/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process_next", courseId, assignmentId, locale }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setQueueMessage(readableUploadError(data.error, data.details));
          break;
        }

        if (!data.processed) {
          setQueueMessage(processedCount > 0
            ? (isAr ? `انتهى الطابور. تمت معالجة ${processedCount} ملف/ملفات.` : `Queue complete. Processed ${processedCount} file(s).`)
            : (isAr ? "لا توجد ملفات في الطابور." : "No queued files."));
          break;
        }

        processedCount += 1;
        setQueueMessage(isAr
          ? `تمت معالجة: ${data.file?.fileName ?? "ملف"}`
          : `Processed: ${data.file?.fileName ?? "file"}`);
        await load();
      }
    } finally {
      queueRunningRef.current = false;
      setQueueRunning(false);
      await load();
    }
  };

  const stopQueue = () => {
    stopQueueRef.current = true;
    setQueueMessage(isAr ? "سيتم الإيقاف بعد انتهاء الملف الحالي..." : "Stopping after the current file finishes...");
  };

  const retryFailed = async () => {
    const res = await fetch("/api/admin/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry_failed", courseId, assignmentId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setQueueMessage(readableUploadError(data.error, data.details));
      return;
    }
    setQueueMessage(isAr ? `تمت إعادة ${data.retried ?? 0} ملف/ملفات للطابور.` : `Moved ${data.retried ?? 0} failed file(s) back to the queue.`);
    await load();
  };

  const reprocess = async (id: string) => {
    setQueueMessage(isAr ? "جارٍ إعادة معالجة الملف..." : "Reprocessing file...");
    await fetch("/api/admin/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reprocess: true, locale }),
    });
    await load();
    setQueueMessage(isAr ? "انتهت إعادة المعالجة." : "Reprocess finished.");
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/files?id=${id}`, { method: "DELETE" });
    await load();
  };

  const cName = (id: string) => {
    const c = courses.find(c => c.id === id);
    return c ? (locale === "ar" ? c.nameAr : c.nameEn) : "";
  };
  const aName = (id: string) => {
    const a = assignments.find(a => a.id === id);
    return a ? (locale === "ar" ? a.nameAr : a.nameEn) : "";
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.files.title")}</h1>

      <Card className="mb-6">
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={courseId} onChange={e => { setCourseId(e.target.value); setAssignmentId(""); }}>
              {courses.map(c => <option key={c.id} value={c.id}>{locale === "ar" ? c.nameAr : c.nameEn}</option>)}
            </select>
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={assignmentId} onChange={e => setAssignmentId(e.target.value)}>
              <option value="">--</option>
              {courseAssignments.map(a => <option key={a.id} value={a.id}>{locale === "ar" ? a.nameAr : a.nameEn}</option>)}
            </select>
          </div>

          <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm sm:grid-cols-5">
            <div><p className="text-muted-foreground">{isAr ? "في الطابور" : "Queued"}</p><p className="text-xl font-bold">{counts.uploaded}</p></div>
            <div><p className="text-muted-foreground">{isAr ? "قيد المعالجة" : "Processing"}</p><p className="text-xl font-bold">{counts.processing}</p></div>
            <div><p className="text-muted-foreground">{isAr ? "تحتاج مراجعة" : "Needs review"}</p><p className="text-xl font-bold">{counts.needs_review}</p></div>
            <div><p className="text-muted-foreground">{isAr ? "منشورة" : "Published"}</p><p className="text-xl font-bold">{counts.published}</p></div>
            <div><p className="text-muted-foreground">{isAr ? "فشلت" : "Failed"}</p><p className="text-xl font-bold text-destructive">{counts.failed}</p></div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={runQueue} disabled={queueRunning || counts.uploaded === 0 || !assignmentId}>
              <Play size={14} /> {isAr ? "تشغيل الطابور" : "Start queue"}
            </Button>
            <Button size="sm" variant="outline" onClick={stopQueue} disabled={!queueRunning}>
              <Square size={14} /> {isAr ? "إيقاف" : "Stop"}
            </Button>
            <Button size="sm" variant="outline" onClick={retryFailed} disabled={queueRunning || counts.failed === 0 || !assignmentId}>
              <RefreshCw size={14} /> {isAr ? "إعادة محاولة الفاشل" : "Retry failed"}
            </Button>
          </div>

          {queueMessage && <Alert variant="info">{queueMessage}</Alert>}
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
            onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border text-sm text-muted-foreground hover:border-accent/60"
          >
            <input ref={inputRef} type="file" accept="application/pdf" multiple hidden onChange={e => void upload(e.target.files)}/>
            <UploadCloud className="mb-2" size={24}/>
            <p>{uploading ? (isAr ? "جارٍ الرفع..." : "Uploading...") : t("admin.files.upload")}</p>
            <p className="mt-1 text-xs">{isAr ? "بعد الرفع شغّل الطابور لمعالجة الملفات بأمان." : "After uploading, start the queue to process safely."}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {visibleFiles.map(f => (
          <Card key={f.id} className="flex flex-row flex-wrap items-center justify-between gap-2 p-4">
            <div className="min-w-0">
              <p className="break-words font-medium">{f.fileName}</p>
              <p className="text-xs text-muted-foreground">{cName(f.courseId)} — {aName(f.assignmentId)} — {new Date(f.uploadedAt).toLocaleString(locale)}</p>
              {f.processingError && (
                <p className={`mt-1 max-w-3xl break-words text-xs ${f.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                  {f.processingError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[f.status] ?? "outline"}>{f.status}</Badge>
              <Link href={`/admin/questions-review?fileId=${f.id}`}><Button variant="ghost" size="icon" title="review"><FileSearch size={16}/></Button></Link>
              <Button variant="ghost" size="icon" onClick={() => void reprocess(f.id)} title={t("admin.files.reprocess")}><RotateCcw size={16}/></Button>
              <Button variant="ghost" size="icon" onClick={() => void remove(f.id)}><Trash2 size={16} className="text-destructive"/></Button>
            </div>
          </Card>
        ))}
        {visibleFiles.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
      </div>
    </div>
  );
}
