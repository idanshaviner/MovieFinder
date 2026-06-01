import type { SiteAdapter } from './types';
import { NetflixAdapter } from './netflix';

/** All site adapters. Adding a platform later (Phase 3) = one new entry, no core changes. */
const ADAPTERS: SiteAdapter[] = [new NetflixAdapter()];

/** The adapter for the current page, or null. `matches()` failures degrade to "no adapter". */
export function activeAdapter(): SiteAdapter | null {
  return (
    ADAPTERS.find((a) => {
      try {
        return a.matches();
      } catch {
        return false;
      }
    }) ?? null
  );
}
