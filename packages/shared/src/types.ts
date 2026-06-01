/**
 * Shared domain + DTO types. The SINGLE contract imported by both the extension and the
 * Edge Functions. Mirrored by zod schemas in `schemas.ts` (edit together — SPEC §4.3).
 */

export type MediaType = 'movie' | 'tv';
export type WatchSource = 'scrobble' | 'netflix_session' | 'netflix_csv' | 'manual';
export type Sentiment = 'like' | 'dislike';
export type ContentFilter = 'standard' | 'family';
export type RegionSource = 'detected' | 'user';

// ── Local/synced user records ───────────────────────────────────────────────

export interface Watch {
  /** Deterministic uuidv5 of the natural key — see ids.ts#watchId (review B2). */
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  /** 0..1; undefined when completionKnown=false (FR-9 session items, docs/12). */
  progressPct?: number;
  completionKnown: boolean;
  /** epoch ms — watch/seen time. */
  finishedAt: number;
  source: WatchSource;
  updatedAt: number;
  deleted?: boolean;
}

export interface TasteSignal {
  /** Random uuid v4 — distinct events, no natural key. */
  id: string;
  tmdbId?: number;
  sentiment: Sentiment;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface ExcludedTitle {
  tmdbId: number;
  updatedAt: number;
  deleted?: boolean;
}

export type OutboxEntity = 'watch' | 'taste_signal' | 'exclude';

export interface OutboxItem {
  /** The record id (watch/taste) or `exclude:${tmdbId}`. */
  id: string;
  entity: OutboxEntity;
  op: 'upsert' | 'delete';
  payload: Watch | TasteSignal | ExcludedTitle;
  updatedAt: number;
  state: 'pending' | 'synced';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface ChatThread {
  id: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface Settings {
  enabledSites: string[];
  subscriptions: string[];
  completionThreshold: number;
  region: string;
  regionSource: RegionSource;
  contentFilter: ContentFilter;
  sessionImportEnabled: boolean;
  consentedAt?: number;
  /** epoch ms — LWW key when syncing settings → profiles row. */
  updatedAt: number;
}

// ── Server-derived taste profile (response-only; never persisted client-side) ─

export interface TasteProfileItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  tier: 'movie' | 'sampled' | 'engaged' | 'completed';
  baseWeight: number;
  episodesFinished?: number;
  episodesReleased?: number;
  fraction?: number;
  lastFinishedAt: number;
  explicitSentiment?: Sentiment;
  reason?: string;
  effectiveWeight: number;
  recencyFactor: number;
  rankScore: number;
}

export interface TasteProfile {
  items: TasteProfileItem[];
  likes: { tmdbId?: number; reason?: string }[];
  dislikes: { tmdbId?: number; reason?: string }[];
  recentFinishes: { tmdbId: number; mediaType: MediaType }[];
  summaryText: string;
}

// ── Recommendations ─────────────────────────────────────────────────────────

export interface Recommendation {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year?: number;
  posterUrl?: string;
  why: string;
  /** Availability is server-authoritative; never trust the model for it. */
  onCurrentPlatform: boolean;
  whereToWatch: string[];
  /** Present iff onCurrentPlatform (exact title-page when known, else search). Server-built. */
  currentPlatformUrl?: string;
  /** Client-upgraded exact PLAY link, current open title only. */
  playDeepLink?: string;
}

// ── API DTOs ────────────────────────────────────────────────────────────────

export interface RecommendRequest {
  query: string;
  scope?: MediaType | 'any';
  threadId?: string;
  currentSite?: string;
}

export interface RecommendResponse {
  threadId: string;
  recommendations: Recommendation[];
  assistantMessage: string;
}

export interface SyncRequest {
  outbox: OutboxItem[];
  settings?: Settings;
  since?: number;
}

export interface SyncResponse {
  applied: string[];
  serverChanges: {
    watches: Watch[];
    tasteSignals: TasteSignal[];
    excludedTitles: ExcludedTitle[];
  };
  settings?: Settings;
  cursor: number;
}

export interface ResolveResult {
  ref: string;
  tmdbId: number | null;
  mediaType?: MediaType;
  title?: string;
  year?: number;
  confidence: number;
}

export interface ResolveBatchItem {
  ref: string;
  title: string;
  year?: number;
  type?: MediaType;
  season?: number;
  episode?: number;
}

export interface ResolveBatchRequest {
  items: ResolveBatchItem[];
}

export interface ResolveBatchResponse {
  results: ResolveResult[];
}

export interface PlatformLinkRequest {
  tmdbId: number;
  siteId: string;
  siteVideoId: string;
}

export interface ProfileHistoryItem {
  tmdbId: number;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  progressPct?: number;
  completionKnown: boolean;
  finishedAt: number;
  source: WatchSource;
  title: string | null;
  year?: number;
}

export interface ProfileResponse {
  profile: TasteProfile;
  history: ProfileHistoryItem[];
}

// ── Error envelope ──────────────────────────────────────────────────────────

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'AT_CAPACITY'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL';

export interface ApiError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };
