import type { MediaType } from '@moviefinder/shared';

/** The per-site adapter contract — the fragility firewall (docs/04 §5). */

export interface ScrobbleEvent {
  rawTitle: string;
  mediaType?: MediaType;
  season?: number;
  episode?: number;
  progressPct: number; // 0..1 at fire time
  siteId: string;
  siteVideoId?: string;
}

/** One item from an in-session viewing-activity read (FR-9, docs/12). */
export interface RawViewedItem {
  rawTitle: string;
  mediaType?: MediaType;
  season?: number;
  episode?: number;
  watchedAt: number;
  completionPct?: number;
  siteVideoId?: string;
}

export interface ScrobbleOpts {
  threshold: number;
  onFinished: (e: ScrobbleEvent) => void;
  onError: (err: unknown) => void;
}

export interface SiteAdapter {
  readonly siteId: string;
  readonly version: string;
  /** Is the current page a watchable player this adapter handles? */
  matches(): boolean;
  /** Begin observing playback; returns a stop() cleanup fn. MUST never throw into the page. */
  startScrobbling(opts: ScrobbleOpts): () => void;
  /** A play deep-link for a TMDB title on this site, or null if not resolvable. */
  buildPlayDeepLink(tmdbId: number): string | null;
  /** Optional (FR-9): read the user's own viewing activity from the logged-in session. */
  readViewingActivity?(): AsyncIterable<RawViewedItem>;
}
