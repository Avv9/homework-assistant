import { config } from "../config";
import type { AdminRepo, PublicRepo } from "./interface";

/**
 * Returns the public (unauthenticated) repository.
 * Server-side only — call from API routes and Server Components.
 */
export async function getPublicRepo(): Promise<PublicRepo> {
  if (config.isDemoMode || !config.supabaseUrl) {
    const { demoRepo } = await import("./demo");
    return demoRepo;
  }
  const { createServiceClient } = await import("../supabase/server");
  const { SupabaseRepo } = await import("./supabase");
  const client = await createServiceClient();
  return new SupabaseRepo(client);
}

/**
 * Returns the full admin repository using the service-role client.
 * Always server-side. The CALLER must verify the session/role before using this.
 */
export async function getAdminRepo(): Promise<AdminRepo> {
  if (config.isDemoMode || !config.supabaseUrl) {
    const { demoRepo } = await import("./demo");
    return demoRepo;
  }
  const { createServiceClient } = await import("../supabase/server");
  const { SupabaseRepo } = await import("./supabase");
  const client = await createServiceClient();
  return new SupabaseRepo(client);
}
