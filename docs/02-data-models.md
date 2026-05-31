# 02 — Data Models

> Parent: [`../SPEC.md`](../SPEC.md). The DDL, the IndexedDB schema, and the shared
> TypeScript/zod contract. These three MUST stay consistent.

---

## 1. Postgres schema

Migrations live in `packages/backend/supabase/migrations/`, numbered and immutable once
merged. Below is the v1 target schema.

### 1.1 Catalog (public read via function only; not user-scoped)

```sql
-- 0001_catalog.sql
create extension if not exists vector;

create table catalog_titles (
  tmdb_id       integer primary key,
  media_type    text    not null check (media_type in ('movie','tv')),
  title         text    not null,
  original_title text,
  release_year  integer,
  overview      text,
  genres        text[]  not null default '{}',
  poster_path   text,
  popularity    real    not null default 0,
  -- denormalised watch-provider availability per region, refreshed by ingest
  providers     jsonb   not null default '{}',  -- { "US": ["Netflix","Prime"], ... }
  updated_at    timestamptz not null default now()
);
create index on catalog_titles using gin (genres);
create index on catalog_titles (media_type);

create table catalog_embeddings (
  tmdb_id    integer primary key references catalog_titles(tmdb_id) on delete cascade,
  embedding  vector(1536) not null,        -- 🔒 text-embedding-3-small dim
  model      text not null default 'text-embedding-3-small',
  source_text text not null,               -- exact text we embedded (for re-embeds)
  updated_at timestamptz not null default now()
);
-- ivfflat needs ANALYZE + a chosen lists count; tune after first full ingest.
create index on catalog_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 200);
```

⚠️ `ivfflat` quality depends on `lists` ≈ `sqrt(rows)` and on running `ANALYZE` after
ingest. The ingest job (E1) MUST `ANALYZE catalog_embeddings` at the end.

### 1.2 User data (RLS-protected)

```sql
-- 0002_user_data.sql
create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  -- sites the extension is ACTIVE on (capture + inject). v1: netflix only.
  enabled_sites text[] not null default '{"netflix"}',
  -- streaming services the user SUBSCRIBES to (drives where-to-watch boosting).
  -- Distinct from enabled_sites: a user may watch on Netflix but also pay for Max/Prime.
  -- v1 onboarding seeds this from enabled_sites but it is independently editable. (review M7)
  subscriptions text[] not null default '{"Netflix"}',
  completion_threshold real not null default 0.90 check (completion_threshold between 0.5 and 1.0),
  region     text not null default 'US',
  consented_at timestamptz,               -- null until first-run consent
  created_at timestamptz not null default now()
);

create table watches (
  -- 🔒 id is DETERMINISTIC: uuidv5(NS, "{tmdb_id}:{season}:{episode}") — see shared/ids.ts.
  -- This makes the natural key and the sync id the SAME identity, so two devices that finish
  -- the same episode converge on one row (no unique-violation on cross-device sync). (review B2)
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie','tv')),
  season      integer,                     -- null for movies
  episode     integer,                     -- null for movies
  progress_pct real not null check (progress_pct >= 0 and progress_pct <= 1),  -- (review m12)
  finished_at timestamptz not null,
  source      text not null default 'scrobble' check (source in ('scrobble','manual')),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false  -- soft delete for sync
);
create index on watches (user_id, finished_at desc);
-- Natural-key uniqueness is now REDUNDANT with the deterministic PK but kept as a guard.
-- /sync upserts ON CONFLICT (id) DO UPDATE — never inserts a second row for the same episode.
create unique index on watches (user_id, tmdb_id, coalesce(season,-1), coalesce(episode,-1));

create table taste_signals (
  id         uuid primary key,             -- random uuidv4: distinct events, no natural key
  user_id    uuid not null references auth.users(id) on delete cascade,
  tmdb_id    integer,                      -- nullable: free-form taste w/o a title
  sentiment  text not null check (sentiment in ('like','dislike')),
  reason     text,                         -- "because the score was tense"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);
create index on taste_signals (user_id);

create table excluded_titles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tmdb_id    integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

-- Server-side multi-turn chat history (resolves review B3). Bounded retention.
create table chat_threads (
  id         uuid primary key,             -- the threadId returned to the client
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- last-N turns only; older turns dropped/summarised by the recommend function
  messages   jsonb not null default '[]',  -- [{role, content, ts}], NO secrets, content is user text
  updated_at timestamptz not null default now()
);
create index on chat_threads (user_id, updated_at desc);
-- Retention: a nightly job deletes chat_threads with updated_at < now() - interval '30 days'.

-- Per-user rate-limit counters (resolves review m7). Could also be Supabase KV; table chosen
-- so it is RLS-scoped, backed up, and visible. Keyed by (user_id, route, window_start).
create table rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  route        text not null,              -- 'recommend' | 'sync' | 'catalog_resolve'
  window_start timestamptz not null,       -- truncated to the limiter's window (minute/day)
  count        integer not null default 0,
  primary key (user_id, route, window_start)
);
```

### 1.3 Row-Level Security (🔒 non-optional)

```sql
-- 0003_rls.sql
alter table profiles        enable row level security;
alter table watches         enable row level security;
alter table taste_signals   enable row level security;
alter table excluded_titles enable row level security;
alter table chat_threads    enable row level security;
alter table rate_limits     enable row level security;

-- identical policy shape on EVERY user table (no exceptions):
create policy "own rows" on watches
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- repeat verbatim for: profiles (user_id=auth.uid()), taste_signals, excluded_titles,
-- chat_threads, rate_limits. A migration test asserts all six have the policy enabled.
```

Catalog tables have **no** public RLS grant; they are read only through Edge Functions
using the service-role client. ⚠️ **The service-role client bypasses RLS** — it is used
**only** for catalog tables, **never** for user tables (those are read/written with the
caller's JWT so RLS applies). This rule is enforced by convention in [`09 §11`](09-conventions.md#11-service-role-boundary).
The anon/auth client never queries the DB directly in v1 — all DB access is via Edge
Functions. This keeps the contract small and auditable.

---

## 2. IndexedDB (client)

Wrapped with [`idb`](https://github.com/jakearchibald/idb). DB name `moviefinder`, version
bumped on any store change with a migration in `openDB`'s `upgrade`.

```ts
// packages/extension/src/store/schema.ts
import type { DBSchema } from 'idb';
import type { Watch, TasteSignal, Settings, ChatThread, OutboxItem } from '@moviefinder/shared';

export interface MovieFinderDB extends DBSchema {
  watches:       { key: string; value: Watch;       indexes: { 'by-finishedAt': number } };
  taste_signals: { key: string; value: TasteSignal };
  excluded_titles: { key: number; value: ExcludedTitle };   // key = tmdbId
  settings:      { key: string; value: Settings };          // single row, key='current'
  chat_threads:  { key: string; value: ChatThread };        // UI-only local cache of active convo
  outbox:        { key: string; value: OutboxItem;  indexes: { 'by-state': string } };
}
export const DB_NAME = 'moviefinder';
export const DB_VERSION = 1;
```

- Every synced record stores `updatedAt: number` (epoch ms) and a `syncState`.
- `outbox` holds `{ id, entity: 'watch'|'taste_signal'|'exclude', op: 'upsert'|'delete', payload, updatedAt, state }`.
- `chat_threads` here is a **local UI cache** of the active conversation for fast re-render;
  the durable multi-turn history is the server `chat_threads` table. They are not sync-merged.
- **Repositories** (`store/watchRepo.ts`, etc.) are the only code that touches IndexedDB;
  UI and adapters go through repos. ⚠️ No raw `idb` calls outside `store/`.
- 🔒 **Export/delete registration:** every store except the UI-only `chat_threads` cache is
  listed in `store/dataManifest.ts`, which both the export builder and delete routine iterate
  (resolves review M10 / SPEC §11.5).

---

## 3. Shared types & validation (the single contract)

`packages/shared/src/types.ts` — the types both sides import:

```ts
export type MediaType = 'movie' | 'tv';

export interface Watch {
  id: string;                 // 🔒 DETERMINISTIC uuidv5 of natural key — see ids.ts (review B2)
  tmdbId: number;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  progressPct: number;        // 0..1
  finishedAt: number;         // epoch ms
  source: 'scrobble' | 'netflix_csv' | 'manual';  // netflix_csv = FR-7 cold-start import (docs/10)
  updatedAt: number;
  deleted?: boolean;
}

export interface TasteSignal {
  id: string;                 // random uuid v4 (distinct events)
  tmdbId?: number;
  sentiment: 'like' | 'dislike';
  reason?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface ExcludedTitle {
  tmdbId: number;             // identity is the tmdbId
  updatedAt: number;
  deleted?: boolean;          // tombstone for sync
}

export type OutboxEntity = 'watch' | 'taste_signal' | 'exclude';
export interface OutboxItem {
  id: string;                 // == the record id (watch/taste) or `exclude:${tmdbId}`
  entity: OutboxEntity;
  op: 'upsert' | 'delete';
  payload: Watch | TasteSignal | ExcludedTitle;
  updatedAt: number;
  state: 'pending' | 'synced';
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; ts: number; }
export interface ChatThread {
  id: string;                 // threadId (matches server chat_threads.id)
  messages: ChatMessage[];
  updatedAt: number;
}

export interface Settings {
  enabledSites: string[];       // sites the extension is active on (capture/inject)
  subscriptions: string[];      // services the user pays for → where-to-watch boost (review M7)
  completionThreshold: number;  // 0.5..1.0, default 0.90
  region: string;               // ISO country, default 'US'
  consentedAt?: number;         // first-run consent ts
}

// One assembled taste item per title (TV episodes rolled up to the show — see 05 §3.7).
// This is the structured, inspectable view exported by GET /profile → taste-profile.csv.
export interface TasteProfileItem {
  tmdbId: number;
  mediaType: MediaType;               // 'movie' | 'tv'
  title: string;
  tier: 'movie' | 'sampled' | 'engaged' | 'completed';  // movie = a finished film
  baseWeight: number;                 // tier weight: movie/engaged 1.0, sampled 0.3, completed 1.5
  episodesFinished?: number;          // TV only
  episodesReleased?: number;          // TV only
  fraction?: number;                  // TV only, 0..1 = episodesFinished / episodesReleased
  lastFinishedAt: number;             // epoch ms (max across episodes for TV) → recency
  explicitSentiment?: 'like' | 'dislike';  // from taste_signals; OVERRIDES the derived tier
  reason?: string;                    // explicit-signal reason text
  effectiveWeight: number;            // after explicit-signal override (dislike → negative)
  recencyFactor: number;              // 0..1 decay on lastFinishedAt (90-day half-life)
  rankScore: number;                  // effectiveWeight * recencyFactor — what selection ranks by
}

// Server-DERIVED, response-only. Never persisted on the client. Assembled at recommend time
// from watches + taste_signals (TV aggregated to show level). (resolves review M2)
export interface TasteProfile {
  items: TasteProfileItem[];    // 🔒 authoritative structured view (05 §3.7); powers GET /profile + export
  likes: { tmdbId?: number; reason?: string }[];      // convenience views, derived from items
  dislikes: { tmdbId?: number; reason?: string }[];
  recentFinishes: { tmdbId: number; mediaType: MediaType }[];
  summaryText: string;          // bounded (<= ~800 tokens) rendering of top items used in the prompt
}

export interface Recommendation {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year?: number;
  posterUrl?: string;
  why: string;                  // grounded explanation
  whereToWatch: string[];       // provider names available in user's region
  playDeepLink?: string;        // CLIENT-filled, current title only (never set by server)
}

// ── API DTOs ──
export interface RecommendRequest {
  query: string;
  scope?: MediaType | 'any';    // "just movies tonight"
  threadId?: string;            // for multi-turn refinement
  currentSite?: string;         // 'netflix' → client may add a deep link post-response
}
export interface RecommendResponse {
  threadId: string;
  recommendations: Recommendation[];  // server NEVER sets playDeepLink
  assistantMessage: string;     // the conversational reply text
}

export interface SyncRequest {
  outbox: OutboxItem[];
  since?: number;               // pull cursor (epoch ms)
}
export interface SyncResponse {
  applied: string[];            // outbox ids accepted
  serverChanges: {              // excludes included so a 2nd device gets them (review M1)
    watches: Watch[];
    tasteSignals: TasteSignal[];
    excludedTitles: ExcludedTitle[];
  };
  cursor: number;               // new pull cursor
}
```

`packages/shared/src/schemas.ts` — zod mirrors used for **runtime** validation on the
backend (and optionally client-side before send):

```ts
import { z } from 'zod';

export const RecommendRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  scope: z.enum(['movie', 'tv', 'any']).optional(),
  threadId: z.string().uuid().optional(),
  currentSite: z.string().max(64).optional(),
});
// …mirror every DTO. The Edge Function calls Schema.parse(body) FIRST.
```

🔒 **Rule:** a type and its zod schema are edited together in the same PR. If they drift,
runtime validation lies. CI runs a check that every exported DTO has a matching schema.

---

## 4. Data lifecycle / retention

- **Delete (FR-6)** is one action with a single authoritative path (resolves review M11):
  the client clears all registered IndexedDB stores (`dataManifest.ts`) **and** calls
  `DELETE /account/data`. That function hard-deletes **every** user row across `watches`,
  `taste_signals`, `excluded_titles`, `chat_threads`, `rate_limits`, and `profiles`
  (RLS-scoped to the caller). After it returns, the account holds no viewing data.
  Soft-delete (`deleted=true`) is only an in-flight *sync* tombstone, not the delete feature.
- **Export — two kinds:**
  - **Raw JSON (FR-6, portability):** a single file `{ watches, tasteSignals, excludedTitles,
    settings }` (note `excludedTitles`, review M1) generated client-side from IndexedDB by
    iterating `dataManifest.ts` — no server round trip; mirrors the delete manifest so coverage
    can't drift. Holds raw rows only (tmdbIds, no titles).
  - **Human/CSV (FR-8, debug & transparency):** two CSVs — `viewing-history.csv` (title-enriched
    watches) and `taste-profile.csv` (the assembled `TasteProfileItem[]` with tier/weight/score).
    Built from the `GET /profile` response (titles + the server-derived profile aren't in local
    IndexedDB). Full column schemas in [`11-data-export.md`](11-data-export.md).
- **Retention:** `chat_threads` older than 30 days are purged nightly; `rate_limits` windows
  older than a day are purged. Catalog data is not user data and is retained.
- No analytics/telemetry that contains titles, queries, or user ids in v1. See
  [`06-security-privacy.md`](06-security-privacy.md).
