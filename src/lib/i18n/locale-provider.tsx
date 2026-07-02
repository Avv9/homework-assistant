"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import en from "./dictionaries/en.json";
import ar from "./dictionaries/ar.json";

export type Locale = "ar" | "en";

const dictionaries: Record<Locale, Record<string, unknown>> = { en, ar };

function getByPath(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  dir: "rtl" | "ltr";
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "homework-assistant-locale";

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ar");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (window.localStorage.getItem(STORAGE_KEY) as Locale | null) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "ar" || saved === "en") setLocaleState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = getByPath(dictionaries[locale], key) ?? getByPath(dictionaries.en, key) ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, dir: (locale === "ar" ? "rtl" : "ltr") as "rtl" | "ltr" }),
    [locale, setLocale, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
