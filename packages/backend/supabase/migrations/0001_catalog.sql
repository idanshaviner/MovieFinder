-- 0001_catalog.sql — TMDB catalog + embeddings (docs/02 §1.1). Not user-scoped; read only via
-- Edge Functions using the service-role client (never exposed to clients).

create extension if not exists vector;
create extension if not exists pg_trgm;

create table catalog_titles (
  tmdb_id                integer primary key,
  media_type             text    not null check (media_type in ('movie', 'tv')),
  title                  text    not null,
  original_title         text,
  original_language      text,
  release_year           integer,
  overview               text,
  genres                 text[]  not null default '{}',
  poster_path            text,
  popularity             real    not null default 0,
  adult                  boolean not null default false,        -- ALWAYS excluded from recs (FR-6)
  maturity_rank          smallint,                              -- 0(all-ages)..5(mature); family filter
  released_episode_count integer,                               -- TV only (de-dupe + tiers)
  providers              jsonb   not null default '{}',         -- { "US": ["Netflix","Prime"], ... }
  platform_ids           jsonb   not null default '{}',         -- { "netflix": "70131314", ... } (FR-3)
  updated_at             timestamptz not null default now()
);
create index catalog_titles_genres_idx on catalog_titles using gin (genres);
create index catalog_titles_media_type_idx on catalog_titles (media_type);
create index catalog_titles_title_trgm_idx on catalog_titles using gin (title gin_trgm_ops);

create table catalog_embeddings (
  tmdb_id     integer primary key references catalog_titles (tmdb_id) on delete cascade,
  embedding   vector(1536) not null,                            -- text-embedding-3-small dim (locked)
  model       text not null default 'text-embedding-3-small',
  source_text text not null,                                    -- exact embedded text (drift detection)
  updated_at  timestamptz not null default now()
);
-- ivfflat: tune `lists` ~ sqrt(rows) and ANALYZE after the first full ingest (docs/05 §1.2).
create index catalog_embeddings_ivfflat_idx
  on catalog_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 200);
