"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { SelectionGrid, SelectionItem } from "@/components/shared/selection-grid";
import { Skeleton } from "@/components/ui/primitives";
import type { Category, Specialization, Course } from "@/lib/types";

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useLocale();
  const [category, setCategory] = useState<Category | null>(null);
  const [items, setItems] = useState<SelectionItem[] | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/public/categories?slug=${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (cat: Category | null) => {
        if (!cat) return;
        setCategory(cat);
        if (cat.requiresSpecialization) {
          const specs: Specialization[] = await fetch(`/api/public/specializations?categoryId=${cat.id}`).then(r => r.json());
          setItems(specs.map(s => ({ id: s.id, href: `/specialization/${s.id}`, title: locale === "ar" ? s.nameAr : s.nameEn })));
        } else {
          const courses: Course[] = await fetch(`/api/public/courses?categoryId=${cat.id}`).then(r => r.json());
          setItems(courses.map(c => ({ id: c.id, href: `/course/${c.id}`, title: locale === "ar" ? c.nameAr : c.nameEn, description: c.code })));
        }
      });
  }, [slug, locale]);

  const categoryName = category ? (locale === "ar" ? category.nameAr : category.nameEn) : "…";
  const heading = category?.requiresSpecialization ? t("specialization.title") : t("courses.title");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Breadcrumbs items={[{ label: categoryName }]} />
      <h1 className="mb-6 text-2xl font-bold text-primary">{heading}</h1>
      {items === null
        ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-24"/>)}</div>
        : <SelectionGrid items={items} emptyLabel={t("courses.empty")} />}
    </div>
  );
}
