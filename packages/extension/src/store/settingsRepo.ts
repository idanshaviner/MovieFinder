import { COMPLETION_THRESHOLD_DEFAULT, DEFAULT_REGION, type Settings } from '@moviefinder/shared';
import { getDB } from './schema';

/** The single Settings row (docs/02). Mirrors the server `profiles` row; synced via /sync. */

const KEY = 'current';

export function defaultSettings(): Settings {
  return {
    enabledSites: ['netflix'],
    subscriptions: ['Netflix'],
    completionThreshold: COMPLETION_THRESHOLD_DEFAULT,
    region: DEFAULT_REGION,
    regionSource: 'detected',
    contentFilter: 'standard',
    sessionImportEnabled: false,
    updatedAt: Date.now(),
  };
}

export async function getSettings(): Promise<Settings> {
  const row = await (await getDB()).get('settings', KEY);
  if (!row) return defaultSettings();
  const { key: _key, ...settings } = row;
  return settings;
}

/** Merge a patch, bump updatedAt (the LWW key for settings sync), persist. */
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await getSettings()), ...patch, updatedAt: Date.now() };
  await (await getDB()).put('settings', { ...next, key: KEY });
  return next;
}

export async function hasConsent(): Promise<boolean> {
  return (await getSettings()).consentedAt != null;
}

/** Record first-run consent (gates all capture/sync/recommend flows). */
export async function grantConsent(): Promise<Settings> {
  return patchSettings({ consentedAt: Date.now() });
}
