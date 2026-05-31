import { serviceClient } from './supabaseClients.ts';
import { HandledError } from './errors.ts';

/**
 * Global monthly budget kill-switch (docs/09 §13). cost_ledger is service-role only (no RLS).
 * Fail-OPEN: a metering glitch must not take the product down — allow + log (alert in real impl).
 */
const MONTHLY_BUDGET_USD = Number(Deno.env.get('MONTHLY_BUDGET_USD') ?? '25');

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function assertBudgetAvailable(): Promise<void> {
  try {
    const { data } = await serviceClient()
      .from('cost_ledger')
      .select('llm_usd, embed_usd')
      .eq('month', monthKey())
      .maybeSingle();
    const spent = Number(data?.llm_usd ?? 0) + Number(data?.embed_usd ?? 0);
    if (spent >= MONTHLY_BUDGET_USD) {
      throw new HandledError(
        'AT_CAPACITY',
        'MovieFinder is at capacity this month — try again soon',
      );
    }
  } catch (e) {
    if (e instanceof HandledError) throw e;
    console.error('[budget] check failed — failing open', e);
  }
}

/** Accrue estimated spend (from token counts × price). Best-effort upsert. */
export async function recordCost(llmUsd: number, embedUsd: number): Promise<void> {
  const svc = serviceClient();
  const month = monthKey();
  const { data } = await svc
    .from('cost_ledger')
    .select('llm_usd, embed_usd')
    .eq('month', month)
    .maybeSingle();
  await svc.from('cost_ledger').upsert({
    month,
    llm_usd: Number(data?.llm_usd ?? 0) + llmUsd,
    embed_usd: Number(data?.embed_usd ?? 0) + embedUsd,
    updated_at: new Date().toISOString(),
  });
}
