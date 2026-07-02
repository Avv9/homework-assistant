"use client";

import { useState } from "react";
import { Check, Copy, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/primitives";
import { MarkdownAnswer } from "./markdown-answer";
import { useLocale } from "@/lib/i18n/locale-provider";
import type { SearchResultItem } from "@/lib/types";

export function ResultCard({ result }: { result: SearchResultItem }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  const copyAnswer = () => {
    navigator.clipboard.writeText(result.answerMarkdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card className="fade-in">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("question.questionLabel", { n: result.questionIndex })}</p>
          <p className="mt-1 font-semibold">{result.questionText}</p>
        </div>
        {result.source === "approved" ? (
          <Badge variant="success">
            <ShieldCheck size={13} /> {t("question.approvedBadge")}
          </Badge>
        ) : (
          <Badge variant="ai">
            <Sparkles size={13} /> {t("question.aiBadge")}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("question.answerLabel")}</p>
        <MarkdownAnswer content={result.answerMarkdown} />

        {result.source === "ai" && (
          <p className="mt-3 rounded-md bg-accent/10 px-3 py-2 text-xs text-accent">{t("question.aiDisclaimer")}</p>
        )}

        <button
          onClick={copyAnswer}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t("question.copied") : t("question.copy")}
        </button>
      </CardContent>
    </Card>
  );
}
