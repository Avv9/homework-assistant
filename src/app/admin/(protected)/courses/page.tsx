"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Pencil, Trash2, Plus, Eye, EyeOff } from "lucide-react";
import type { Category, Course, Level, Specialization } from "@/lib/types";

export default function CoursesPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<Course[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [specs, setSpecs] = useState<Specialization[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [editing, setEditing] = useState<Partial<Course> | null>(null);

  const load = () => {
    fetch("/api/admin/courses").then((r) => r.json()).then(setItems);
    fetch("/api/admin/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/admin/specializations").then((r) => r.json()).then(setSpecs);
    fetch("/api/admin/levels").then((r) => r.json()).then(setLevels);
  };
  useEffect(load, []);

  const save = async () => {
    if (!editing) return;
    await fetch("/api/admin/courses", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/courses?id=${id}`, { method: "DELETE" });
    load();
  };

  const toggleActive = async (item: Course) => {
    await fetch("/api/admin/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
    });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">{t("admin.menu.courses")}</h1>
        <Button onClick={() => setEditing({ nameAr: "", nameEn: "", categoryId: categories[0]?.id, code: "" })}>
          <Plus size={16} /> {t("common.add")}
        </Button>
      </div>

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-5">
            <Input placeholder="AR name" value={editing.nameAr ?? ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} />
            <Input placeholder="EN name" value={editing.nameEn ?? ""} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} />
            <Input placeholder="Code" value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            <select
              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
              value={editing.categoryId ?? ""}
              onChange={(e) => setEditing({ ...editing, categoryId: e.target.value, specializationId: null, levelId: null })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === "ar" ? c.nameAr : c.nameEn}
                </option>
              ))}
            </select>
            {categories.find((c) => c.id === editing.categoryId)?.requiresSpecialization && (
              <>
                <select
                  className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                  value={editing.specializationId ?? ""}
                  onChange={(e) => setEditing({ ...editing, specializationId: e.target.value })}
                >
                  <option value="">--</option>
                  {specs
                    .filter((s) => s.categoryId === editing.categoryId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {locale === "ar" ? s.nameAr : s.nameEn}
                      </option>
                    ))}
                </select>
                <select
                  className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                  value={editing.levelId ?? ""}
                  onChange={(e) => setEditing({ ...editing, levelId: e.target.value })}
                >
                  <option value="">--</option>
                  {levels
                    .filter((l) => l.specializationId === editing.specializationId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {locale === "ar" ? l.nameAr : l.nameEn}
                      </option>
                    ))}
                </select>
              </>
            )}
            <div className="flex gap-2">
              <Button onClick={save}>{t("common.save")}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <Card key={item.id} className="flex flex-row items-center justify-between p-4">
            <div>
              <p className="font-medium">{locale === "ar" ? item.nameAr : item.nameEn}</p>
              <p className="text-xs text-muted-foreground">{item.code}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                {item.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setEditing(item)}>
                <Pencil size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => remove(item.id)}>
                <Trash2 size={16} className="text-destructive" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
