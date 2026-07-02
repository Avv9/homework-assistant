import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "./config";
import type { Admin, AdminRole } from "./types";

const DEMO_SESSION_COOKIE = "haa_admin_session";

export const DEMO_ADMIN_COOKIE_NAME = DEMO_SESSION_COOKIE;

export function buildDemoSessionCookieValue(email: string) {
  return Buffer.from(JSON.stringify({ email, at: Date.now() })).toString("base64");
}

/** Returns the authenticated admin record or null. Server-only. */
export async function getAdminSession(): Promise<{ email: string } | null> {
  if (config.isDemoMode || !config.supabaseUrl) {
    const cookieStore = await cookies();
    const session = cookieStore.get(DEMO_SESSION_COOKIE);
    if (!session) return null;
    try {
      const parsed = JSON.parse(Buffer.from(session.value, "base64").toString("utf-8"));
      if (parsed?.email) return { email: parsed.email };
      return null;
    } catch { return null; }
  }
  const { createClient } = await import("./supabase/server");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  return { email: data.user.email };
}

/** Resolves the full Admin object for the current session, using service-role. */
export async function getFullAdmin(): Promise<Admin | null> {
  const session = await getAdminSession();
  if (!session) return null;

  if (config.isDemoMode || !config.supabaseUrl) {
    // Demo mode: synthesise an owner record
    return {
      id: "demo-owner",
      email: process.env.ADMIN_EMAIL ?? "admin@example.com",
      role: "owner" as AdminRole,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const { createServiceClient } = await import("./supabase/server");
  const sb = await createServiceClient();
  // first resolve auth user id from email
  const { data: user } = await sb.auth.admin.listUsers();
  const authUser = (user?.users ?? []).find((u) => u.email === session.email);
  if (!authUser) return null;
  const { data: admin } = await sb.from("admins").select("*").eq("id", authUser.id).eq("is_active", true).maybeSingle();
  if (!admin) return null;
  return {
    id: admin.id, email: admin.email, fullName: admin.full_name ?? undefined,
    role: admin.role as AdminRole, isActive: admin.is_active,
    createdAt: admin.created_at, updatedAt: admin.updated_at,
  };
}

// ─── Role permission matrix ──────────────────────────────────────────────────

const ROLE_RANK: Record<AdminRole, number> = { viewer: 0, reviewer: 1, editor: 2, owner: 3 };

export function hasRole(admin: Admin, minimum: AdminRole): boolean {
  return admin.isActive && ROLE_RANK[admin.role] >= ROLE_RANK[minimum];
}

// ─── Route guard helper ──────────────────────────────────────────────────────

export type GuardResult =
  | { ok: true; admin: Admin }
  | { ok: false; response: NextResponse };

/**
 * requireAdmin(minimumRole)
 * Use at the top of every /api/admin/* route handler.
 * Returns the authenticated Admin or a ready-to-return 401/403 Response.
 *
 * @example
 * const guard = await requireAdmin("editor");
 * if (!guard.ok) return guard.response;
 * const { admin } = guard;
 */
export async function requireAdmin(minimumRole: AdminRole = "viewer"): Promise<GuardResult> {
  const admin = await getFullAdmin();
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  if (!hasRole(admin, minimumRole)) {
    return { ok: false, response: NextResponse.json({ error: "forbidden", required: minimumRole, current: admin.role }, { status: 403 }) };
  }
  return { ok: true, admin };
}
