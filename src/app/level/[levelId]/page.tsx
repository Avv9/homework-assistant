"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { SelectionGrid, SelectionItem } from "@/components/shared/selection-grid";
import { Skeleton } from "@/components/ui/primitives";
import type { Level, Specialization, Category, Course } from "@/lib/types";

export default function LevelPage() {
  const { levelId } = useParams<{ levelId: string }>();
  const { t, locale } = useLocale();
  const [level, setLevel] = useState<Level | null>(null);
  const [spec, setSpec] = useState<Specialization | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [items, setItems] = useState<SelectionItem[] | null>(null);

  useEffect(() => {
    if (!levelId) return;
    fetch(`/api/public/levels?id=${levelId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (l: Level | null) => {
        if (!l) return;
        setLevel(l);
        const [s, courses]: [Specialization, Course[]] = await Promise.all([
          fetch(`/api/public/specializations?id=${l.specializationId}`).then(r => r.json()),
          fetch(`/api/public/courses?levelId=${l.id}`).then(r => r.json()),
        ]);
        setSpec(s);
        const cat: Category = await fetch(`/api/public/categories?slug=cci`).then(r => r.json());
        setCategory(cat);
        setItems(courses.map(c => ({ id: c.id, href: `/course/${c.id}`, title: locale === "ar" ? c.nameAr : c.nameEn, description: c.code })));
      });
  }, [levelId, locale]);

  const levelName = level ? (locale === "ar" ? level.nameAr : level.nameEn) : "…";
  const specName = spec ? (locale === "ar" ? spec.nameAr : spec.nameEn) : "…";
  const catName = category ? (locale === "ar" ? category.nameAr : category.nameEn) : "…";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Breadcrumbs items={[
        { label: catName, href: `/category/cci` },
        { label: specName, href: spec ? `/specialization/${spec.id}` : "#" },
        { label: levelName },
      ]} />
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("courses.title")}</h1>
      {items === null
        ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-24"/>)}</div>
        : <SelectionGrid items={items} emptyLabel={t("courses.empty")} />}
    </div>
  );
}
