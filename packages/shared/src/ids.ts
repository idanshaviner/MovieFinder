import { v5 as uuidv5 } from 'uuid';
import type { MediaType } from './types.js';

/**
 * Fixed namespace for MovieFinder deterministic ids. Do NOT change — it would re-key every
 * existing watch. (Generated once; any random uuid would do as the namespace constant.)
 */
export const MF_NAMESPACE = '6f9b1f7e-1c2a-5e4d-9a3b-2c7d8e0f1a2b';

/**
 * Deterministic watch id (review B2). The SAME natural key always yields the SAME id, so the
 * three capture lanes (scrobble / netflix_session / netflix_csv) and multiple devices converge
 * on one row instead of duplicating. Movies pass season/episode = undefined.
 */
export function watchId(tmdbId: number, season?: number, episode?: number): string {
  const key = `${tmdbId}:${season ?? ''}:${episode ?? ''}`;
  return uuidv5(key, MF_NAMESPACE);
}

/** Outbox id for an exclude record (keyed by tmdbId, not a uuid). */
export function excludeOutboxId(tmdbId: number): string {
  return `exclude:${tmdbId}`;
}

export type WatchKey = { tmdbId: number; season?: number; episode?: number };

/** Convenience: derive a watch id from a partial Watch-like object. */
export function watchIdFor({ tmdbId, season, episode }: WatchKey): string {
  return watchId(tmdbId, season, episode);
}

/** Type guard kept here so both sides agree on what counts as a TV episode key. */
export function isEpisode(mediaType: MediaType, season?: number, episode?: number): boolean {
  return mediaType === 'tv' && season != null && episode != null;
}
