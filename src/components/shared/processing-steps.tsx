"use client";

import { Check, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { cn } from "@/lib/utils";

export function ProcessingSteps({ activeStep }: { activeStep: number }) {
  const { t } = useLocale();
  const steps = [t("question.step1"), t("question.step2"), t("question.step3"), t("question.step4")];

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-5">
      {steps.map((label, idx) => {
        const status = idx < activeStep ? "done" : idx === activeStep ? "active" : "pending";
        return (
          <div key={idx} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                status === "done" && "border-success bg-success text-success-foreground",
                status === "active" && "border-accent text-accent",
                status === "pending" && "border-border text-muted-foreground"
              )}
            >
              {status === "done" && <Check size={14} />}
              {status === "active" && <Loader2 size={14} className="animate-spin" />}
              {status === "pending" && <span className="text-xs">{idx + 1}</span>}
            </span>
            <span className={cn(status === "pending" ? "text-muted-foreground" : "text-foreground")}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
