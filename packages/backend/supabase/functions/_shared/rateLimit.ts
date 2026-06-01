import type { SupabaseClient } from '@supabase/supabase-js';
import { HandledError } from './errors.ts';

/**
 * Per-user rate limiting via the CALLER's client (RLS applies — rate_limits is a user table,
 * never touched by the service role; docs/09 §11). The increment is ATOMIC in Postgres
 * (`increment_rate_limit`, migration 0005) so a parallel burst can't bypass the cap.
 *
 * Two windows defend the $5 budget (docs/09 §13):
 *  - a DAILY cap (burst protection within a day), and
 *  - a MONTHLY cap that, times the 10-user beta cap, equals the budget:
 *    RECOMMEND_MONTHLY_CAP × BETA_MAX_USERS × ~$0.006 = $4.50 ≤ $5. The caps alone bound spend;
 *    the global kill-switch (budget.ts) is the backstop.
 */
function startOfUtcDay(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function startOfUtcMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function enforce(
  client: SupabaseClient,
  route: string,
  windowStart: string,
  limit: number,
  message: string,
): Promise<void> {
  const { data: allowed, error } = await client.rpc('increment_rate_limit', {
    p_route: route,
    p_window: windowStart,
    p_limit: limit,
  });
  if (error) {
    // The limiter failing shouldn't take the product down — the budget kill-switch is the
    // hard backstop — so log and allow. (Fail-open here, fail-safe there.)
    console.error('[rateLimit] increment_rate_limit failed — allowing', error);
    return;
  }
  if (allowed === false) throw new HandledError('RATE_LIMITED', message);
}

/** Per-user DAILY cap (burst protection). */
export async function enforceDailyLimit(
  client: SupabaseClient,
  route: string,
  limit: number,
): Promise<void> {
  await enforce(
    client,
    `${route}:day`,
    startOfUtcDay(),
    limit,
    "you've hit today's limit — try again tomorrow",
  );
}

/** Per-user MONTHLY cap (budget share; binds before the daily cap for sustained use). */
export async function enforceMonthlyLimit(
  client: SupabaseClient,
  route: string,
  limit: number,
): Promise<void> {
  await enforce(
    client,
    `${route}:month`,
    startOfUtcMonth(),
    limit,
    "you've used this month's recommendations — resets on the 1st",
  );
}

/**
 * Convenience for paid routes: check the MONTHLY share first (the budget guarantee), then the
 * DAILY burst cap. Monthly first so a user over their share is rejected before the daily counter
 * even moves.
 */
export async function enforceUserBudgetCaps(
  client: SupabaseClient,
  route: string,
  dailyLimit: number,
  monthlyLimit: number,
): Promise<void> {
  await enforceMonthlyLimit(client, route, monthlyLimit);
  await enforceDailyLimit(client, route, dailyLimit);
}
