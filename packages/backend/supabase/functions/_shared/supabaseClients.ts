import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 🔒 Two clients, never mixed (docs/09 §11):
 *  - userClient: built from the caller's JWT → RLS applies → used for ALL user tables.
 *  - serviceClient: bypasses RLS → catalog + cost_ledger ONLY, never user tables.
 */

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** ⚠️ Bypasses RLS. Catalog + cost_ledger only. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
