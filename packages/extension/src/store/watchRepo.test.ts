import { describe, expect, it } from 'vitest';
import { watchId, type Watch } from '@moviefinder/shared';
import { shouldApply } from './watchRepo';

function mk(over: Partial<Watch>): Watch {
  return {
    id: watchId(1, 1, 1),
    tmdbId: 1,
    mediaType: 'tv',
    season: 1,
    episode: 1,
    completionKnown: true,
    finishedAt: 1000,
    source: 'scrobble',
    updatedAt: 1000,
    ...over,
  };
}

describe('watch merge rule (completion is sticky — review C4)', () => {
  it('applies when nothing exists', () => {
    expect(shouldApply(mk({}), undefined)).toBe(true);
  });

  it('never downgrades a confirmed finish to completion-unknown, even if newer', () => {
    const existing = mk({ completionKnown: true, updatedAt: 1000, source: 'scrobble' });
    const sessionLater = mk({
      completionKnown: false,
      progressPct: undefined,
      updatedAt: 9999,
      source: 'netflix_session',
    });
    expect(shouldApply(sessionLater, existing)).toBe(false);
  });

  it('upgrades completion-unknown to known regardless of timestamp', () => {
    const existing = mk({ completionKnown: false, updatedAt: 9999, source: 'netflix_session' });
    const finishOlder = mk({ completionKnown: true, updatedAt: 1, source: 'scrobble' });
    expect(shouldApply(finishOlder, existing)).toBe(true);
  });

  it('uses last-write-wins among same completion status', () => {
    const older = mk({ completionKnown: true, updatedAt: 5 });
    const newer = mk({ completionKnown: true, updatedAt: 6 });
    expect(shouldApply(newer, older)).toBe(true);
    expect(shouldApply(older, newer)).toBe(false);
  });
});
