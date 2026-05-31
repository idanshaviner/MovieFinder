-- 0002_operational.sql — operational tables created EARLY (E0-10) because the function harness's
-- rate-limiter and budget guard need them before any user-feature table exists (docs/02 §1.2 note).

-- Per-user rate-limit counters. RLS added in 0004.
create table rate_limits (
  user_id      uuid not null references auth.users (id) on delete cascade,
  route        text not null,                 -- recommend|sync|catalog_resolve|catalog_resolve_batch|catalog_platform_link|account_delete|profile
  window_start timestamptz not null,          -- truncated to the limiter's window
  count        integer not null default 0,
  primary key (user_id, route, window_start)
);

-- GLOBAL monthly spend ledger for the budget kill-switch. NOT user-scoped → NO RLS,
-- service-role only, never readable by clients (docs/09 §13).
create table cost_ledger (
  month      date primary key,                -- first of month (UTC)
  llm_usd    numeric not null default 0,
  embed_usd  numeric not null default 0,
  updated_at timestamptz not null default now()
);
