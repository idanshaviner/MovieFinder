import { mountDock } from './dock';

/**
 * Content-script entry. Mounts the dock lazily so we never delay the player. The adapter +
 * scrobbler (E2) and the consent gate wire in here later; for now this just proves injection
 * + Shadow-DOM isolation on netflix.com.
 */
function boot(): void {
  const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
  ric(() => {
    try {
      mountDock();
    } catch (err) {
      // Never throw into the host page (docs/04 §5). Degrade to no-op.
      console.debug('[MovieFinder] mount failed', err);
    }
  });
}

boot();
