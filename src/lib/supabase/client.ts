import { createBrowserClient } from "@supabase/ssr";
import { config } from "../config";

export function createClient() {
  return createBrowserClient(config.supabaseUrl, config.supabaseAnonKey);
}
