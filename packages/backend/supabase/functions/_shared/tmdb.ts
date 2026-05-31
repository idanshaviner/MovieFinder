import type { MediaType } from '@moviefinder/shared';
import { withRetry } from './withRetry.ts';

/**
 * TMDB client — our source of truth for catalog metadata (used by the ingest job E1 and the
 * resolve functions E1-6/E2-5). Pure `fetch`; no SDK. Auth supports BOTH of the credentials TMDB
 * shows on one settings page:
 *   - TMDB_READ_TOKEN  → v4 "Read Access Token", sent as `Authorization: Bearer ...` (preferred)
 *   - TMDB_API_KEY     → v3 key, sent as the `api_key` query param (fallback)
 * You only need one. Calls go through withRetry so a transient 429/5xx backs off and retries.
 */

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

function auth(): { headers: Record<string, string>; apiKey?: string } {
  const bearer = Deno.env.get('TMDB_READ_TOKEN');
  if (bearer) return { headers: { Authorization: `Bearer ${bearer}` } };
  const apiKey = Deno.env.get('TMDB_API_KEY');
  if (apiKey) return { headers: {}, apiKey };
  throw new Error('missing TMDB credentials (set TMDB_READ_TOKEN or TMDB_API_KEY)');
}

type Params = Record<string, string | number | undefined>;

async function tmdbGet<T>(path: string, params: Params = {}): Promise<T> {
  const { headers, apiKey } = auth();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  if (apiKey) qs.set('api_key', apiKey);
  const url = `${BASE}${path}?${qs.toString()}`;

  return await withRetry(
    async (signal) => {
      const res = await fetch(url, { headers, signal });
      // 429 (rate limit) and 5xx are retryable; throw so withRetry backs off.
      if (res.status === 429 || res.status >= 500) throw new Error(`tmdb ${res.status}`);
      if (!res.ok) throw new Error(`tmdb ${res.status} ${path}`);
      return (await res.json()) as T;
    },
    { label: 'tmdb', timeoutMs: 8000, retries: 3 },
  );
}

// ── Raw response shapes (only the fields we use) ─────────────────────────────

interface TmdbListItem {
  id: number;
  title?: string; // movies
  name?: string; // tv
  original_title?: string;
  original_name?: string;
  original_language?: string;
  release_date?: string; // movies, "YYYY-MM-DD"
  first_air_date?: string; // tv
  overview?: string;
  genre_ids?: number[];
  poster_path?: string | null;
  popularity?: number;
  adult?: boolean;
}

interface TmdbPage<T> {
  page: number;
  total_pages: number;
  total_results: number;
  results: T[];
}

interface TmdbGenre {
  id: number;
  name: string;
}

interface TmdbDetails extends TmdbListItem {
  runtime?: number; // movies (minutes)
  episode_run_time?: number[]; // tv
  number_of_episodes?: number; // tv
  genres?: TmdbGenre[];
  release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string }[] }[] };
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
}

interface TmdbProviders {
  results: Record<string, { flatrate?: { provider_name: string }[] }>;
}

// ── Normalized shape we upsert into catalog_titles ───────────────────────────

export interface CatalogUpsert {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  original_title: string | null;
  original_language: string | null;
  release_year: number | null;
  overview: string | null;
  genres: string[];
  poster_path: string | null;
  popularity: number;
  adult: boolean;
  maturity_rank: number | null;
  released_episode_count: number | null;
  providers: Record<string, string[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function posterUrl(path: string | null | undefined, size = 'w342'): string | undefined {
  return path ? `${IMG}/${size}${path}` : undefined;
}

function yearOf(item: TmdbListItem): number | null {
  const d = item.release_date || item.first_air_date;
  const y = d ? Number(d.slice(0, 4)) : NaN;
  return Number.isFinite(y) ? y : null;
}

function titleOf(item: TmdbListItem): string {
  return item.title ?? item.name ?? '';
}

/** Best-effort coarse maturity 0..5 from US certification (most consistently populated). */
function maturityRank(details: TmdbDetails, mediaType: MediaType): number | null {
  const cert =
    mediaType === 'movie'
      ? details.release_dates?.results.find((r) => r.iso_3166_1 === 'US')?.release_dates[0]
          ?.certification
      : details.content_ratings?.results.find((r) => r.iso_3166_1 === 'US')?.rating;
  if (!cert) return null;
  const map: Record<string, number> = {
    G: 0,
    'TV-G': 0,
    'TV-Y': 0,
    PG: 1,
    'TV-PG': 1,
    'TV-Y7': 1,
    'PG-13': 2,
    'TV-14': 2,
    R: 4,
    'TV-MA': 4,
    'NC-17': 5,
  };
  return map[cert] ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** One page (20 items) of popular titles, sorted by popularity desc, all languages. */
export async function discoverPage(
  mediaType: MediaType,
  page: number,
): Promise<{ items: TmdbListItem[]; totalPages: number }> {
  const data = await tmdbGet<TmdbPage<TmdbListItem>>(`/discover/${mediaType}`, {
    sort_by: 'popularity.desc',
    include_adult: 'false', // adult excluded at the source (FR-6)
    page,
  });
  return { items: data.results, totalPages: data.total_pages };
}

/** Full details for one title, including certification (for maturity) and TV episode count. */
export async function getDetails(mediaType: MediaType, id: number): Promise<TmdbDetails> {
  const append = mediaType === 'movie' ? 'release_dates' : 'content_ratings';
  return await tmdbGet<TmdbDetails>(`/${mediaType}/${id}`, { append_to_response: append });
}

/** Where-to-watch providers per region: { "US": ["Netflix","Prime Video"], ... } (flatrate only). */
export async function getProviders(
  mediaType: MediaType,
  id: number,
): Promise<Record<string, string[]>> {
  const data = await tmdbGet<TmdbProviders>(`/${mediaType}/${id}/watch/providers`);
  const out: Record<string, string[]> = {};
  for (const [region, info] of Object.entries(data.results)) {
    const names = (info.flatrate ?? []).map((p) => p.provider_name);
    if (names.length) out[region] = names;
  }
  return out;
}

/** Title search — used by resolution (E1-6) to map a scraped string → a TMDB id. */
export async function searchTitles(
  mediaType: MediaType,
  query: string,
  year?: number,
): Promise<TmdbListItem[]> {
  const yearParam = mediaType === 'movie' ? 'year' : 'first_air_date_year';
  const data = await tmdbGet<TmdbPage<TmdbListItem>>(`/search/${mediaType}`, {
    query,
    include_adult: 'false',
    [yearParam]: year,
  });
  return data.results;
}

/** Merge a list item + details + providers into the row we upsert. */
export function toCatalogUpsert(
  mediaType: MediaType,
  details: TmdbDetails,
  providers: Record<string, string[]>,
): CatalogUpsert {
  return {
    tmdb_id: details.id,
    media_type: mediaType,
    title: titleOf(details),
    original_title: details.original_title ?? details.original_name ?? null,
    original_language: details.original_language ?? null,
    release_year: yearOf(details),
    overview: details.overview ?? null,
    genres: (details.genres ?? []).map((g) => g.name),
    poster_path: details.poster_path ?? null,
    popularity: details.popularity ?? 0,
    adult: details.adult ?? false,
    maturity_rank: maturityRank(details, mediaType),
    released_episode_count: mediaType === 'tv' ? (details.number_of_episodes ?? null) : null,
    providers,
  };
}

/** Build the exact text we embed (🔒 stable formula — changing it requires a full re-embed). */
export function embeddingSourceText(row: CatalogUpsert): string {
  const genres = row.genres.join(', ');
  return `${row.title} (${row.release_year ?? 'n/a'}) — ${row.media_type}. Genres: ${genres}. ${row.overview ?? ''}`.trim();
}
