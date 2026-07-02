"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-provider";

export function DemoModeBanner() {
  const { t } = useLocale();
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setIsDemo(Boolean(d.isDemoMode)))
      .catch(() => setIsDemo(false));
  }, []);

  if (!isDemo) return null;

  return (
    <div className="bg-accent/10 text-accent border-b border-accent/20 px-4 py-2 text-center text-xs font-medium">
      {t("common.demoModeBanner")}
    </div>
  );
}
