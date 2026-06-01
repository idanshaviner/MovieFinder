import { serviceClient } from './supabaseClients.ts';
import { HandledError } from './errors.ts';

/**
 * Global monthly budget kill-switch (docs/09 §13). cost_ledger is service-role only (no RLS).
 * This is the BACKSTOP: per-user monthly caps (rateLimit.ts) already bound total spend to the
 * budget; this catches cost-estimate drift. Fail-OPEN — a metering glitch must not take the
 * product down — but alert. Warn at 80%, degrade (`AT_CAPACITY`) at 100%.
 */
const MONTHLY_BUDGET_USD = Number(Deno.env.get('MONTHLY_BUDGET_USD') ?? '5');
const WARN_FRACTION = 0.8;

function monthDate(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function assertBudgetAvailable(): Promise<void> {
  try {
    const { data } = await serviceClient()
      .from('cost_ledger')
      .select('llm_usd, embed_usd')
      .eq('month', monthDate())
      .maybeSingle();
    const spent = Number(data?.llm_usd ?? 0) + Number(data?.embed_usd ?? 0);
    if (spent >= MONTHLY_BUDGET_USD) {
      throw new HandledError(
        'AT_CAPACITY',
        'MovieFinder is at capacity this month — try again soon',
      );
    }
    if (spent >= MONTHLY_BUDGET_USD * WARN_FRACTION) {
      // Operator early warning before the switch trips (docs/09 §13). Hook Sentry here.
      console.warn(
        `[budget] month-to-date $${spent.toFixed(3)} ≥ ${WARN_FRACTION * 100}% of $${MONTHLY_BUDGET_USD}`,
      );
    }
  } catch (e) {
    if (e instanceof HandledError) throw e;
    console.error('[budget] check failed — failing open', e);
  }
}

/**
 * Accrue estimated spend (token counts × price) ATOMICALLY (migration 0005 `accrue_cost`) so
 * concurrent calls can't lose updates and under-count spend.
 */
export async function recordCost(llmUsd: number, embedUsd: number): Promise<void> {
  const { error } = await serviceClient().rpc('accrue_cost', {
    p_month: monthDate(),
    p_llm: llmUsd,
    p_embed: embedUsd,
  });
  if (error) console.error('[budget] accrue_cost failed', error);
}
