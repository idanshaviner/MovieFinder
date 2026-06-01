-- 0005_cost_guard_atomicity.sql — make the per-user rate limit AND the global spend accrual
-- single-statement ATOMIC, closing two cost/abuse races in the read-then-write JS path:
--   1) rate limit: parallel requests all read the same count → a burst BYPASSES the cap.
--   2) cost ledger: concurrent accruals lose updates → spend is UNDER-counted → the $5 budget
--      overshoots before the kill-switch sees it.
-- Both are cost defenses, so they must be atomic in Postgres, not in the function. (docs/09 §13)

-- Per-user limiter: atomic upsert+increment; returns TRUE iff this call is within `p_limit`.
-- SECURITY INVOKER (default) → runs AS the caller, so RLS applies and auth.uid() = the caller;
-- rate_limits stays a user table touched only by the caller's JWT client (docs/09 §11).
-- The row is incremented even when the call is rejected — conservative, and naturally throttles
-- a hammering client.
create or replace function increment_rate_limit(
  p_route  text,
  p_window timestamptz,
  p_limit  integer
) returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into rate_limits (user_id, route, window_start, count)
  values (auth.uid(), p_route, p_window, 1)
  on conflict (user_id, route, window_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Global spend accrual: atomic increment (no read-then-write lost updates).
-- SECURITY DEFINER → the service-role path; cost_ledger has no RLS and holds aggregate spend
-- only (no PII/content, docs/09 §11). Locked down so a user JWT can never poison the ledger.
create or replace function accrue_cost(
  p_month date,
  p_llm   numeric,
  p_embed numeric
) returns void
language sql
security definer
set search_path = public
as $$
  insert into cost_ledger (month, llm_usd, embed_usd, updated_at)
  values (p_month, p_llm, p_embed, now())
  on conflict (month) do update
    set llm_usd    = cost_ledger.llm_usd   + excluded.llm_usd,
        embed_usd  = cost_ledger.embed_usd + excluded.embed_usd,
        updated_at = now();
$$;

revoke all on function accrue_cost(date, numeric, numeric) from public, anon, authenticated;
