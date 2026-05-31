import { describe, expect, it } from 'vitest';
import { watchId } from './ids.ts';
import {
  RecommendRequestSchema,
  ResolveBatchRequestSchema,
  SettingsSchema,
  SyncRequestSchema,
  WatchSchema,
} from './schemas.ts';

describe('schemas accept valid and reject invalid input', () => {
  it('WatchSchema: valid finished movie + completion-unknown session item', () => {
    expect(
      WatchSchema.safeParse({
        id: watchId(27205),
        tmdbId: 27205,
        mediaType: 'movie',
        progressPct: 0.97,
        completionKnown: true,
        finishedAt: 1717000000000,
        source: 'scrobble',
        updatedAt: 1717000000000,
      }).success,
    ).toBe(true);

    expect(
      WatchSchema.safeParse({
        id: watchId(1396, 1, 3),
        tmdbId: 1396,
        mediaType: 'tv',
        season: 1,
        episode: 3,
        completionKnown: false, // no progressPct → ok
        finishedAt: 1717000000000,
        source: 'netflix_session',
        updatedAt: 1717000000000,
      }).success,
    ).toBe(true);
  });

  it('WatchSchema: rejects progressPct out of range and unknown fields', () => {
    expect(
      WatchSchema.safeParse({
        id: watchId(1),
        tmdbId: 1,
        mediaType: 'movie',
        progressPct: 1.5,
        completionKnown: true,
        finishedAt: 1,
        source: 'scrobble',
        updatedAt: 1,
      }).success,
    ).toBe(false);

    expect(
      WatchSchema.safeParse({
        id: watchId(1),
        tmdbId: 1,
        mediaType: 'movie',
        completionKnown: true,
        finishedAt: 1,
        source: 'scrobble',
        updatedAt: 1,
        surprise: true,
      }).success,
    ).toBe(false);
  });

  it('RecommendRequestSchema: requires a non-empty query', () => {
    expect(RecommendRequestSchema.safeParse({ query: 'tense thriller' }).success).toBe(true);
    expect(RecommendRequestSchema.safeParse({ query: '' }).success).toBe(false);
  });

  it('SettingsSchema: region must be a 2-letter code and threshold in range', () => {
    const base = {
      enabledSites: ['netflix'],
      subscriptions: ['Netflix'],
      completionThreshold: 0.9,
      region: 'US',
      regionSource: 'detected' as const,
      contentFilter: 'standard' as const,
      sessionImportEnabled: false,
      updatedAt: 1,
    };
    expect(SettingsSchema.safeParse(base).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...base, region: 'USA' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, completionThreshold: 0.1 }).success).toBe(false);
  });

  it('ResolveBatchRequestSchema: caps batch size', () => {
    const item = { ref: '0', title: 'Inception' };
    expect(ResolveBatchRequestSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(ResolveBatchRequestSchema.safeParse({ items: Array(101).fill(item) }).success).toBe(
      false,
    );
  });

  it('SyncRequestSchema: accepts empty outbox and optional settings', () => {
    expect(SyncRequestSchema.safeParse({ outbox: [] }).success).toBe(true);
  });
});
