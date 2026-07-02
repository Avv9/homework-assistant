import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { DEMO_ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  if (config.supabaseUrl) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEMO_ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
