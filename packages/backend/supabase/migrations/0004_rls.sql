-- 0004_rls.sql — Row-Level Security (docs/02 §1.3, docs/06 §4). 🔒 NON-OPTIONAL.
-- Every user table: a JWT can read/write ONLY its own rows. cost_ledger has NO RLS (service-role only).

alter table profiles        enable row level security;
alter table watches         enable row level security;
alter table taste_signals   enable row level security;
alter table excluded_titles enable row level security;
alter table chat_threads    enable row level security;
alter table rate_limits     enable row level security;

create policy "own rows" on profiles
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on watches
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on taste_signals
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on excluded_titles
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on chat_threads
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on rate_limits
  using (user_id = auth.uid()) with check (user_id = auth.uid());
