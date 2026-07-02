"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Laptop2, BookOpen, Moon } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/primitives";
import type { Category } from "@/lib/types";

const ICONS: Record<string, React.ElementType> = { cci: Laptop2, general: BookOpen, islamic: Moon };

export default function HomePage() {
  const { t, locale } = useLocale();
  const [categories, setCategories] = useState<Category[] | null>(null);

  useEffect(() => {
    fetch("/api/public/categories")
      .then(r => r.json())
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-10 text-center fade-in">
        <h1 className="text-3xl font-bold text-primary sm:text-4xl">{t("home.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("home.subtitle")}</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {categories === null
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)
          : categories.map((cat, idx) => {
              const Icon = ICONS[cat.slug] ?? BookOpen;
              const title = locale === "ar" ? cat.nameAr : cat.nameEn;
              return (
                <Link href={`/category/${cat.slug}`} key={cat.id} className="group">
                  <Card
                    className="fade-in h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-accent/50"
                    style={{ animationDelay: `${idx * 80}ms` }}
                  >
                    <CardHeader>
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon size={24} />
                      </div>
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{locale === "ar" ? cat.nameAr : cat.nameEn}</CardDescription>
                    </CardHeader>
                    <CardContent />
                  </Card>
                </Link>
              );
            })}
      </div>
    </div>
  );
}
