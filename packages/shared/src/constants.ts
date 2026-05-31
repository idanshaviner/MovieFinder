/**
 * Shared constants — the single source of truth for tunables that BOTH the extension
 * and the backend must agree on. See SPEC §2 / docs/09 §5.
 */

export const APP_NAME = 'MovieFinder';

// Capture / "finished" semantics (PRD §3, FR-1)
export const COMPLETION_THRESHOLD_DEFAULT = 0.9; // 0.5..1.0
export const COMPLETION_THRESHOLD_MIN = 0.5;
export const COMPLETION_THRESHOLD_MAX = 1.0;
/** A finished episode at/above this fraction of released episodes excludes the whole show. */
export const TV_SHOW_COMPLETE_FRACTION = 0.8;
/** Scrobble must hold ≥ threshold this long before firing "finished" (anti scrub-through). */
export const SCROBBLE_STABLE_MS = 3000;
export const SCROBBLE_SAMPLE_MIN_INTERVAL_MS = 5000;

// Retrieval / ranking (docs/05)
export const K_DEFAULT = 40;
export const K_CAP = 60;
/** Platform-filtered second query size, unioned with the global top-K. */
export const PLATFORM_M_DEFAULT = 20;
/** Off-platform title must beat the best on-platform candidate by this cosine margin. */
export const OFF_PLATFORM_MARGIN = 0.05;
export const OFF_PLATFORM_MAX = 2;
export const RECOMMENDATIONS_TARGET = 5;

// Title resolution (docs/05 §5)
export const RESOLVE_MIN_CONFIDENCE = 0.6;

// Content filter (FR-6)
export const FAMILY_MAX_MATURITY = 2; // coarse 0..5

// Models (PRD locked)
export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

// Taste-profile weights (docs/05 §3.7)
export const WEIGHT_MOVIE_FINISHED = 1.0;
export const WEIGHT_MOVIE_WATCHED_UNKNOWN = 0.5;
export const WEIGHT_TV_COMPLETED = 1.5;
export const WEIGHT_TV_ENGAGED = 1.0;
export const WEIGHT_TV_SAMPLED = 0.3;
export const TV_ENGAGED_MIN_EPISODES = 3;
export const PROFILE_TOKEN_CAP = 800;
export const RECENCY_HALF_LIFE_DAYS = 90;

// Defaults
export const DEFAULT_REGION = 'US';
export const DEFAULT_ENABLED_SITES = ['netflix'] as const;

// Sync
export const OUTBOX_MAX_PER_REQUEST = 500;
export const RESOLVE_BATCH_MAX = 100;

// Cost guard (backend env overrides these; here for reference/tests)
export const MONTHLY_BUDGET_USD_DEFAULT = 25;
export const EMBED_COST_CEILING_USD_DEFAULT = 3;
