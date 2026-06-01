import type { ExcludedTitle, Settings, TasteSignal, Watch } from '@moviefinder/shared';
import { getDB } from './schema';
import { getSettings } from './settingsRepo';

/**
 * The central export & delete manifest (SPEC §11.5 / docs/02 §4). One list both the export
 * builder and the delete routine iterate, so privacy coverage can never silently drift.
 */

/** Every persistent store. `chat_threads` is a UI-only cache (excluded from export). */
const ALL_STORES = [
  'watches',
  'taste_signals',
  'excluded_titles',
  'settings',
  'chat_threads',
  'outbox',
] as const;

export interface ExportBundle {
  version: 1;
  exportedAt: number;
  watches: Watch[];
  tasteSignals: TasteSignal[];
  excludedTitles: ExcludedTitle[];
  settings: Settings;
}

/** Client-side export (FR-6) — no server round trip. Raw rows only (tmdbIds, no titles). */
export async function exportData(): Promise<ExportBundle> {
  const db = await getDB();
  const [watches, tasteSignals, excludedTitles] = await Promise.all([
    db.getAll('watches'),
    db.getAll('taste_signals'),
    db.getAll('excluded_titles'),
  ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    watches,
    tasteSignals,
    excludedTitles,
    settings: await getSettings(),
  };
}

/** Wipe ALL local data (the local half of FR-6 delete; the server half is DELETE /account/data). */
export async function deleteAllLocal(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(ALL_STORES, 'readwrite');
  await Promise.all(ALL_STORES.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
