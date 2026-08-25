"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/locale-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

const DEFAULT_ADMIN_PATH = "/admin/dashboard";

function getSafeAdminRedirectPath() {
  if (typeof window === "undefined") return DEFAULT_ADMIN_PATH;

  const redirectedFrom = new URLSearchParams(window.location.search).get("redirectedFrom");
  if (!redirectedFrom || !redirectedFrom.startsWith("/admin") || redirectedFrom.startsWith("/admin/login")) {
    return DEFAULT_ADMIN_PATH;
  }

  try {
    const url = new URL(redirectedFrom, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/admin")) return DEFAULT_ADMIN_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_ADMIN_PATH;
  }
}

export default function AdminLoginPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;

    void fetch("/api/admin/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          router.replace(getSafeAdminRedirectPath());
          router.refresh();
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  const getErrorMessage = (code?: string) => {
    if (code === "not_admin") return t("admin.login.notAdmin");
    if (code === "admin_verification_unavailable") return t("admin.login.verificationUnavailable");
    return t("admin.login.error");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(getErrorMessage(payload?.error));
        return;
      }
      router.replace(getSafeAdminRedirectPath());
      router.refresh();
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md items-center px-4 py-10">
      <Card className="w-full overflow-hidden border-primary/10 shadow-xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <ShieldCheck size={26} />
          </div>
          <div>
            <CardTitle>{t("admin.login.title")}</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">{t("admin.login.subtitle")}</p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {checkingSession && (
            <Alert variant="info" className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("admin.login.checking")}
            </Alert>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("admin.login.email")}</label>
              <Input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || checkingSession}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("admin.login.password")}</label>
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || checkingSession}
              />
            </div>

            <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={loading || checkingSession}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("admin.login.signingIn")}
                </>
              ) : (
                t("admin.login.submit")
              )}
            </Button>
          </form>

          <div className="flex flex-col gap-2 border-t border-border pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{t("admin.login.sessionHint")}</span>
            <Link href="/" className="font-medium text-accent hover:underline">
              {t("admin.login.backHome")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
