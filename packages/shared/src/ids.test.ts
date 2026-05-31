import { describe, expect, it } from 'vitest';
import { excludeOutboxId, watchId, watchIdFor } from './ids.js';

describe('watchId (deterministic, review B2)', () => {
  it('is stable for the same natural key', () => {
    expect(watchId(27205)).toBe(watchId(27205));
    expect(watchId(1396, 1, 3)).toBe(watchId(1396, 1, 3));
  });

  it('converges across capture lanes / devices (same key → same id)', () => {
    // a session-import row and a live-scrobble row for the same episode must collide
    const fromScrobble = watchIdFor({ tmdbId: 1396, season: 1, episode: 3 });
    const fromImport = watchId(1396, 1, 3);
    expect(fromScrobble).toBe(fromImport);
  });

  it('distinguishes movie from its episodes and different episodes', () => {
    expect(watchId(1396)).not.toBe(watchId(1396, 1, 1));
    expect(watchId(1396, 1, 1)).not.toBe(watchId(1396, 1, 2));
    expect(watchId(1396, 1, 1)).not.toBe(watchId(1396, 2, 1));
  });

  it('treats missing season/episode consistently (movie)', () => {
    expect(watchId(27205)).toBe(watchId(27205, undefined, undefined));
  });

  it('emits a v5 uuid shape', () => {
    expect(watchId(27205)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('excludeOutboxId is keyed by tmdbId', () => {
    expect(excludeOutboxId(603)).toBe('exclude:603');
  });
});
