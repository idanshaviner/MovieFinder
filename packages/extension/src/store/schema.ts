import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  ChatThread,
  ExcludedTitle,
  OutboxItem,
  Settings,
  TasteSignal,
  Watch,
} from '@moviefinder/shared';

/** IndexedDB schema (docs/02 §2). Repositories in this folder are the ONLY code that touches it. */
export interface MovieFinderDB extends DBSchema {
  watches: { key: string; value: Watch; indexes: { 'by-finishedAt': number } };
  taste_signals: { key: string; value: TasteSignal };
  excluded_titles: { key: number; value: ExcludedTitle };
  settings: { key: string; value: Settings & { key: string } };
  chat_threads: { key: string; value: ChatThread };
  outbox: { key: string; value: OutboxItem; indexes: { 'by-state': string } };
}

export const DB_NAME = 'moviefinder';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MovieFinderDB>> | undefined;

export function getDB(): Promise<IDBPDatabase<MovieFinderDB>> {
  dbPromise ??= openDB<MovieFinderDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const watches = db.createObjectStore('watches', { keyPath: 'id' });
      watches.createIndex('by-finishedAt', 'finishedAt');
      db.createObjectStore('taste_signals', { keyPath: 'id' });
      db.createObjectStore('excluded_titles', { keyPath: 'tmdbId' });
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('chat_threads', { keyPath: 'id' });
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('by-state', 'state');
    },
  });
  return dbPromise;
}

/** Test-only: close + drop the cached connection so a following deleteDatabase isn't blocked. */
export async function _resetDbForTests(): Promise<void> {
  try {
    (await dbPromise)?.close();
  } catch {
    /* ignore */
  }
  dbPromise = undefined;
}
