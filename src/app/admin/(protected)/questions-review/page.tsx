"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Filter,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
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

type ReviewMode = "all" | "needs_work" | "missing_answer" | "low_confidence" | "draft" | "published";
type Draft = { questionText: string; answerText: string };
type DraftMap = Record<string, Draft>;

type ReviewStats = {
  total: number;
  missingAnswer: number;
  lowConfidence: number;
  published: number;
  draft: number;
  needsWork: number;
  readyPercent: number;
  publishedPercent: number;
};

type FileGroup = {
  key: string;
  file?: SourceFile;
  sourceFileId?: string;
  title: string;
  subtitle: string;
  orphan: boolean;
  questions: ExtractedQuestion[];
  stats: ReviewStats;
};

const ALL_GROUP_KEY = "all";
const ORPHAN_GROUP_KEY = "orphan:missing-file";

function initialGroupKeyFromUrl() {
  if (typeof window === "undefined") return ALL_GROUP_KEY;
  return new URLSearchParams(window.location.search).get("fileId") ?? ALL_GROUP_KEY;
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}...` : id;
}

function getDraft(question: ExtractedQuestion, drafts: DraftMap): Draft {
  return drafts[question.id] ?? { questionText: question.questionText, answerText: question.answerText };
}

function isDirty(question: ExtractedQuestion, drafts: DraftMap) {
  const draft = getDraft(question, drafts);
  return draft.questionText !== question.questionText || draft.answerText !== question.answerText;
}

function calculateStats(questions: ExtractedQuestion[], drafts: DraftMap = {}): ReviewStats {
  const needsWorkIds = new Set<string>();
  let missingAnswer = 0;
  let lowConfidence = 0;
  let published = 0;

  for (const question of questions) {
    const draft = getDraft(question, drafts);
    if (!draft.answerText.trim()) {
      missingAnswer += 1;
      needsWorkIds.add(question.id);
    }
    if (question.confidence < 0.7) {
      lowConfidence += 1;
      needsWorkIds.add(question.id);
    }
    if (question.published) published += 1;
  }

  const total = questions.length;
  return {
    total,
    missingAnswer,
    lowConfidence,
    published,
    draft: total - published,
    needsWork: needsWorkIds.size,
    readyPercent: total === 0 ? 0 : Math.round(((total - needsWorkIds.size) / total) * 100),
    publishedPercent: total === 0 ? 0 : Math.round((published / total) * 100),
  };
}

function fileStatusLabel(status: SourceFile["status"] | undefined, isAr: boolean) {
  if (!status) return isAr ? "بدون ملف" : "No file";
  const labels: Record<SourceFile["status"], string> = isAr ? {
    uploaded: "في الطابور",
    processing: "قيد المعالجة",
    needs_review: "تحتاج مراجعة",
    published: "منشور",
    failed: "فشل",
  } : {
    uploaded: "Queued",
    processing: "Processing",
    needs_review: "Needs review",
    published: "Published",
    failed: "Failed",
  };
  return labels[status];
}

function matchesMode(question: ExtractedQuestion, draft: Draft, mode: ReviewMode) {
  if (mode === "missing_answer") return !draft.answerText.trim();
  if (mode === "low_confidence") return question.confidence < 0.7;
  if (mode === "draft") return !question.published;
  if (mode === "published") return question.published;
  if (mode === "needs_work") return !draft.answerText.trim() || question.confidence < 0.7 || !question.published;
  return true;
}

function sortQuestions(a: ExtractedQuestion, b: ExtractedQuestion) {
  const aNumber = a.questionNumber ?? 999999;
  const bNumber = b.questionNumber ?? 999999;
  if (aNumber !== bNumber) return aNumber - bNumber;
  return (a.pageNumber ?? 999999) - (b.pageNumber ?? 999999);
}

export default function QuestionsReviewPage() {
  const { t, locale } = useLocale();
  const isAr = locale === "ar";
  const [questions, setQuestions] = useState<ExtractedQuestion[]>([]);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [activeGroupKey, setActiveGroupKey] = useState(initialGroupKeyFromUrl);
  const [mode, setMode] = useState<ReviewMode>("needs_work");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [message, setMessage] = useState<string | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    const [nextFiles, nextQuestions] = await Promise.all([
      safeFetch<SourceFile[]>("/api/admin/files", []),
      safeFetch<ExtractedQuestion[]>("/api/admin/questions", []),
    ]);
    setFiles(nextFiles);
    setQuestions(nextQuestions);
    setDrafts(Object.fromEntries(nextQuestions.map((question) => [
      question.id,
      { questionText: question.questionText, answerText: question.answerText },
    ])));
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([
      safeFetch<SourceFile[]>("/api/admin/files", []),
      safeFetch<ExtractedQuestion[]>("/api/admin/questions", []),
    ]).then(([nextFiles, nextQuestions]) => {
      if (!mounted) return;
      setFiles(nextFiles);
      setQuestions(nextQuestions);
      setDrafts(Object.fromEntries(nextQuestions.map((question) => [
        question.id,
        { questionText: question.questionText, answerText: question.answerText },
      ])));
    });
    return () => { mounted = false; };
  }, []);

  const fileById = useMemo(() => new Map(files.map(file => [file.id, file])), [files]);
  const allStats = useMemo(() => calculateStats(questions, drafts), [drafts, questions]);

  const groups = useMemo<FileGroup[]>(() => {
    const grouped = new Map<string, ExtractedQuestion[]>();
    for (const file of files) {
      grouped.set(file.id, []);
    }
    for (const question of questions) {
      const key = question.sourceFileId || ORPHAN_GROUP_KEY;
      grouped.set(key, [...(grouped.get(key) ?? []), question]);
    }

    return [...grouped.entries()].map(([key, groupQuestions]) => {
      const file = fileById.get(key);
      const orphan = !file;
      const sortedQuestions = [...groupQuestions].sort(sortQuestions);
      const title = file
        ? file.fileName
        : isAr
          ? "أسئلة بدون ملف معروف"
          : "Questions without a known file";
      const subtitle = file
        ? `${new Date(file.uploadedAt).toLocaleDateString(locale)} · ${fileStatusLabel(file.status, isAr)}`
        : key === ORPHAN_GROUP_KEY
          ? (isAr ? "هذه الأسئلة لا تحمل معرّف ملف أصلي." : "These questions do not have an original file id.")
          : (isAr ? `معرّف ملف مفقود: ${shortId(key)}` : `Missing file id: ${shortId(key)}`);

      return {
        key,
        file,
        sourceFileId: key === ORPHAN_GROUP_KEY ? undefined : key,
        title,
        subtitle,
        orphan,
        questions: sortedQuestions,
        stats: calculateStats(sortedQuestions, drafts),
      };
    }).sort((a, b) => {
      if (a.orphan !== b.orphan) return a.orphan ? -1 : 1;
      if (a.stats.needsWork !== b.stats.needsWork) return b.stats.needsWork - a.stats.needsWork;
      return (new Date(b.file?.uploadedAt ?? 0).getTime()) - (new Date(a.file?.uploadedAt ?? 0).getTime());
    });
  }, [drafts, fileById, files, isAr, locale, questions]);

  const activeGroup = useMemo(
    () => groups.find(group => group.key === activeGroupKey) ?? null,
    [activeGroupKey, groups],
  );

  const scopedStats = activeGroup ? activeGroup.stats : allStats;
  const normalizedQuery = query.trim().toLowerCase();

  const visibleQuestions = useMemo(() => {
    if (!activeGroup) return [];
    return activeGroup.questions.filter((question) => {
      const draft = getDraft(question, drafts);
      if (!matchesMode(question, draft, mode)) return false;
      if (!normalizedQuery) return true;
      return `${draft.questionText} ${draft.answerText}`.toLowerCase().includes(normalizedQuery);
    });
  }, [activeGroup, drafts, mode, normalizedQuery]);

  const dirtyVisibleQuestions = useMemo(
    () => visibleQuestions.filter(question => isDirty(question, drafts)),
    [drafts, visibleQuestions],
  );

  const modeOptions: Array<{ value: ReviewMode; label: string }> = [
    { value: "needs_work", label: isAr ? "تحتاج عمل" : "Needs work" },
    { value: "all", label: isAr ? "كل الأسئلة" : "All questions" },
    { value: "missing_answer", label: isAr ? "بلا إجابة" : "Missing answer" },
    { value: "low_confidence", label: isAr ? "ثقة منخفضة" : "Low confidence" },
    { value: "draft", label: isAr ? "غير منشورة" : "Unpublished" },
    { value: "published", label: isAr ? "منشورة" : "Published" },
  ];

  const selectGroup = (key: string) => {
    setActiveGroupKey(key);
    setDeleteCandidateId(null);
    setDeleteGroupConfirm(false);
    setMessage(null);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (key === ALL_GROUP_KEY || key === ORPHAN_GROUP_KEY) {
      url.searchParams.delete("fileId");
    } else {
      url.searchParams.set("fileId", key);
    }
    window.history.replaceState(null, "", url);
  };

  const updateDraft = (question: ExtractedQuestion, patch: Partial<Draft>) => {
    setDrafts(current => {
      const existing = getDraft(question, current);
      return { ...current, [question.id]: { ...existing, ...patch } };
    });
  };

  const saveQuestion = async (question: ExtractedQuestion, publish = false) => {
    const draft = getDraft(question, drafts);
    setBusy(question.id);
    try {
      const res = await fetch("/api/admin/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: question.id,
          questionText: draft.questionText,
          answerText: draft.answerText,
          ...(publish && { published: true }),
        }),
      });
      if (!res.ok) throw new Error(isAr ? "تعذر حفظ السؤال." : "Could not save question.");
      setMessage(publish ? (isAr ? "تم حفظ السؤال ونشره." : "Question saved and published.") : (isAr ? "تم حفظ السؤال." : "Question saved."));
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء الحفظ." : "Save failed."));
    } finally {
      setBusy(null);
    }
  };

  const saveChanged = async () => {
    if (dirtyVisibleQuestions.length === 0) return;
    setBusy("save-changed");
    try {
      for (const question of dirtyVisibleQuestions) {
        const draft = getDraft(question, drafts);
        const res = await fetch("/api/admin/questions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: question.id, questionText: draft.questionText, answerText: draft.answerText }),
        });
        if (!res.ok) throw new Error(isAr ? "تعذر حفظ بعض التعديلات." : "Could not save some changes.");
      }
      setMessage(isAr ? `تم حفظ ${dirtyVisibleQuestions.length} تعديل.` : `Saved ${dirtyVisibleQuestions.length} change(s).`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء الحفظ." : "Save failed."));
    } finally {
      setBusy(null);
    }
  };

  const publishQuestionIds = async (ids: string[], successMessage: string) => {
    if (ids.length === 0) return;
    setBusy("publish");
    try {
      const res = await fetch("/api/admin/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishQuestionIds: ids }),
      });
      if (!res.ok) throw new Error(isAr ? "تعذر النشر." : "Publish failed.");
      setMessage(successMessage);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء النشر." : "Publish failed."));
    } finally {
      setBusy(null);
    }
  };

  const publishGroup = async (group: FileGroup) => {
    if (group.questions.length === 0) return;
    setBusy("publish");
    try {
      if (group.file && !group.orphan) {
        const res = await fetch("/api/admin/questions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publishAllForFile: group.file.id }),
        });
        if (!res.ok) throw new Error(isAr ? "تعذر نشر الملف." : "Could not publish the file.");
      } else {
        await publishQuestionIds(group.questions.map(question => question.id), isAr ? "تم نشر أسئلة المجموعة." : "Group questions published.");
        return;
      }

      setMessage(isAr ? "تم نشر كل أسئلة الملف." : "All file questions published.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء النشر." : "Publish failed."));
    } finally {
      setBusy(null);
    }
  };

  const publishVisible = async () => {
    await publishQuestionIds(
      visibleQuestions.map(question => question.id),
      isAr ? `تم نشر ${visibleQuestions.length} سؤال/أسئلة معروضة.` : `Published ${visibleQuestions.length} visible question(s).`,
    );
  };

  const deleteActiveGroup = async () => {
    if (!activeGroup || (!activeGroup.file && activeGroup.questions.length === 0)) return;
    setBusy("delete-group");
    let successMessage = "";
    try {
      if (activeGroup.file) {
        const res = await fetch(`/api/admin/files?id=${encodeURIComponent(activeGroup.file.id)}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(isAr ? "تعذر حذف الملف." : "Could not delete file.");
        successMessage = isAr
          ? `تم حذف الملف ومعه ${data.deletedQuestions ?? activeGroup.questions.length} سؤال/أسئلة.`
          : `Deleted the file and ${data.deletedQuestions ?? activeGroup.questions.length} question(s).`;
      } else {
        const res = await fetch("/api/admin/questions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleteQuestionIds: activeGroup.questions.map(question => question.id) }),
        });
        if (!res.ok) throw new Error(isAr ? "تعذر حذف مجموعة الأسئلة." : "Could not delete question group.");
        successMessage = isAr
          ? `تم حذف ${activeGroup.questions.length} سؤال/أسئلة بدون ملف معروف.`
          : `Deleted ${activeGroup.questions.length} question(s) without a known file.`;
      }

      setDeleteGroupConfirm(false);
      selectGroup(ALL_GROUP_KEY);
      await reload();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء الحذف." : "Delete failed."));
    } finally {
      setBusy(null);
    }
  };

  const reprocessActiveFile = async () => {
    if (!activeGroup?.file) return;
    setBusy("reprocess");
    try {
      const res = await fetch("/api/admin/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeGroup.file.id, reprocess: true, locale }),
      });
      if (!res.ok) throw new Error(isAr ? "تعذرت إعادة المعالجة." : "Reprocess failed.");
      setMessage(isAr ? "انتهت إعادة معالجة الملف." : "File reprocessed.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء إعادة المعالجة." : "Reprocess failed."));
    } finally {
      setBusy(null);
    }
  };

  const removeQuestion = async (question: ExtractedQuestion) => {
    setBusy(question.id);
    try {
      const res = await fetch(`/api/admin/questions?id=${encodeURIComponent(question.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(isAr ? "تعذر حذف السؤال." : "Could not delete question.");
      setDeleteCandidateId(null);
      setMessage(isAr ? "تم حذف السؤال." : "Question deleted.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isAr ? "حدث خطأ أثناء الحذف." : "Delete failed."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">{t("admin.menu.questionsReview")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr ? "راجع كل ملف لحاله، احفظ التعديلات، ثم انشر بثقة." : "Review each file separately, save changes, then publish with confidence."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy !== null}>
          <RefreshCw size={14} /> {isAr ? "تحديث" : "Refresh"}
        </Button>
      </div>

      <Card className="overflow-hidden border-accent/20 bg-gradient-to-br from-accent/10 via-card to-card">
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={activeGroup?.orphan ? "outline" : "ai"}>
                  {activeGroup ? fileStatusLabel(activeGroup.file?.status, isAr) : (isAr ? "نظرة عامة" : "Overview")}
                </Badge>
                {activeGroup?.orphan && (
                  <Badge variant="outline" className="border-destructive/30 text-destructive">
                    <AlertTriangle size={12} /> {isAr ? "يحتاج انتباه" : "Needs attention"}
                  </Badge>
                )}
              </div>
              <h2 className="break-words text-xl font-bold text-primary">
                {activeGroup ? activeGroup.title : (isAr ? "كل الملفات" : "All files")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeGroup ? activeGroup.subtitle : (isAr ? "اختر ملفًا من القائمة لبدء المراجعة التفصيلية." : "Choose a file from the list to start detailed review.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => activeGroup && void publishGroup(activeGroup)} disabled={!activeGroup || activeGroup.questions.length === 0 || busy !== null}>
                <ClipboardCheck size={14} /> {isAr ? "نشر الملف كامل" : "Publish file"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void publishVisible()} disabled={!activeGroup || visibleQuestions.length === 0 || busy !== null}>
                <CheckCircle2 size={14} /> {isAr ? "نشر المعروض" : "Publish visible"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void reprocessActiveFile()} disabled={!activeGroup?.file || busy !== null}>
                <RotateCcw size={14} /> {isAr ? "إعادة معالجة" : "Reprocess"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeleteGroupConfirm(true)} disabled={!activeGroup || (!activeGroup.file && activeGroup.questions.length === 0) || busy !== null}>
                <Trash2 size={14} /> {activeGroup?.file ? (isAr ? "حذف الملف كامل" : "Delete file") : (isAr ? "حذف المجموعة" : "Delete group")}
              </Button>
            </div>
          </div>

          {deleteGroupConfirm && activeGroup && (
            <Alert variant="destructive" className="space-y-3">
              <div>
                <p className="font-semibold">
                  {activeGroup.file
                    ? (isAr ? "تأكيد حذف الملف كامل" : "Confirm full file deletion")
                    : (isAr ? "تأكيد حذف مجموعة الأسئلة" : "Confirm question group deletion")}
                </p>
                <p className="mt-1">
                  {activeGroup.file
                    ? (isAr
                      ? `سيتم حذف ملف "${activeGroup.title}" ومعه ${activeGroup.questions.length} سؤال/أسئلة مستخرجة. لا يمكن التراجع من داخل الموقع.`
                      : `This will delete "${activeGroup.title}" and its ${activeGroup.questions.length} extracted question(s). This cannot be undone inside the site.`)
                    : (isAr
                      ? `سيتم حذف ${activeGroup.questions.length} سؤال/أسئلة من هذه المجموعة. لا يوجد ملف أصلي مرتبط بها.`
                      : `This will delete ${activeGroup.questions.length} question(s) from this group. There is no source file attached to it.`)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" onClick={() => void deleteActiveGroup()} disabled={busy !== null}>
                  <Trash2 size={14} /> {activeGroup.file ? (isAr ? "نعم، احذف الملف والأسئلة" : "Yes, delete file and questions") : (isAr ? "نعم، احذف الأسئلة" : "Yes, delete questions")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeleteGroupConfirm(false)} disabled={busy !== null}>
                  <X size={14} /> {t("common.cancel")}
                </Button>
              </div>
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label={isAr ? "الإجمالي" : "Total"} value={scopedStats.total} />
            <MetricCard label={isAr ? "بلا إجابة" : "Missing answers"} value={scopedStats.missingAnswer} tone="danger" />
            <MetricCard label={isAr ? "ثقة منخفضة" : "Low confidence"} value={scopedStats.lowConfidence} tone="warning" />
            <MetricCard label={isAr ? "منشورة" : "Published"} value={scopedStats.published} tone="success" />
          </div>

          <div>
            <div className="mb-2 flex justify-between text-xs text-muted-foreground">
              <span>{isAr ? "جاهزية النشر" : "Publish readiness"}</span>
              <span>{scopedStats.readyPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${scopedStats.readyPercent}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-2.5 text-muted-foreground" size={16} />
              <Input
                className="ps-9"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={isAr ? "بحث داخل الملف المفتوح..." : "Search inside the open file..."}
                disabled={!activeGroup}
              />
            </div>
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={mode} onChange={event => setMode(event.target.value as ReviewMode)}>
              {modeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={activeGroupKey} onChange={event => selectGroup(event.target.value)}>
              <option value={ALL_GROUP_KEY}>{isAr ? "كل الملفات - نظرة عامة" : "All files - overview"}</option>
              {groups.map(group => <option key={group.key} value={group.key}>{group.title}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Filter size={14} />
            <span>{isAr ? `${visibleQuestions.length} سؤال ظاهر` : `${visibleQuestions.length} visible question(s)`}</span>
            <span>·</span>
            <span>{isAr ? `${dirtyVisibleQuestions.length} تعديل غير محفوظ` : `${dirtyVisibleQuestions.length} unsaved change(s)`}</span>
            <Button size="sm" variant="outline" onClick={() => void saveChanged()} disabled={dirtyVisibleQuestions.length === 0 || busy !== null} className="ms-auto">
              <Save size={14} /> {isAr ? "حفظ التعديلات" : "Save changes"}
            </Button>
          </div>
          {message && <Alert variant="info">{message}</Alert>}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <button
            type="button"
            onClick={() => selectGroup(ALL_GROUP_KEY)}
            className={cn(
              "w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm transition hover:border-accent/60",
              activeGroupKey === ALL_GROUP_KEY && "border-accent bg-accent/5",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-primary">{isAr ? "كل الملفات" : "All files"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{groups.length} {isAr ? "مجموعة ملفات" : "file group(s)"}</p>
              </div>
              <ChevronRight size={18} className={cn("text-muted-foreground", isAr && "rotate-180")} />
            </div>
            <FileProgress stats={allStats} />
          </button>

          <div className="space-y-2">
            {groups.map(group => (
              <button
                key={group.key}
                type="button"
                onClick={() => selectGroup(group.key)}
                className={cn(
                  "w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm transition hover:border-accent/60 hover:bg-muted/20",
                  activeGroupKey === group.key && "border-accent bg-accent/5",
                  group.orphan && "border-destructive/25",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <FileText size={15} className={group.orphan ? "text-destructive" : "text-accent"} />
                      <Badge variant={group.stats.needsWork > 0 ? "outline" : "success"}>
                        {group.stats.needsWork > 0 ? (isAr ? "مراجعة" : "Review") : (isAr ? "جاهز" : "Ready")}
                      </Badge>
                    </div>
                    <p className="break-words font-semibold text-primary">{group.title}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{group.subtitle}</p>
                  </div>
                  <ChevronRight size={18} className={cn("mt-1 shrink-0 text-muted-foreground", isAr && "rotate-180")} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <MiniStat label={isAr ? "سؤال" : "Q"} value={group.stats.total} />
                  <MiniStat label={isAr ? "بلا إجابة" : "Missing"} value={group.stats.missingAnswer} danger={group.stats.missingAnswer > 0} />
                  <MiniStat label={isAr ? "منشور" : "Pub"} value={group.stats.published} success={group.stats.published > 0} />
                </div>
                <FileProgress stats={group.stats} />
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {!activeGroup ? (
            <Card>
              <CardContent className="flex min-h-72 flex-col items-center justify-center text-center">
                <FileText className="mb-3 text-accent" size={42} />
                <h2 className="text-lg font-semibold text-primary">
                  {isAr ? "اختر ملفًا من القائمة" : "Choose a file from the list"}
                </h2>
                <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                  {isAr
                    ? "بهذا الشكل تراجع ملفًا واحدًا في كل مرة، وهذا يقلل الأخطاء ويسهل النشر."
                    : "Reviewing one file at a time keeps the workflow clear and reduces mistakes."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {activeGroup.orphan && (
                <Alert variant="destructive">
                  {isAr
                    ? "هذه مجموعة أسئلة لا يظهر لها ملف أصلي في صفحة الملفات. تقدر تعدلها وتنشرها، لكن لا يمكن إعادة معالجة ملفها لأنها غير مرتبطة بملف معروف."
                    : "This question group has no known source file. You can edit and publish it, but it cannot be reprocessed because it is not linked to a known file."}
                </Alert>
              )}

              {visibleQuestions.map((question) => {
                const draft = getDraft(question, drafts);
                const missingAnswer = !draft.answerText.trim();
                const lowConfidence = question.confidence < 0.7;
                const dirty = isDirty(question, drafts);
                const deleting = deleteCandidateId === question.id;

                return (
                  <Card key={question.id} className={cn("overflow-hidden", missingAnswer && "border-destructive/30", lowConfidence && !missingAnswer && "border-accent/30")}>
                    <CardContent className="space-y-4 pt-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={question.published ? "success" : "outline"}>
                            {question.published ? (isAr ? "منشور" : "Published") : (isAr ? "مسودة" : "Draft")}
                          </Badge>
                          {missingAnswer && <Badge variant="outline" className="border-destructive/30 text-destructive">{isAr ? "بلا إجابة" : "Missing answer"}</Badge>}
                          {lowConfidence && <Badge variant="outline" className="border-accent/30 text-accent">{isAr ? "ثقة منخفضة" : "Low confidence"}</Badge>}
                          {dirty && <Badge variant="ai">{isAr ? "غير محفوظ" : "Unsaved"}</Badge>}
                          <span>{t("admin.review.confidence")}: {(question.confidence * 100).toFixed(0)}%</span>
                          <span>{t("admin.review.page")} {question.pageNumber ?? "-"}</span>
                          {question.questionNumber && <span>#{question.questionNumber}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void saveQuestion(question)} disabled={!dirty || busy !== null}>
                            <Save size={14} /> {t("common.save")}
                          </Button>
                          <Button size="sm" onClick={() => void saveQuestion(question, true)} disabled={busy !== null || missingAnswer}>
                            <CheckCircle2 size={14} /> {isAr ? "حفظ ونشر" : "Save & publish"}
                          </Button>
                        </div>
                      </div>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">{isAr ? "نص السؤال" : "Question text"}</span>
                        <Textarea
                          rows={3}
                          value={draft.questionText}
                          onChange={(event) => updateDraft(question, { questionText: event.target.value })}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">{isAr ? "الإجابة المعتمدة" : "Approved answer"}</span>
                        <Textarea
                          rows={4}
                          value={draft.answerText}
                          onChange={(event) => updateDraft(question, { answerText: event.target.value })}
                          placeholder={isAr ? "اكتب أو صحح الإجابة هنا قبل النشر..." : "Write or correct the answer here before publishing..."}
                        />
                      </label>

                      {deleting ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                          <span className="text-destructive">{isAr ? "متأكد من حذف هذا السؤال؟" : "Are you sure you want to delete this question?"}</span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="destructive" onClick={() => void removeQuestion(question)} disabled={busy !== null}>
                              <Trash2 size={14} /> {isAr ? "نعم، احذف" : "Yes, delete"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDeleteCandidateId(null)} disabled={busy !== null}>
                              <X size={14} /> {t("common.cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setDeleteCandidateId(question.id)} disabled={busy !== null}>
                            <Trash2 size={14} className="text-destructive" /> {t("common.delete")}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {visibleQuestions.length === 0 && (
                <Card>
                  <CardContent className="flex min-h-56 flex-col items-center justify-center text-center">
                    <CheckCircle2 className="mb-3 text-success" size={38} />
                    <h2 className="text-lg font-semibold text-primary">{isAr ? "لا توجد أسئلة مطابقة" : "No matching questions"}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {isAr ? "جرّب تغيير الفلتر أو البحث." : "Try changing the filter or search."}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-card/80 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 text-3xl font-bold",
        tone === "success" && "text-success",
        tone === "warning" && "text-accent",
        tone === "danger" && "text-destructive",
      )}>
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value, danger, success }: { label: string; value: number; danger?: boolean; success?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("font-bold", danger && "text-destructive", success && "text-success")}>{value}</p>
    </div>
  );
}

function FileProgress({ stats }: { stats: ReviewStats }) {
  return (
    <div className="mt-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${stats.readyPercent}%` }} />
      </div>
    </div>
  );
}
