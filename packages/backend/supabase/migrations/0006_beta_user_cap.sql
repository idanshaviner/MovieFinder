-- 0006_beta_user_cap.sql — closed-beta hard cap (PRD §5/§8, docs/08 E0-13). Refuse the
-- (BETA_MAX_USERS+1)th user SERVER-SIDE so the population — and therefore the spend — is bounded.
--
-- Why a trigger and not an Edge Function that counts profiles: the count + the decision must be
-- in ONE transaction. An app-level "read count, then allow" is the same TOCTOU race we removed
-- from the rate limiter (0005) — two concurrent 11th sign-ups could both read 10 and both pass.
-- A BEFORE trigger counts within the inserting/updating transaction, so the cap can't be raced.
--
-- We gate on the CONFIRMED transition (email_confirmed_at: null → set at verifyOtp), not on the
-- unconfirmed row OTP-send creates. That way junk OTP requests to never-verified addresses can't
-- fill the cap and lock out real users (a share-link DoS); per-email/per-IP OTP throttling
-- (Supabase Auth settings, docs/06 §1) covers the send side.
--
-- Cap source: the `app.beta_max_users` GUC if set, else 10. To change without editing this file:
--   alter database postgres set app.beta_max_users = '10';   -- (then it applies to new sessions)

create or replace function public.enforce_beta_user_cap()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cap       integer := coalesce(nullif(current_setting('app.beta_max_users', true), '')::integer, 10);
  v_confirmed integer;
begin
  -- Only act when an account BECOMES confirmed (or is inserted already-confirmed, e.g. admin).
  if (tg_op = 'INSERT' and new.email_confirmed_at is not null)
     or (tg_op = 'UPDATE' and new.email_confirmed_at is not null and old.email_confirmed_at is null) then
    -- The new row isn't yet confirmed-committed, so this counts the OTHER confirmed users.
    select count(*) into v_confirmed from auth.users where email_confirmed_at is not null;
    if v_confirmed >= v_cap then
      raise exception 'BETA_FULL: MovieFinder beta is full (% users)', v_cap
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- (No REVOKE needed: a trigger function can't be invoked directly — Postgres rejects a direct
-- call — so EXECUTE privilege on it is moot. It only ever runs from the trigger below.)

drop trigger if exists trg_enforce_beta_user_cap on auth.users;
create trigger trg_enforce_beta_user_cap
  before insert or update on auth.users
  for each row execute function public.enforce_beta_user_cap();
