import type { OutboxItem } from '@moviefinder/shared';
import { getDB } from './schema';

/** The sync outbox: pending local changes waiting to be pushed to /sync. */

export async function pendingOutbox(limit = 500): Promise<OutboxItem[]> {
  const all = await (await getDB()).getAllFromIndex('outbox', 'by-state', 'pending');
  return all.slice(0, limit);
}

/** Mark items synced after the server accepts them (keeps a tombstone-free outbox tidy). */
export async function markSynced(ids: string[]): Promise<void> {
  const tx = (await getDB()).transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  await Promise.all(
    ids.map(async (id) => {
      const item = await store.get(id);
      if (item) await store.put({ ...item, state: 'synced' });
    }),
  );
  await tx.done;
}

export async function clearSynced(): Promise<void> {
  const tx = (await getDB()).transaction('outbox', 'readwrite');
  const synced = await tx.objectStore('outbox').index('by-state').getAllKeys('synced');
  await Promise.all(synced.map((k) => tx.objectStore('outbox').delete(k)));
  await tx.done;
}
