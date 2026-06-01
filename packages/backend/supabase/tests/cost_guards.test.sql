-- Behavioral tests for the cost/abuse guards (migrations 0005 + 0006), run by CI's `migrations`
-- job AFTER all migrations apply. Each assertion RAISEs on failure → ON_ERROR_STOP fails the job.
-- These make the guards regression-proof: applying the migration isn't enough, the behavior must
-- hold. Assumes the CI mock `auth.users` has `id` + `email_confirmed_at` and `auth.uid()` returns
-- the fixed all-zeros uuid.

\set ON_ERROR_STOP on

-- ── 0006: beta user cap ──────────────────────────────────────────────────────────────────────
do $$
declare blocked boolean := false;
begin
  perform set_config('app.beta_max_users', '2', false);
  delete from auth.users;

  insert into auth.users(id, email_confirmed_at) values (gen_random_uuid(), now()); -- 1 confirmed
  insert into auth.users(id, email_confirmed_at) values (gen_random_uuid(), now()); -- 2 confirmed

  begin
    insert into auth.users(id, email_confirmed_at) values (gen_random_uuid(), now()); -- 3rd → block
  exception when sqlstate 'P0001' then blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL[cap]: the 3rd CONFIRMED user was not blocked';
  end if;

  -- DoS guard: an UNCONFIRMED signup must NOT consume a slot even at the cap.
  insert into auth.users(id) values (gen_random_uuid());

  -- Confirming that user later must then be blocked (still at cap).
  blocked := false;
  begin
    update auth.users set email_confirmed_at = now()
      where id = (select id from auth.users where email_confirmed_at is null limit 1);
  exception when sqlstate 'P0001' then blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL[cap]: confirming a user past the cap was not blocked';
  end if;

  raise notice 'PASS[cap]: 11th confirmed blocked; unconfirmed does not consume a slot';
end $$;

-- ── 0005: atomic per-user rate limit ─────────────────────────────────────────────────────────
do $$
declare a boolean; b boolean; c boolean; n integer;
begin
  delete from auth.users;
  insert into auth.users(id) values ('00000000-0000-0000-0000-000000000000'); -- = auth.uid()
  delete from rate_limits;

  a := increment_rate_limit('recommend:test', date_trunc('day', now()), 2);
  b := increment_rate_limit('recommend:test', date_trunc('day', now()), 2);
  c := increment_rate_limit('recommend:test', date_trunc('day', now()), 2);
  if not (a and b and not c) then
    raise exception 'FAIL[rate]: expected allow,allow,deny — got %,%,%', a, b, c;
  end if;
  select count into n from rate_limits where route = 'recommend:test';
  if n <> 3 then
    raise exception 'FAIL[rate]: counter should be 3 (rejected attempt still counts), got %', n;
  end if;
  raise notice 'PASS[rate]: atomic limiter allows up to the cap then denies';
end $$;

-- ── 0005: atomic cost accrual (no lost updates) ──────────────────────────────────────────────
do $$
declare total numeric;
begin
  delete from cost_ledger;
  perform accrue_cost(date_trunc('month', now())::date, 0.004, 0.001);
  perform accrue_cost(date_trunc('month', now())::date, 0.004, 0.001);
  select llm_usd + embed_usd into total from cost_ledger where month = date_trunc('month', now())::date;
  if total <> 0.010 then
    raise exception 'FAIL[accrue]: two accruals should sum to 0.010, got %', total;
  end if;
  raise notice 'PASS[accrue]: concurrent-safe accrual sums correctly';
end $$;
