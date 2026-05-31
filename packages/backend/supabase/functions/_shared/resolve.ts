import { RESOLVE_MIN_CONFIDENCE, type MediaType } from '@moviefinder/shared';
import { searchCandidates, type SearchCandidate } from './tmdb.ts';

/**
 * Title resolution (E1-6): map a scraped/imported title string → a canonical TMDB id with a
 * confidence score (docs/05 §5). Used by GET /catalog/resolve (E2-5) and the batch importer.
 *
 * Design: the SCORING is pure (no I/O) so it's unit-tested directly. The ORCHESTRATION takes
 * injected `searchLocal` / `searchRemote` / `lazyInsert` seams, so the Edge Function provides DB
 * access and this module stays testable + DB-agnostic.
 */

export type Candidate = SearchCandidate;

export interface ResolveInput {
  title: string;
  year?: number;
  type?: MediaType;
  season?: number;
  episode?: number;
}

export interface ResolveMatch {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  confidence: number; // 0..1
}

// ── Pure scoring ──────────────────────────────────────────────────────────────

const COMBINING_MARKS = /[̀-ͯ]/g;

/** lowercase, strip diacritics + punctuation, collapse whitespace. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. Robust for short title strings. */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [bg, c] of ba) {
    total += c;
    const cb = bb.get(bg);
    if (cb) overlap += Math.min(c, cb);
  }
  for (const [, c] of bb) total += c;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/**
 * Confidence that `candidate` is what `input` means. Weighted: string 0.6, year 0.25, type 0.15
 * (docs/05 §5) — but weights are renormalized over only the signals we actually have (e.g. no
 * year given → string + type only), so a missing year doesn't unfairly tank every candidate.
 */
export function scoreMatch(input: ResolveInput, c: Candidate): number {
  let weighted = 0.6 * similarity(input.title, c.title);
  let used = 0.6;

  if (input.year != null && c.year != null) {
    const diff = Math.abs(input.year - c.year);
    const yearScore = diff === 0 ? 1 : diff <= 1 ? 0.5 : 0;
    weighted += 0.25 * yearScore;
    used += 0.25;
  }
  if (input.type != null) {
    weighted += 0.15 * (input.type === c.mediaType ? 1 : 0);
    used += 0.15;
  }
  return weighted / used;
}

/** Score all candidates, return the single best match (or null if the list is empty). */
export function resolveAgainst(input: ResolveInput, candidates: Candidate[]): ResolveMatch | null {
  let best: ResolveMatch | null = null;
  for (const c of candidates) {
    const confidence = scoreMatch(input, c);
    if (!best || confidence > best.confidence) {
      best = { tmdbId: c.tmdbId, mediaType: c.mediaType, title: c.title, year: c.year, confidence };
    }
  }
  return best;
}

// ── Orchestration (injected I/O seams) ────────────────────────────────────────

export interface ResolveDeps {
  /** Search the local catalog (DB) for candidates. */
  searchLocal: (input: ResolveInput) => Promise<Candidate[]>;
  /** Search TMDB for candidates (defaults to `tmdbSearch`). */
  searchRemote: (input: ResolveInput) => Promise<Candidate[]>;
  /** Persist a newly-resolved TMDB title into the catalog (+ embedding) — "lazy growth". */
  lazyInsert: (tmdbId: number, mediaType: MediaType) => Promise<void>;
}

/**
 * Resolve a title: local catalog first; if below the confidence floor, fall back to TMDB and, on
 * a strong match, lazily insert it so the catalog grows toward what users actually watch. Returns
 * null when nothing clears `RESOLVE_MIN_CONFIDENCE` (caller → 404 / ask the user to confirm).
 */
export async function resolveTitle(
  input: ResolveInput,
  deps: ResolveDeps,
): Promise<ResolveMatch | null> {
  const local = resolveAgainst(input, await deps.searchLocal(input));
  if (local && local.confidence >= RESOLVE_MIN_CONFIDENCE) return local;

  const remote = resolveAgainst(input, await deps.searchRemote(input));
  if (remote && remote.confidence >= RESOLVE_MIN_CONFIDENCE) {
    await deps.lazyInsert(remote.tmdbId, remote.mediaType);
    return remote;
  }
  return null;
}

/** Default TMDB-backed `searchRemote`: searches the given type, or both if unspecified. */
export async function tmdbSearch(input: ResolveInput): Promise<Candidate[]> {
  const types: MediaType[] = input.type ? [input.type] : ['movie', 'tv'];
  const lists = await Promise.all(types.map((t) => searchCandidates(t, input.title, input.year)));
  return lists.flat();
}
