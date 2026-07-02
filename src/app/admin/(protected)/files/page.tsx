"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Alert } from "@/components/ui/primitives";
import { UploadCloud, Trash2, RotateCcw, FileSearch } from "lucide-react";
import Link from "next/link";
import type { Assignment, Course, SourceFile } from "@/lib/types";

const STATUS_VARIANT: Record<string, "outline" | "ai" | "success"> = {
  uploaded: "outline", processing: "outline", needs_review: "ai", published: "success", failed: "outline",
};

export default function FilesPage() {
  const { t, locale } = useLocale();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courseId, setCourseId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch("/api/admin/files").then(r => r.json()).then(setFiles);
    fetch("/api/admin/courses").then(r => r.json()).then((cs: Course[]) => {
      setCourses(cs);
      if (!courseId && cs[0]) setCourseId(cs[0].id);
    });
    fetch("/api/admin/assignments").then(r => r.json()).then(setAssignments);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const courseAssignments = assignments.filter(a => a.courseId === courseId);

  const upload = async (fileList: FileList | null) => {
    if (!fileList || !courseId || !assignmentId) {
      setUploadError("Please select a course and assignment first.");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("courseId", courseId);
      formData.append("assignmentId", assignmentId);
      formData.append("locale", locale);
      for (const file of Array.from(fileList)) formData.append("files", file);

      const res = await fetch("/api/admin/files", { method: "POST", body: formData });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setUploadError(d.error ?? "Upload failed");
      } else {
        load();
      }
    } finally {
      setUploading(false);
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
