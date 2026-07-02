"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Pencil, Trash2, Plus, Eye, EyeOff } from "lucide-react";
import type { Assignment, Course } from "@/lib/types";

export default function AssignmentsPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<Assignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<Partial<Assignment> | null>(null);

  const load = () => {
    fetch("/api/admin/assignments").then((r) => r.json()).then(setItems);
    fetch("/api/admin/courses").then((r) => r.json()).then(setCourses);
  };
  useEffect(load, []);

  const save = async () => {
    if (!editing) return;
    await fetch("/api/admin/assignments", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await fetch(`/api/admin/assignments?id=${id}`, { method: "DELETE" });
    load();
  };

  const toggleActive = async (item: Assignment) => {
    await fetch("/api/admin/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
    });
    load();
  };

  const courseName = (id: string) => {
    const c = courses.find((c) => c.id === id);
    return c ? (locale === "ar" ? c.nameAr : c.nameEn) : "";
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">{t("admin.menu.assignments")}</h1>
        <Button onClick={() => setEditing({ nameAr: "", nameEn: "", courseId: courses[0]?.id })}>
          <Plus size={16} /> {t("common.add")}
        </Button>
      </div>

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-5">
            <Input placeholder="AR" value={editing.nameAr ?? ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} />
            <Input placeholder="EN" value={editing.nameEn ?? ""} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} />
            <select
              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
              value={editing.courseId ?? ""}
              onChange={(e) => setEditing({ ...editing, courseId: e.target.value })}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === "ar" ? c.nameAr : c.nameEn}
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

      <div className="space-y-2">
        {items.map((item) => (
          <Card key={item.id} className="flex flex-row items-center justify-between p-4">
            <div>
              <p className="font-medium">{locale === "ar" ? item.nameAr : item.nameEn}</p>
              <p className="text-xs text-muted-foreground">{courseName(item.courseId)}</p>
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
