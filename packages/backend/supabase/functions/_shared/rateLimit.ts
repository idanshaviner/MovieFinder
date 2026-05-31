import type { SupabaseClient } from '@supabase/supabase-js';
import { HandledError } from './errors.ts';

/**
 * Per-user daily rate limit. Uses the CALLER's client (RLS applies — rate_limits is a user
 * table, never touched by the service role, docs/09 §11). Best-effort increment for v1; harden
 * to an atomic SQL RPC later if races matter.
 */
function dayWindowIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export async function enforceDailyLimit(
  client: SupabaseClient,
  userId: string,
  route: string,
  limit: number,
): Promise<void> {
  const windowStart = dayWindowIso();
  const { data } = await client
    .from('rate_limits')
    .select('count')
    .eq('user_id', userId)
    .eq('route', route)
    .eq('window_start', windowStart)
    .maybeSingle();

  const count: number = data?.count ?? 0;
  if (count >= limit) {
    throw new HandledError('RATE_LIMITED', "you've hit today's limit — try again tomorrow");
  }
  await client
    .from('rate_limits')
    .upsert(
      { user_id: userId, route, window_start: windowStart, count: count + 1 },
      { onConflict: 'user_id,route,window_start' },
    );
}
