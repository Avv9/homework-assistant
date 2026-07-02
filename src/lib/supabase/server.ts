import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { config } from "../config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component without write access; safe to ignore
          // because middleware refreshes the session.
        }
      },
    },
  });
}

/** Admin client using the service-role key. Server-only — never import from client components. */
export async function createServiceClient() {
  const { createClient: createSupabase } = await import("@supabase/supabase-js");
  return createSupabase(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
