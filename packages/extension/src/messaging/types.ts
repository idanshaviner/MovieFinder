import type { ApiError, RecommendRequest, RecommendResponse, Settings } from '@moviefinder/shared';

/**
 * Typed message bus contract (content/UI ↔ background SW). One discriminated union; the SW
 * handler is an exhaustive switch with `assertNever`, so a new message fails to compile until
 * handled. Messages are validated on receipt (the content script runs in an untrusted page).
 * docs/04 §3.
 */

export type AuthState =
  | { status: 'signed_out' }
  | { status: 'awaiting_code'; email: string }
  | { status: 'signed_in'; email: string };

export type Message =
  | { type: 'PING' }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'SIGN_IN_REQUEST_CODE'; payload: { email: string } }
  | { type: 'SIGN_IN_VERIFY_CODE'; payload: { email: string; code: string } }
  | { type: 'SIGN_OUT' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; payload: Partial<Settings> }
  | { type: 'RECOMMEND'; payload: RecommendRequest }
  | { type: 'WATCH_FINISHED'; payload: ScrobbleEventMessage }
  | { type: 'HEALTH_PING'; payload: { siteId: string; version: string; detail: string } }
  | { type: 'EXPORT_DATA' }
  | { type: 'DELETE_ALL_DATA' };

export interface ScrobbleEventMessage {
  rawTitle: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  progressPct: number;
  siteId: string;
  siteVideoId?: string;
}

/** Maps each message type to its `data` payload on success. */
export interface ResponseData {
  PING: { pong: true; at: number };
  GET_AUTH_STATE: AuthState;
  SIGN_IN_REQUEST_CODE: { sent: true };
  SIGN_IN_VERIFY_CODE: AuthState;
  SIGN_OUT: { ok: true };
  GET_SETTINGS: Settings;
  SET_SETTINGS: Settings;
  RECOMMEND: RecommendResponse;
  WATCH_FINISHED: { recorded: boolean; needsConfirm?: boolean };
  HEALTH_PING: { ok: true };
  EXPORT_DATA: { json: string };
  DELETE_ALL_DATA: { ok: true };
}

export type MessageType = Message['type'];

export type MessageResult<T extends MessageType> =
  | { ok: true; data: ResponseData[T] }
  | { ok: false; error: ApiError };

export type MessageFor<T extends MessageType> = Extract<Message, { type: T }>;

export function assertNever(x: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(x)}`);
}
