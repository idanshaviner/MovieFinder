import type { SupabaseClient } from '@supabase/supabase-js';
import { userClient } from './supabaseClients.ts';
import { HandledError } from './errors.ts';

export interface AuthedUser {
  userId: string;
  /** Caller-JWT client (RLS applies) — use for all user-table access. */
  client: SupabaseClient;
}

/**
 * Verify the Supabase JWT. Throws HandledError('UNAUTHENTICATED') if absent/invalid.
 * Step 1 of every Edge Function (docs/01 §2).
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new HandledError('UNAUTHENTICATED', 'sign in required');
  }
  return { userId: data.user.id, client };
}
