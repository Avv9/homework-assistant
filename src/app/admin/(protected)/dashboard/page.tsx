"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Clock, FileUp, ListChecks, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/primitives";

interface Stats {
  courses: number;
  assignments: number;
  files: number;
  approvedQuestions: number;
  pendingAiAnswers: number;
  extractedQuestions: number;
  draftQuestions: number;
  missingAnswerQuestions: number;
  lowConfidenceQuestions: number;
  averageConfidence: number;
  fileQueue: {
    total: number;
    uploaded: number;
    processing: number;
    needs_review: number;
    published: number;
    failed: number;
  };
}

function percent(value?: number) {
  if (typeof value !== "number") return undefined;
  return `${Math.round(value * 100)}%`;
}

export default function DashboardPage() {
  const { t, locale } = useLocale();
  const isAr = locale === "ar";
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const coreCards = [
    { label: t("admin.stats.courses"), icon: BookOpen, value: stats?.courses },
    { label: t("admin.stats.assignments"), icon: ListChecks, value: stats?.assignments },
    { label: t("admin.stats.files"), icon: FileUp, value: stats?.files },
    { label: t("admin.stats.approved"), icon: ShieldCheck, value: stats?.approvedQuestions },
    { label: t("admin.stats.pendingAi"), icon: Sparkles, value: stats?.pendingAiAnswers },
  ] as const;

  const queueCards = [
    { label: isAr ? "في الطابور" : "Queued files", icon: Clock, value: stats?.fileQueue.uploaded },
    { label: isAr ? "قيد المعالجة" : "Processing files", icon: FileUp, value: stats?.fileQueue.processing },
    { label: isAr ? "تحتاج مراجعة" : "Need review", icon: AlertTriangle, value: stats?.fileQueue.needs_review },
    { label: isAr ? "ملفات فاشلة" : "Failed files", icon: AlertTriangle, value: stats?.fileQueue.failed },
  ] as const;

  const qualityCards = [
    { label: isAr ? "الأسئلة المستخرجة" : "Extracted questions", icon: ListChecks, value: stats?.extractedQuestions },
    { label: isAr ? "غير منشورة" : "Unpublished questions", icon: Clock, value: stats?.draftQuestions },
    { label: isAr ? "بلا إجابة" : "Missing answers", icon: AlertTriangle, value: stats?.missingAnswerQuestions },
    { label: isAr ? "ثقة منخفضة" : "Low confidence", icon: AlertTriangle, value: stats?.lowConfidenceQuestions },
    { label: isAr ? "متوسط الثقة" : "Average confidence", icon: CheckCircle2, value: percent(stats?.averageConfidence) },
  ] as const;

  const renderCards = (cards: ReadonlyArray<{ label: string; icon: LucideIcon; value?: number | string }>) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label} className="fade-in">
          <CardHeader className="flex flex-row items-center justify-between pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            <card.icon size={18} className="text-accent" />
          </CardHeader>
          <CardContent>
            {card.value === undefined ? <Skeleton className="h-8 w-16" /> : <p className="text-3xl font-bold">{card.value}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.dashboard")}</h1>
        {renderCards(coreCards)}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-primary">{isAr ? "حالة معالجة الملفات" : "File processing status"}</h2>
        {renderCards(queueCards)}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-primary">{isAr ? "جودة الأسئلة المستخرجة" : "Extracted question quality"}</h2>
        {renderCards(qualityCards)}
      </section>
    </div>
  );
}
