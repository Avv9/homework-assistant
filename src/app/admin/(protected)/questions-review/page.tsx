"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/primitives";
import { Trash2, Save } from "lucide-react";
import type { ExtractedQuestion, SourceFile } from "@/lib/types";

export default function QuestionsReviewPage() {
  const { t } = useLocale();
  const [questions, setQuestions] = useState<ExtractedQuestion[]>([]);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { questionText: string; answerText: string }>>({});

  const load = () => {
    fetch("/api/admin/questions").then((r) => r.json()).then((qs: ExtractedQuestion[]) => {
      setQuestions(qs);
      setDrafts(Object.fromEntries(qs.map((q) => [q.id, { questionText: q.questionText, answerText: q.answerText }])));
    });
    fetch("/api/admin/files").then((r) => r.json()).then(setFiles);
  };
  useEffect(load, []);

  const saveQuestion = async (id: string) => {
    const d = drafts[id];
    await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...d }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/questions?id=${id}`, { method: "DELETE" });
    load();
  };

  const publishAll = async (fileId: string) => {
    await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishAllForFile: fileId }),
    });
    load();
  };

  const pendingFiles = files.filter((f) => f.status === "needs_review");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("admin.menu.questionsReview")}</h1>

      {pendingFiles.map((file) => {
        const fileQuestions = questions.filter((q) => q.sourceFileId === file.id);
        return (
          <Card key={file.id} className="mb-6">
            <CardContent className="pt-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold">{file.fileName}</p>
                <Button size="sm" onClick={() => publishAll(file.id)}>
                  {t("admin.review.publishAll")}
                </Button>
              </div>
              <div className="space-y-4">
                {fileQuestions.map((q) => (
                  <div key={q.id} className="rounded-md border border-border p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {t("admin.review.confidence")}: {(q.confidence * 100).toFixed(0)}% · {t("admin.review.page")} {q.pageNumber ?? "-"}
                    </p>
                    <Textarea
                      rows={2}
                      value={drafts[q.id]?.questionText ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [q.id]: { ...drafts[q.id], questionText: e.target.value } })}
                      className="mb-2"
                    />
                    <Textarea
                      rows={3}
                      value={drafts[q.id]?.answerText ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [q.id]: { ...drafts[q.id], answerText: e.target.value } })}
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
        );
      })}
      {pendingFiles.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
    </div>
  );
}
