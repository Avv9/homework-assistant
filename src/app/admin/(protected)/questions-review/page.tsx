"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Search, Trash2 } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Input, Textarea } from "@/components/ui/primitives";
import type { ExtractedQuestion, SourceFile } from "@/lib/types";

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

type ReviewMode = "all" | "missing_answer" | "low_confidence" | "published" | "draft";

function initialFileIdFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("fileId") ?? "";
}

export default function QuestionsReviewPage() {
  const { t, locale } = useLocale();
  const isAr = locale === "ar";
  const [questions, setQuestions] = useState<ExtractedQuestion[]>([]);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState(initialFileIdFromUrl);
  const [mode, setMode] = useState<ReviewMode>("all");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { questionText: string; answerText: string }>>({});
  const [message, setMessage] = useState<string | null>(null);

  const loadFiles = async () => {
    setFiles(await safeFetch<SourceFile[]>("/api/admin/files", []));
  };

  const loadQuestions = async (fileId = selectedFileId) => {
    const qs = await safeFetch<ExtractedQuestion[]>(
      fileId ? `/api/admin/questions?fileId=${encodeURIComponent(fileId)}` : "/api/admin/questions",
      [],
    );
    setQuestions(qs);
    setDrafts(Object.fromEntries(qs.map((q) => [q.id, { questionText: q.questionText, answerText: q.answerText }])));
  };

  useEffect(() => {
    let mounted = true;
    safeFetch<SourceFile[]>("/api/admin/files", []).then((nextFiles) => {
      if (mounted) setFiles(nextFiles);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const url = selectedFileId
      ? `/api/admin/questions?fileId=${encodeURIComponent(selectedFileId)}`
      : "/api/admin/questions";
    safeFetch<ExtractedQuestion[]>(url, []).then((qs) => {
      if (!mounted) return;
      setQuestions(qs);
      setDrafts(Object.fromEntries(qs.map((q) => [q.id, { questionText: q.questionText, answerText: q.answerText }])));
    });
    return () => { mounted = false; };
  }, [selectedFileId]);

  const fileNameById = useMemo(() => new Map(files.map(file => [file.id, file.fileName])), [files]);
  const fileName = (id: string) => fileNameById.get(id) ?? "";
  const selectedFile = files.find(file => file.id === selectedFileId) ?? null;

  const filteredQuestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return questions.filter((q) => {
      const draft = drafts[q.id] ?? { questionText: q.questionText, answerText: q.answerText };
      if (mode === "missing_answer" && draft.answerText.trim()) return false;
      if (mode === "low_confidence" && q.confidence >= 0.7) return false;
      if (mode === "published" && !q.published) return false;
      if (mode === "draft" && q.published) return false;
      if (!normalizedQuery) return true;
      return `${draft.questionText} ${draft.answerText} ${fileNameById.get(q.sourceFileId) ?? ""}`.toLowerCase().includes(normalizedQuery);
    });
  }, [drafts, fileNameById, mode, query, questions]);

  const stats = useMemo(() => ({
    total: questions.length,
    missingAnswer: questions.filter(q => !(drafts[q.id]?.answerText ?? q.answerText).trim()).length,
    lowConfidence: questions.filter(q => q.confidence < 0.7).length,
    published: questions.filter(q => q.published).length,
  }), [drafts, questions]);

  const grouped = useMemo(() => {
    const map = new Map<string, ExtractedQuestion[]>();
    for (const q of filteredQuestions) {
      const key = q.sourceFileId || "unknown";
      map.set(key, [...(map.get(key) ?? []), q]);
    }
    return [...map.entries()];
  }, [filteredQuestions]);

  const saveQuestion = async (id: string) => {
    const d = drafts[id];
    await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...d }),
    });
    setMessage(isAr ? "تم حفظ السؤال." : "Question saved.");
    await loadQuestions();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/questions?id=${id}`, { method: "DELETE" });
    setMessage(isAr ? "تم حذف السؤال." : "Question deleted.");
    await loadQuestions();
  };

  const publishAll = async (fileId: string) => {
    await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishAllForFile: fileId }),
    });
    setMessage(isAr ? "تم نشر أسئلة الملف." : "File questions published.");
    await Promise.all([loadFiles(), loadQuestions()]);
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.menu.questionsReview")}</h1>

      <Card className="mb-6">
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr_1fr]">
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={selectedFileId} onChange={e => setSelectedFileId(e.target.value)}>
              <option value="">{isAr ? "كل الملفات" : "All files"}</option>
              {files.map(file => <option key={file.id} value={file.id}>{file.fileName}</option>)}
            </select>
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={mode} onChange={e => setMode(e.target.value as ReviewMode)}>
              <option value="all">{isAr ? "كل الأسئلة" : "All questions"}</option>
              <option value="missing_answer">{isAr ? "بلا إجابة" : "Missing answer"}</option>
              <option value="low_confidence">{isAr ? "ثقة منخفضة" : "Low confidence"}</option>
              <option value="draft">{isAr ? "غير منشورة" : "Unpublished"}</option>
              <option value="published">{isAr ? "منشورة" : "Published"}</option>
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-2.5 text-muted-foreground" size={16} />
              <Input className="ps-9" value={query} onChange={e => setQuery(e.target.value)} placeholder={isAr ? "بحث داخل الأسئلة والإجابات..." : "Search questions and answers..."} />
            </div>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-md border border-border bg-muted/20 p-3"><p className="text-muted-foreground">{isAr ? "الإجمالي" : "Total"}</p><p className="text-2xl font-bold">{stats.total}</p></div>
            <div className="rounded-md border border-border bg-muted/20 p-3"><p className="text-muted-foreground">{isAr ? "بلا إجابة" : "Missing answer"}</p><p className="text-2xl font-bold text-destructive">{stats.missingAnswer}</p></div>
            <div className="rounded-md border border-border bg-muted/20 p-3"><p className="text-muted-foreground">{isAr ? "ثقة منخفضة" : "Low confidence"}</p><p className="text-2xl font-bold">{stats.lowConfidence}</p></div>
            <div className="rounded-md border border-border bg-muted/20 p-3"><p className="text-muted-foreground">{isAr ? "منشورة" : "Published"}</p><p className="text-2xl font-bold text-success">{stats.published}</p></div>
          </div>

          {selectedFile && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <p className="font-medium">{selectedFile.fileName}</p>
                {selectedFile.processingError && (
                  <p className={`text-xs ${selectedFile.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                    {selectedFile.processingError}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={() => publishAll(selectedFile.id)} disabled={stats.total === 0}>
                {t("admin.review.publishAll")}
              </Button>
            </div>
          )}

          {message && <p className="text-sm text-accent">{message}</p>}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {grouped.map(([sourceFileId, fileQuestions]) => (
          <Card key={sourceFileId}>
            <CardContent className="pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{fileName(sourceFileId) || sourceFileId}</p>
                  <p className="text-xs text-muted-foreground">{fileQuestions.length} {isAr ? "سؤال" : "question(s)"}</p>
                </div>
                {!selectedFileId && <Button size="sm" onClick={() => publishAll(sourceFileId)}>{t("admin.review.publishAll")}</Button>}
              </div>
              <div className="space-y-4">
                {fileQuestions.map((q) => (
                  <div key={q.id} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={q.published ? "success" : "outline"}>{q.published ? (isAr ? "منشور" : "published") : (isAr ? "مراجعة" : "draft")}</Badge>
                      <span>{t("admin.review.confidence")}: {(q.confidence * 100).toFixed(0)}%</span>
                      <span>{t("admin.review.page")} {q.pageNumber ?? "-"}</span>
                      {q.questionNumber && <span>#{q.questionNumber}</span>}
                    </div>
                    <Textarea
                      rows={3}
                      value={drafts[q.id]?.questionText ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [q.id]: { ...drafts[q.id], questionText: e.target.value } })}
                      className="mb-2"
                    />
                    <Textarea
                      rows={4}
                      value={drafts[q.id]?.answerText ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [q.id]: { ...drafts[q.id], answerText: e.target.value } })}
                      placeholder={isAr ? "اكتب/راجع الإجابة هنا..." : "Write/review the answer here..."}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => saveQuestion(q.id)}>
                        <Save size={14} /> {t("common.save")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(q.id)}>
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {grouped.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
      </div>
    </div>
  );
}
