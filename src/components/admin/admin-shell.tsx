"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderTree,
  Layers,
  GraduationCap,
  BookOpen,
  ListChecks,
  FileUp,
  FileSearch,
  Sparkles,
  LogOut,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/locale-provider";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { href: "/admin/categories", icon: FolderTree, key: "categories" },
  { href: "/admin/specializations", icon: Layers, key: "specializations" },
  { href: "/admin/levels", icon: GraduationCap, key: "levels" },
  { href: "/admin/courses", icon: BookOpen, key: "courses" },
  { href: "/admin/assignments", icon: ListChecks, key: "assignments" },
  { href: "/admin/files", icon: FileUp, key: "files" },
  { href: "/admin/questions-review", icon: FileSearch, key: "questionsReview" },
  { href: "/admin/ai-review", icon: Sparkles, key: "aiReview" },
] as const;

export function AdminShell({ children, email }: { children: React.ReactNode; email: string }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-e border-border bg-card p-4 md:flex md:flex-col">
        <div className="mb-6 flex items-center gap-2 px-2 font-bold text-primary">
          <LayoutDashboard size={18} /> {t("admin.dashboard")}
        </div>
        <nav className="flex-1 space-y-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.href ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <item.icon size={16} />
              {t(`admin.menu.${item.key}`)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border pt-3">
          <p className="mb-2 truncate px-2 text-xs text-muted-foreground">{email}</p>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <LogOut size={16} /> {t("admin.logout")}
          </button>
        </div>
      </aside>
      <div className="flex-1">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4">
          <Link href="/" className="text-sm font-medium text-accent hover:underline">
            {t("nav.home")}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
