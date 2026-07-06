import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FaGithub, FaTelegramPlane } from "react-icons/fa";

import "./globals.css";

import { Providers } from "@/components/providers/providers";
import { SiteHeader } from "@/components/shared/site-header";
import { DemoModeBanner } from "@/components/shared/demo-mode-banner";

export const metadata: Metadata = {
  title: "Homework Answer Assistant | مساعد إجابات الواجبات",
  description: "Find approved answers to your university homework instantly.",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <SiteHeader />

          <DemoModeBanner />

          <main className="flex-1">{children}</main>

          <footer className="border-t border-border py-5 text-xs text-muted-foreground">
            <div className="relative mx-auto flex max-w-7xl flex-col items-center justify-center gap-4 px-6 md:min-h-10">
              <p className="text-center">
                Homework Answer Assistant — مساعد إجابات الواجبات
              </p>

              <div
                className="flex flex-wrap items-center justify-center gap-2 md:absolute md:left-6"
                dir="ltr"
              >
                <a
                  href="https://github.com/Avv9"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="فتح حساب GitHub الخاص بـ Avv9"
                  className="group inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 font-medium text-muted-foreground transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted hover:text-foreground hover:shadow-sm"
                >
                  <FaGithub className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" />

                  <span>@Avv9</span>
                </a>

                <a
                  href="https://t.me/F_MJEED"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="فتح حساب Telegram الخاص بـ F_MJEED"
                  className="group inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 font-medium text-muted-foreground transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted hover:text-foreground hover:shadow-sm"
                >
                  <FaTelegramPlane className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:scale-110" />

                  <span>@F_MJEED</span>
                </a>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}