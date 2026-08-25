"use client";

import Link from "next/link";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const { t } = useLocale();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GraduationCap size={20} />
          </span>
          <span className="hidden text-base sm:inline">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            aria-label={t("nav.admin")}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-muted/40 px-3 text-sm font-medium text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
          >
            <ShieldCheck size={16} />
            <span className="hidden sm:inline">{t("nav.admin")}</span>
          </Link>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
