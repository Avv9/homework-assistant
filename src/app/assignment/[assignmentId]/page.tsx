"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { FileText, Image as ImageIcon, Type, UploadCloud, X } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Breadcrumbs, Crumb } from "@/components/shared/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Textarea, Alert } from "@/components/ui/primitives";
import { ProcessingSteps } from "@/components/shared/processing-steps";
import { ResultCard } from "@/components/shared/result-card";
import { Skeleton } from "@/components/ui/primitives";
import type { Assignment, Course, Specialization, Level, Category, SearchResultItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_MB = 15;
const ALLOWED_IMAGE = ["image/png", "image/jpeg", "image/webp"];

type Tab = "text" | "image" | "pdf";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface Context {
  assignment: Assignment;
  course: Course;
  spec?: Specialization;
  level?: Level;
  category?: Category;
}

export default function AssignmentPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { t, locale } = useLocale();

  const [ctx, setCtx] = useState<Context | null | "not_found">(null);
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!assignmentId) return;
    fetch(`/api/public/assignments?id=${assignmentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (a: Assignment | null) => {
        if (!a) { setCtx("not_found"); return; }
        const course: Course = await fetch(`/api/public/courses?id=${a.courseId}`).then(r => r.json());
        const [spec, level, cat]: [Specialization | null, Level | null, Category | null] = await Promise.all([
          course.specializationId ? fetch(`/api/public/specializations?id=${course.specializationId}`).then(r => r.json()) : Promise.resolve(null),
          course.levelId ? fetch(`/api/public/levels?id=${course.levelId}`).then(r => r.json()) : Promise.resolve(null),
          fetch(`/api/public/categories?slug=cci`).then(r => r.ok ? r.json() : null),
        ]);
        setCtx({ assignment: a, course, spec: spec ?? undefined, level: level ?? undefined, category: cat ?? undefined });
      });
  }, [assignmentId]);

  const handleImageSelect = useCallback((file: File) => {
    setError(null);
    if (!ALLOWED_IMAGE.includes(file.type)) { setError(t("question.invalidType")); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(t("question.fileTooLarge", { max: MAX_MB })); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }, [t]);

  const handlePdfSelect = useCallback((file: File) => {
    setError(null);
    if (file.type !== "application/pdf") { setError(t("question.invalidType")); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(t("question.fileTooLarge", { max: MAX_MB })); return; }
    setPdfFile(file);
  }, [t]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (tab !== "image") return;
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (item) { const f = item.getAsFile(); if (f) handleImageSelect(f); }
  }, [tab, handleImageSelect]);

  if (ctx === "not_found") return notFound();

  const loading = ctx === null;
  const assignment = loading ? null : ctx.assignment;
  const course = loading ? null : ctx.course;

  const resolved = ctx !== null && typeof ctx !== "string" ? ctx : null;
  const courseName = course ? (locale === "ar" ? course.nameAr : course.nameEn) : "…";
  const assignmentName = assignment ? (locale === "ar" ? assignment.nameAr : assignment.nameEn) : "…";
  const categoryName = resolved?.category ? (locale === "ar" ? resolved.category.nameAr : resolved.category.nameEn) : "";
  const specName = resolved?.spec ? (locale === "ar" ? resolved.spec.nameAr : resolved.spec.nameEn) : "";
  const levelName = resolved?.level ? (locale === "ar" ? resolved.level.nameAr : resolved.level.nameEn) : "";

  const crumbs: Crumb[] = resolved ? [
    ...(resolved.category ? [{ label: categoryName, href: `/category/${resolved.category.slug}` }] : []),
    ...(resolved.spec ? [{ label: specName, href: `/specialization/${resolved.spec.id}` }] : []),
    ...(resolved.level ? [{ label: levelName, href: `/level/${resolved.level.id}` }] : []),
    { label: courseName, href: course ? `/course/${course.id}` : "#" },
    { label: assignmentName },
  ] : [];

  const canSubmit = (tab === "text" && text.trim().length > 0) || (tab === "image" && imageFile) || (tab === "pdf" && pdfFile);

  const submit = async () => {
    if (!course || !assignment) return;
    setError(null);
    if (!canSubmit) { setError(t("question.validation")); return; }
    setSubmitting(true);
    setResults(null);
    setStep(0);
    try {
      const payload: Record<string, unknown> = { courseId: course.id, assignmentId: assignment.id, locale };
      await new Promise(r => setTimeout(r, 300));
      if (tab === "text") payload.text = text;
      else if (tab === "image" && imageFile) payload.image = { base64: await fileToBase64(imageFile), mimeType: imageFile.type };
      else if (tab === "pdf" && pdfFile) payload.pdf = { base64: await fileToBase64(pdfFile), fileName: pdfFile.name, sizeBytes: pdfFile.size };
      setStep(1);
      await new Promise(r => setTimeout(r, 300));
      setStep(2);
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "server_error"); }
      const data = await res.json();
      const hasAi = (data.results as SearchResultItem[]).some(r => r.source === "ai");
      if (hasAi) { setStep(3); await new Promise(r => setTimeout(r, 400)); }
      setResults(data.results);
    } catch { setError(t("common.error")); }
    finally { setSubmitting(false); }
  };

  const reset = () => { setResults(null); setText(""); setImageFile(null); setImagePreview(null); setPdfFile(null); setError(null); };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Breadcrumbs items={crumbs} />

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-16"/><Skeleton className="h-64"/></div>
      ) : (
        <>
          <div className="mb-6 rounded-md border border-border bg-card p-4 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("question.context")}</p>
            <p className="mt-1 font-medium">{[categoryName, specName, levelName, courseName, assignmentName].filter(Boolean).join(" / ")}</p>
          </div>

          {!results && !submitting && (
            <div className="fade-in">
              <h1 className="mb-4 text-xl font-bold text-primary">{t("question.title")}</h1>
              <div className="mb-4 flex gap-1 rounded-md border border-border p-1">
                {([{ id: "text", icon: Type, label: t("question.tabText") }, { id: "image", icon: ImageIcon, label: t("question.tabImage") }, { id: "pdf", icon: FileText, label: t("question.tabPdf") }] as const).map(ti => (
                  <button key={ti.id} onClick={() => setTab(ti.id)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors", tab === ti.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                    <ti.icon size={15}/>{ti.label}
                  </button>
                ))}
              </div>

              {tab === "text" && (
                <div className="space-y-2">
                  <Textarea rows={8} value={text} onChange={e=>setText(e.target.value)} placeholder={t("question.textPlaceholder")} onPaste={onPaste}/>
                  {text && <Button variant="ghost" size="sm" onClick={()=>setText("")}><X size={14}/>{t("question.clear")}</Button>}
                </div>
              )}

              {tab === "image" && (
                <div tabIndex={0} onPaste={onPaste} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f)handleImageSelect(f);}} onClick={()=>!imagePreview&&fileInputRef.current?.click()} className={cn("flex min-h-48 flex-col items-center justify-center rounded-md border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors hover:border-accent/60",!imagePreview&&"cursor-pointer")}>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>e.target.files?.[0]&&handleImageSelect(e.target.files[0])}/>
                  {imagePreview ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreview} alt="preview" className="max-h-64 rounded-md border border-border"/>
                      <button onClick={e=>{e.stopPropagation();setImageFile(null);setImagePreview(null);}} className="absolute -top-2 -end-2 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground"><X size={14}/></button>
                    </div>
                  ) : (<><UploadCloud className="mb-2" size={28}/><p>{t("question.dragImage")}</p></>)}
                </div>
              )}

              {tab === "pdf" && (
                <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f)handlePdfSelect(f);}} onClick={()=>!pdfFile&&pdfInputRef.current?.click()} className={cn("flex min-h-48 flex-col items-center justify-center rounded-md border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors hover:border-accent/60",!pdfFile&&"cursor-pointer")}>
                  <input ref={pdfInputRef} type="file" accept="application/pdf" hidden onChange={e=>e.target.files?.[0]&&handlePdfSelect(e.target.files[0])}/>
                  {pdfFile ? (
                    <div className="flex items-center gap-3 rounded-md border border-border bg-muted px-4 py-2">
                      <FileText size={18}/><div className="text-start"><p className="font-medium text-foreground">{pdfFile.name}</p><p className="text-xs">{(pdfFile.size/1024/1024).toFixed(2)} MB</p></div>
                      <button onClick={e=>{e.stopPropagation();setPdfFile(null);}}><X size={16}/></button>
                    </div>
                  ) : (<><UploadCloud className="mb-2" size={28}/><p>{t("question.dragPdf")}</p></>)}
                </div>
              )}

              {error && <Alert variant="destructive" className="mt-4">{error}</Alert>}
              <Button size="lg" className="mt-6 w-full" onClick={submit} disabled={!canSubmit}>{t("question.submit")}</Button>
            </div>
          )}

          {submitting && <div className="fade-in"><ProcessingSteps activeStep={step}/></div>}

          {results && !submitting && (
            <div className="fade-in space-y-4">
              <h2 className="text-lg font-bold text-primary">{t("question.resultsTitle")}</h2>
              {results.map(r => <ResultCard key={r.questionIndex} result={r}/>)}
              <Button variant="outline" onClick={reset}>{t("question.newQuestion")}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
