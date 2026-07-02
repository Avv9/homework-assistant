"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/primitives";
import { Check, X, Trash2 } from "lucide-react";
import type { AiGeneratedAnswer } from "@/lib/types";

export default function AiReviewPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<AiGeneratedAnswer[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = () => {
    fetch("/api/admin/ai-answers").then((r) => r.json()).then((data: AiGeneratedAnswer[]) => {
      setItems(data);
      setDrafts(Object.fromEntries(data.map((d) => [d.id, d.answerText])));
    });
  };
  useEffect(load, []);

  const approve = async (id: string) => {
    await fetch("/api/admin/ai-answers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "approve", answerText: drafts[id] }),
    });
    load();
  };

  const ignore = async (id: string) => {
    await fetch("/api/admin/ai-answers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "ignore" }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/ai-answers?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.menu.aiReview")}</h1>
      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="pt-5">
              <p className="mb-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString(locale)}</p>
              <p className="mb-3 font-medium">{item.questionText}</p>
              <Textarea rows={4} value={drafts[item.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [item.id]: e.target.value })} />
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => approve(item.id)}>
                  <Check size={14} /> {t("admin.aiReview.approve")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => ignore(item.id)}>
                  <X size={14} /> {t("admin.aiReview.ignore")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                  <Trash2 size={14} className="text-destructive" />
                </Button>
              </div>
              {item.reviewed && (
                <p className="mt-2 text-xs text-success">{item.approved ? "Approved" : "Reviewed"}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
      </div>
    </div>
  );
}
