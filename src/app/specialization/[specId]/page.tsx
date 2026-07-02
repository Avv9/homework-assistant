"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { SelectionGrid, SelectionItem } from "@/components/shared/selection-grid";
import { Skeleton } from "@/components/ui/primitives";
import type { Specialization, Category, Level } from "@/lib/types";

export default function SpecializationPage() {
  const { specId } = useParams<{ specId: string }>();
  const { t, locale } = useLocale();
  const [spec, setSpec] = useState<Specialization | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [items, setItems] = useState<SelectionItem[] | null>(null);

  useEffect(() => {
    if (!specId) return;
    fetch(`/api/public/specializations?id=${specId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (s: Specialization | null) => {
        if (!s) return;
        setSpec(s);
        const [cat, levels]: [Category, Level[]] = await Promise.all([
          fetch(`/api/public/categories?slug=cci`).then(r => r.json()),
          fetch(`/api/public/levels?specializationId=${s.id}`).then(r => r.json()),
        ]);
        setCategory(cat);
        setItems(levels.map(l => ({ id: l.id, href: `/level/${l.id}`, title: locale === "ar" ? l.nameAr : l.nameEn })));
      });
  }, [specId, locale]);

  const specName = spec ? (locale === "ar" ? spec.nameAr : spec.nameEn) : "…";
  const catName = category ? (locale === "ar" ? category.nameAr : category.nameEn) : "…";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Breadcrumbs items={[
        { label: catName, href: `/category/cci` },
        { label: specName },
      ]} />
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("level.title")}</h1>
      {items === null
        ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-20"/>)}</div>
        : <SelectionGrid items={items} />}
    </div>
  );
}
