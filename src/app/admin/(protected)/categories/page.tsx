"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Pencil, Trash2, Eye, EyeOff, Plus } from "lucide-react";
import type { Category } from "@/lib/types";

export default function CategoriesPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Partial<Omit<Category, "slug">> & { slug?: string } | null>(null);

  const load = () =>
    fetch("/api/admin/categories")
      .then((r) => r.json())
      .then((data) => {
        // 🔥 الحل هنا
        setItems(Array.isArray(data) ? data : data.items ?? []);
      });

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    const method = editing.id ? "PATCH" : "POST";
    await fetch("/api/admin/categories", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/categories?id=${id}`, { method: "DELETE" });
    load();
  };

  const toggleActive = async (item: Category) => {
    await fetch("/api/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
    });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">{t("admin.categories.title")}</h1>
        <Button onClick={() => setEditing({ slug: "", nameAr: "", nameEn: "", requiresSpecialization: false })}>
          <Plus size={16} /> {t("common.add")}
        </Button>
      </div>

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-5">
            <Input
              placeholder={t("admin.categories.nameAr")}
              value={editing.nameAr ?? ""}
              onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
            />
            <Input
              placeholder={t("admin.categories.nameEn")}
              value={editing.nameEn ?? ""}
              onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
            />
            <Input
              placeholder="slug"
              value={editing.slug ?? ""}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(editing.requiresSpecialization)}
                onChange={(e) => setEditing({ ...editing, requiresSpecialization: e.target.checked })}
              />
              Requires specialization
            </label>
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
        {/* 🔥 هنا التصحيح */}
        {(Array.isArray(items) ? items : []).map((item) => (
          <Card key={item.id} className="flex flex-row items-center justify-between p-4">
            <div>
              <p className="font-medium">{locale === "ar" ? item.nameAr : item.nameEn}</p>
              <p className="text-xs text-muted-foreground">{item.slug}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleActive(item)}
                title={item.isActive ? t("common.active") : t("common.hidden")}
              >
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