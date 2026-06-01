import { HandledError } from './errors.ts';

export interface RetryOpts {
  retries?: number; // max additional attempts (default 2)
  baseMs?: number; // backoff base (default 250)
  timeoutMs?: number; // per-attempt timeout
  label?: string;
}

/**
 * Bounded retry with exponential backoff for upstream calls (Anthropic/OpenAI/TMDB).
 * Maps exhaustion/timeout to a typed HandledError (docs/09 §3).
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const { retries = 2, baseMs = 250, timeoutMs, label = 'upstream' } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      return await fn(controller.signal);
    } catch (err) {
      lastErr = err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt));
    }
  }
  const aborted = lastErr instanceof DOMException && lastErr.name === 'AbortError';
  throw new HandledError(
    aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
    `${label} failed after ${retries + 1} attempts`,
  );
}
