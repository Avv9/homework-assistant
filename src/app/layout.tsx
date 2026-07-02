import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/providers";
import { SiteHeader } from "@/components/shared/site-header";
import { DemoModeBanner } from "@/components/shared/demo-mode-banner";

export const metadata: Metadata = {
  title: "Homework Answer Assistant | مساعد إجابات الواجبات",
  description: "Find approved answers to your university homework instantly.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>
          <SiteHeader />
          <DemoModeBanner />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
            Homework Answer Assistant — مساعد إجابات الواجبات
          </footer>
        </Providers>
      </body>
    </html>
  );
}
