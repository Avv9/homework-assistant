"use client";

import { useLocale } from "@/lib/i18n/locale-provider";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
      <Button
        variant={locale === "ar" ? "primary" : "ghost"}
        size="sm"
        className="h-7 px-2.5"
        onClick={() => setLocale("ar")}
        aria-pressed={locale === "ar"}
      >
        AR
      </Button>
      <Button
        variant={locale === "en" ? "primary" : "ghost"}
        size="sm"
        className="h-7 px-2.5"
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
      >
        EN
      </Button>
    </div>
  );
}
