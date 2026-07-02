"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t, dir } = useLocale();
  const Sep = dir === "rtl" ? ChevronLeft : ChevronRight;
  const all: Crumb[] = [{ label: t("breadcrumb.home"), href: "/" }, ...items];

  return (
    <nav aria-label="breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {all.map((item, idx) => (
        <span key={idx} className="flex items-center gap-1">
          {idx > 0 && <Sep size={14} className="opacity-60" />}
          {item.href && idx !== all.length - 1 ? (
            <Link href={item.href} className="hover:text-accent transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className={idx === all.length - 1 ? "font-medium text-foreground" : ""}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
