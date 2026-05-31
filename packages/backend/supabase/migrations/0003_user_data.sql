-- 0003_user_data.sql — per-user data (docs/02 §1.2). RLS enabled in 0004.
-- `profiles` IS the server copy of client Settings, synced via POST /sync (LWW by settings_updated_at).

create table profiles (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  display_name           text,
  enabled_sites          text[] not null default '{netflix}',          -- active sites (capture/inject)
  subscriptions          text[] not null default '{Netflix}',          -- paid services (where-to-watch boost)
  completion_threshold   real   not null default 0.90 check (completion_threshold between 0.5 and 1.0),
  region                 text   not null default 'US',                 -- auto-detected; user-overridable
  region_source          text   not null default 'detected' check (region_source in ('detected', 'user')),
  content_filter         text   not null default 'standard' check (content_filter in ('standard', 'family')),
  session_import_enabled boolean not null default false,               -- FR-9 opt-in
  consented_at           timestamptz,                                  -- null until first-run consent
  settings_updated_at    timestamptz not null default now(),           -- LWW key for settings sync
  created_at             timestamptz not null default now()
);

create table watches (
  -- id is DETERMINISTIC: uuidv5 of the natural key (shared/ids.ts). Same key => same id, so the
  -- three capture lanes + multiple devices converge on one row (review B2).
  id               uuid primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  tmdb_id          integer not null,
  media_type       text not null check (media_type in ('movie', 'tv')),
  season           integer,
  episode          integer,
  -- NULL when completion is unknown (FR-9 session items, docs/12).
  progress_pct     real check (progress_pct is null or (progress_pct >= 0 and progress_pct <= 1)),
  completion_known boolean not null default true,
  finished_at      timestamptz not null,
  source           text not null default 'scrobble'
                     check (source in ('scrobble', 'netflix_session', 'netflix_csv', 'manual')),
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);
create index watches_user_finished_idx on watches (user_id, finished_at desc);
create unique index watches_natural_key_idx
  on watches (user_id, tmdb_id, coalesce(season, -1), coalesce(episode, -1));

create table taste_signals (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  tmdb_id    integer,
  sentiment  text not null check (sentiment in ('like', 'dislike')),
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);
create index taste_signals_user_idx on taste_signals (user_id);

create table excluded_titles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  tmdb_id    integer not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, tmdb_id)
);

-- Server-side bounded multi-turn chat history (review B3). Retention: purged after 30 days.
create table chat_threads (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  messages   jsonb not null default '[]',     -- [{role, content, ts}]
  updated_at timestamptz not null default now()
);
create index chat_threads_user_updated_idx on chat_threads (user_id, updated_at desc);
