"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Breadcrumbs, Crumb } from "@/components/shared/breadcrumbs";
import { SelectionGrid, SelectionItem } from "@/components/shared/selection-grid";
import { Skeleton } from "@/components/ui/primitives";
import type { Course, Assignment, Specialization, Level, Category } from "@/lib/types";

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t, locale } = useLocale();
  const [course, setCourse] = useState<Course | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [items, setItems] = useState<SelectionItem[] | null>(null);

  useEffect(() => {
    if (!courseId) return;
    fetch(`/api/public/courses?id=${courseId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (c: Course | null) => {
        if (!c) return;
        setCourse(c);

        const [assignments, cat]: [Assignment[], Category] = await Promise.all([
          fetch(`/api/public/assignments?courseId=${c.id}`).then(r => r.json()),
          fetch(`/api/public/categories?slug=cci`).then(r => r.json()).catch(() => null),
        ]);

        setItems(assignments.map(a => ({ id: a.id, href: `/assignment/${a.id}`, title: locale === "ar" ? a.nameAr : a.nameEn })));

        const bc: Crumb[] = [];
        if (cat) bc.push({ label: locale === "ar" ? cat.nameAr : cat.nameEn, href: `/category/${cat.slug}` });

        if (c.specializationId) {
          const spec: Specialization = await fetch(`/api/public/specializations?id=${c.specializationId}`).then(r => r.json());
          bc.push({ label: locale === "ar" ? spec.nameAr : spec.nameEn, href: `/specialization/${spec.id}` });
        }
        if (c.levelId) {
          const lv: Level = await fetch(`/api/public/levels?id=${c.levelId}`).then(r => r.json());
          bc.push({ label: locale === "ar" ? lv.nameAr : lv.nameEn, href: `/level/${lv.id}` });
        }
        bc.push({ label: locale === "ar" ? c.nameAr : c.nameEn });
        setCrumbs(bc);
      });
  }, [courseId, locale]);

  const courseName = course ? (locale === "ar" ? course.nameAr : course.nameEn) : "…";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Breadcrumbs items={crumbs} />
      <h1 className="mb-1 text-2xl font-bold text-primary">{courseName}</h1>
      {course && (
        <p className="mb-6 text-sm text-muted-foreground">{locale === "ar" ? course.descriptionAr : course.descriptionEn}</p>
      )}
      <h2 className="mb-4 text-lg font-semibold">{t("assignments.title")}</h2>
      {items === null
        ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-20"/>)}</div>
        : <SelectionGrid items={items} emptyLabel={t("assignments.empty")} />}
    </div>
  );
}
