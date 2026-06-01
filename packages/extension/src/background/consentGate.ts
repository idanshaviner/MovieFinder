import { hasConsent } from '../store/settingsRepo';

/**
 * 🔒 The consent gate (docs/06 §5.1). Capture, sync, and recommend MUST refuse until first-run
 * consent. Auth is the ONLY pre-consent flow (it's how the user reaches the consent step).
 * SW handlers call `requireConsent()` before doing any of that work.
 */
export class ConsentRequiredError extends Error {
  constructor() {
    super('consent required');
    this.name = 'ConsentRequiredError';
  }
}

export async function requireConsent(): Promise<void> {
  if (!(await hasConsent())) throw new ConsentRequiredError();
}
