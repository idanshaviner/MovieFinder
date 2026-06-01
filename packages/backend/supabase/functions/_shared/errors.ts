import type { ApiError, ErrorCode } from '@moviefinder/shared';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  AT_CAPACITY: 429,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

const RETRYABLE: Record<ErrorCode, boolean> = {
  UNAUTHENTICATED: false,
  INVALID_INPUT: false,
  RATE_LIMITED: true,
  AT_CAPACITY: true,
  UPSTREAM_TIMEOUT: true,
  UPSTREAM_ERROR: true,
  NOT_FOUND: false,
  INTERNAL: true,
};

export function jsonOk<T>(data: T, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Safe error response. Never echoes raw input or upstream/internal detail (docs/06 §7). */
export function jsonErr(code: ErrorCode, message: string, headers: HeadersInit = {}): Response {
  const error: ApiError = { code, message, retryable: RETRYABLE[code] };
  return new Response(JSON.stringify({ ok: false, error }), {
    status: STATUS[code],
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A thrown error type carrying an ErrorCode, so handlers can `throw new HandledError(...)`. */
export class HandledError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
