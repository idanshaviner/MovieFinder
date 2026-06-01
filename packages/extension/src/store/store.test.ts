import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { watchId, type Watch } from '@moviefinder/shared';
import { _resetDbForTests } from './schema';
import { getSettings, grantConsent, hasConsent, patchSettings } from './settingsRepo';
import { listWatches, putWatch } from './watchRepo';
import { addExclude, listExcluded, removeExclude } from './excludedRepo';
import { pendingOutbox } from './outboxRepo';
import { deleteAllLocal, exportData } from './dataManifest';
import { requireConsent } from '../background/consentGate';

beforeEach(async () => {
  await _resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('moviefinder');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

function watch(over: Partial<Watch> & { tmdbId: number }): Watch {
  return {
    id: watchId(over.tmdbId, over.season, over.episode),
    mediaType: 'movie',
    completionKnown: true,
    progressPct: 0.95,
    finishedAt: 1000,
    source: 'scrobble',
    updatedAt: 1000,
    ...over,
  };
}

describe('settingsRepo', () => {
  it('returns sensible defaults on a fresh store', async () => {
    const s = await getSettings();
    expect(s.region).toBe('US');
    expect(s.completionThreshold).toBe(0.9);
    expect(s.contentFilter).toBe('standard');
    expect(s.consentedAt).toBeUndefined();
  });

  it('patch persists and bumps updatedAt', async () => {
    const before = await getSettings();
    const after = await patchSettings({ region: 'GB', contentFilter: 'family' });
    expect(after.region).toBe('GB');
    expect((await getSettings()).contentFilter).toBe('family');
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('consent flow', async () => {
    expect(await hasConsent()).toBe(false);
    await expect(requireConsent()).rejects.toThrow('consent required');
    await grantConsent();
    expect(await hasConsent()).toBe(true);
    await requireConsent(); // resolves now
  });
});

describe('watchRepo + outbox', () => {
  it('putWatch stores the watch and enqueues an outbox item', async () => {
    await putWatch(watch({ tmdbId: 27205 }));
    expect(await listWatches()).toHaveLength(1);
    const out = await pendingOutbox();
    expect(out).toHaveLength(1);
    expect(out[0]!.entity).toBe('watch');
  });

  it('🔒 completion is sticky end-to-end (later unknown does not downgrade a finish)', async () => {
    await putWatch(watch({ tmdbId: 1, completionKnown: true, updatedAt: 1000 }));
    const applied = await putWatch(
      watch({
        tmdbId: 1,
        completionKnown: false,
        progressPct: undefined,
        updatedAt: 9999,
        source: 'netflix_session',
      }),
    );
    expect(applied).toBe(false);
    const stored = await listWatches();
    expect(stored[0]!.completionKnown).toBe(true);
  });
});

describe('excludedRepo', () => {
  it('add / list / remove', async () => {
    await addExclude(603);
    expect((await listExcluded()).map((e) => e.tmdbId)).toEqual([603]);
    await removeExclude(603);
    expect(await listExcluded()).toHaveLength(0);
  });
});

describe('dataManifest (export + delete)', () => {
  it('exports all user data, then delete wipes it', async () => {
    await putWatch(watch({ tmdbId: 27205 }));
    await addExclude(603);
    await patchSettings({ region: 'CA' });

    const bundle = await exportData();
    expect(bundle.watches).toHaveLength(1);
    expect(bundle.excludedTitles).toHaveLength(1);
    expect(bundle.settings.region).toBe('CA');

    await deleteAllLocal();
    expect(await listWatches()).toHaveLength(0);
    expect(await listExcluded()).toHaveLength(0);
    expect((await exportData()).watches).toHaveLength(0);
  });
});
