/**
 * zod schemas — runtime validation, mirroring types.ts. Every Edge Function calls the matching
 * `*.parse(body)` FIRST. 🔒 Edit a type and its schema together (SPEC §4.3); a CI check asserts
 * every exported DTO has a schema (see schemas.test.ts).
 */
import { z } from 'zod';
import {
  COMPLETION_THRESHOLD_MAX,
  COMPLETION_THRESHOLD_MIN,
  OUTBOX_MAX_PER_REQUEST,
  RESOLVE_BATCH_MAX,
} from './constants.js';

export const MediaTypeSchema = z.enum(['movie', 'tv']);
export const WatchSourceSchema = z.enum(['scrobble', 'netflix_session', 'netflix_csv', 'manual']);
export const SentimentSchema = z.enum(['like', 'dislike']);
export const ContentFilterSchema = z.enum(['standard', 'family']);
export const RegionSourceSchema = z.enum(['detected', 'user']);

export const WatchSchema = z
  .object({
    id: z.string().uuid(),
    tmdbId: z.number().int().positive(),
    mediaType: MediaTypeSchema,
    season: z.number().int().nonnegative().optional(),
    episode: z.number().int().nonnegative().optional(),
    progressPct: z.number().min(0).max(1).optional(),
    completionKnown: z.boolean(),
    finishedAt: z.number().int(),
    source: WatchSourceSchema,
    updatedAt: z.number().int(),
    deleted: z.boolean().optional(),
  })
  .strict();

export const TasteSignalSchema = z
  .object({
    id: z.string().uuid(),
    tmdbId: z.number().int().positive().optional(),
    sentiment: SentimentSchema,
    reason: z.string().max(2000).optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    deleted: z.boolean().optional(),
  })
  .strict();

export const ExcludedTitleSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    updatedAt: z.number().int(),
    deleted: z.boolean().optional(),
  })
  .strict();

export const OutboxItemSchema = z
  .object({
    id: z.string().min(1),
    entity: z.enum(['watch', 'taste_signal', 'exclude']),
    op: z.enum(['upsert', 'delete']),
    payload: z.union([WatchSchema, TasteSignalSchema, ExcludedTitleSchema]),
    updatedAt: z.number().int(),
    state: z.enum(['pending', 'synced']),
  })
  .strict();

export const SettingsSchema = z
  .object({
    enabledSites: z.array(z.string().max(64)).max(32),
    subscriptions: z.array(z.string().max(64)).max(64),
    completionThreshold: z.number().min(COMPLETION_THRESHOLD_MIN).max(COMPLETION_THRESHOLD_MAX),
    region: z.string().length(2),
    regionSource: RegionSourceSchema,
    contentFilter: ContentFilterSchema,
    sessionImportEnabled: z.boolean(),
    consentedAt: z.number().int().optional(),
    updatedAt: z.number().int(),
  })
  .strict();

export const RecommendRequestSchema = z
  .object({
    query: z.string().min(1).max(2000),
    scope: z.union([MediaTypeSchema, z.literal('any')]).optional(),
    threadId: z.string().uuid().optional(),
    currentSite: z.string().max(64).optional(),
  })
  .strict();

export const SyncRequestSchema = z
  .object({
    outbox: z.array(OutboxItemSchema).max(OUTBOX_MAX_PER_REQUEST),
    settings: SettingsSchema.optional(),
    since: z.number().int().optional(),
  })
  .strict();

export const ResolveBatchItemSchema = z
  .object({
    ref: z.string().min(1).max(128),
    title: z.string().min(1).max(512),
    year: z.number().int().optional(),
    type: MediaTypeSchema.optional(),
    season: z.number().int().nonnegative().optional(),
    episode: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ResolveBatchRequestSchema = z
  .object({
    items: z.array(ResolveBatchItemSchema).min(1).max(RESOLVE_BATCH_MAX),
  })
  .strict();

export const PlatformLinkRequestSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    siteId: z.string().min(1).max(64),
    siteVideoId: z.string().min(1).max(128),
  })
  .strict();

/** Catalog-resolve query params (GET) — validated after coercion from the query string. */
export const ResolveQuerySchema = z
  .object({
    title: z.string().min(1).max(512),
    year: z.coerce.number().int().optional(),
    type: MediaTypeSchema.optional(),
    season: z.coerce.number().int().nonnegative().optional(),
    episode: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();
