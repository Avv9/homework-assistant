"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/primitives";
import { BookOpen, ListChecks, FileUp, ShieldCheck, Sparkles } from "lucide-react";

interface Stats {
  courses: number;
  assignments: number;
  files: number;
  approvedQuestions: number;
  pendingAiAnswers: number;
}

export default function DashboardPage() {
  const { t } = useLocale();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then(setStats);
  }, []);

  const cards = [
    { key: "courses", icon: BookOpen, value: stats?.courses },
    { key: "assignments", icon: ListChecks, value: stats?.assignments },
    { key: "files", icon: FileUp, value: stats?.files },
    { key: "approved", icon: ShieldCheck, value: stats?.approvedQuestions },
    { key: "pendingAi", icon: Sparkles, value: stats?.pendingAiAnswers },
  ] as const;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.dashboard")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.key} className="fade-in">
            <CardHeader className="flex flex-row items-center justify-between pb-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t(`admin.stats.${c.key}`)}</CardTitle>
              <c.icon size={18} className="text-accent" />
            </CardHeader>
            <CardContent>
              {c.value === undefined ? <Skeleton className="h-8 w-16" /> : <p className="text-3xl font-bold">{c.value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
