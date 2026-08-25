import { NextRequest, NextResponse } from "next/server";

const PUBLIC_ADMIN_PATHS = ["/admin/login"];

function isSupabaseAuthCookie(name: string) {
  return name.startsWith("sb-") && (name.endsWith("-auth-token") || /-auth-token\.\d+$/.test(name));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (PUBLIC_ADMIN_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const hasDemoSession = req.cookies.get("haa_admin_session");
  const hasSupabaseSession = req.cookies.getAll().some((c) => isSupabaseAuthCookie(c.name));

  if (!hasDemoSession && !hasSupabaseSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("redirectedFrom", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
