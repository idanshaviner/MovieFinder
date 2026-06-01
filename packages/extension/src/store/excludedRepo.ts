import { excludeOutboxId, type ExcludedTitle, type OutboxItem } from '@moviefinder/shared';
import { getDB } from './schema';

/** "Don't recommend this" set — local store + outbox enqueue for sync. */

function outboxItem(rec: ExcludedTitle, op: 'upsert' | 'delete'): OutboxItem {
  return {
    id: excludeOutboxId(rec.tmdbId),
    entity: 'exclude',
    op,
    payload: rec,
    updatedAt: rec.updatedAt,
    state: 'pending',
  };
}

export async function addExclude(tmdbId: number): Promise<void> {
  const rec: ExcludedTitle = { tmdbId, updatedAt: Date.now() };
  const tx = (await getDB()).transaction(['excluded_titles', 'outbox'], 'readwrite');
  await tx.objectStore('excluded_titles').put(rec);
  await tx.objectStore('outbox').put(outboxItem(rec, 'upsert'));
  await tx.done;
}

export async function removeExclude(tmdbId: number): Promise<void> {
  const rec: ExcludedTitle = { tmdbId, updatedAt: Date.now(), deleted: true };
  const tx = (await getDB()).transaction(['excluded_titles', 'outbox'], 'readwrite');
  await tx.objectStore('excluded_titles').delete(tmdbId);
  await tx.objectStore('outbox').put(outboxItem(rec, 'delete'));
  await tx.done;
}

export async function listExcluded(): Promise<ExcludedTitle[]> {
  return (await getDB()).getAll('excluded_titles');
}
