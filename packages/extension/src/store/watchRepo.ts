import { excludeOutboxId, type OutboxItem, type Watch } from '@moviefinder/shared';
import { getDB } from './schema';

/**
 * Watch repository — the only writer to the `watches` + `outbox` stores for watches.
 * Enforces the "completion is sticky" merge rule locally (03 §2): a confirmed finish is never
 * downgraded to completion-unknown.
 */

/**
 * Merge rule (exported for unit tests). "Completion is sticky" (03 §2 / review C4): a confirmed
 * finish is never downgraded to completion-unknown, regardless of timestamp.
 */
export function shouldApply(incoming: Watch, existing: Watch | undefined): boolean {
  if (!existing) return true;
  // sticky: never overwrite a confirmed finish with a completion-unknown row
  if (existing.completionKnown && !incoming.completionKnown) return false;
  // upgrade unknown -> known always wins
  if (!existing.completionKnown && incoming.completionKnown) return true;
  // same completion status -> last-write-wins
  return incoming.updatedAt >= existing.updatedAt;
}

export async function putWatch(watch: Watch, enqueue = true): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction(['watches', 'outbox'], 'readwrite');
  const existing = await tx.objectStore('watches').get(watch.id);
  if (!shouldApply(watch, existing)) {
    await tx.done;
    return false;
  }
  await tx.objectStore('watches').put(watch);
  if (enqueue) {
    const item: OutboxItem = {
      id: watch.id,
      entity: 'watch',
      op: watch.deleted ? 'delete' : 'upsert',
      payload: watch,
      updatedAt: watch.updatedAt,
      state: 'pending',
    };
    await tx.objectStore('outbox').put(item);
  }
  await tx.done;
  return true;
}

export async function getWatch(id: string): Promise<Watch | undefined> {
  return (await getDB()).get('watches', id);
}

export async function listWatches(): Promise<Watch[]> {
  return (await getDB()).getAllFromIndex('watches', 'by-finishedAt');
}

export async function deleteWatch(watch: Watch): Promise<void> {
  await putWatch({ ...watch, deleted: true, updatedAt: Date.now() });
}

/** Convenience used by tests / capture: exclude outbox id helper re-export. */
export { excludeOutboxId };
