"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  const { t } = useLocale();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <FileQuestion size={48} className="mb-4 text-muted-foreground" />
      <h1 className="text-2xl font-bold text-primary">{t("notFound.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("notFound.desc")}</p>
      <Link href="/">
        <Button className="mt-6">{t("notFound.back")}</Button>
      </Link>
    </div>
  );
}
