import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { buildDemoSessionCookieValue, DEMO_ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  if (config.supabaseUrl) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  // Demo-mode admin auth, configured via ADMIN_EMAIL / ADMIN_PASSWORD env vars.
  const demoEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const demoPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

  if (email !== demoEmail || password !== demoPassword) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEMO_ADMIN_COOKIE_NAME, buildDemoSessionCookieValue(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
