"use client";

import React from "react";
import { ThemeProvider } from "./theme-provider";
import { LocaleProvider } from "@/lib/i18n/locale-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LocaleProvider>{children}</LocaleProvider>
    </ThemeProvider>
  );
}
