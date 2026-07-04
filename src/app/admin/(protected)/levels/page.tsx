"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Trash2, Plus } from "lucide-react";
import type { Level, Specialization } from "@/lib/types";

export default function LevelsPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<Level[]>([]);
  const [specs, setSpecs] = useState<Specialization[]>([]);
  const [editing, setEditing] = useState<Partial<Level> | null>(null);

  const load = () => {
    fetch("/api/admin/levels")
      .then((r) => r.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : data.items ?? []);
      });

    fetch("/api/admin/specializations")
      .then((r) => r.json())
      .then((data) => {
        setSpecs(Array.isArray(data) ? data : data.items ?? []);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    await fetch("/api/admin/levels", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/levels?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">{t("admin.menu.levels")}</h1>
        <Button onClick={() => setEditing({ nameAr: "", nameEn: "", specializationId: specs[0]?.id, number: 3 })}>
          <Plus size={16} /> {t("common.add")}
        </Button>
      </div>

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-5">
            <Input placeholder="AR" value={editing.nameAr ?? ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} />
            <Input placeholder="EN" value={editing.nameEn ?? ""} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} />
            <Input
              type="number"
              placeholder="Number"
              value={editing.number ?? 3}
              onChange={(e) => setEditing({ ...editing, number: Number(e.target.value) })}
            />
            <select
              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
              value={editing.specializationId ?? ""}
              onChange={(e) => setEditing({ ...editing, specializationId: e.target.value })}
            >
              {(Array.isArray(specs) ? specs : []).map((s) => (
                <option key={s.id} value={s.id}>
                  {locale === "ar" ? s.nameAr : s.nameEn}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button onClick={save}>{t("common.save")}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(Array.isArray(items) ? items : []).map((item) => (
          <Card key={item.id} className="flex flex-row items-center justify-between p-4">
            <p className="font-medium">{locale === "ar" ? item.nameAr : item.nameEn}</p>
            <Button variant="ghost" size="icon" onClick={() => remove(item.id)}>
              <Trash2 size={16} className="text-destructive" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}