import { registerHandler } from '../messaging/bus';
import { assertNever, type Message, type MessageResult } from '../messaging/types';

/**
 * Background service worker (E0-3 skeleton). MV3 evicts this; keep NO durable state in module
 * scope — read IndexedDB / chrome.storage on each message. Auth, store, sync, capture, and the
 * consent gate wire in across E2–E5; here we prove the typed bus with an exhaustive handler.
 */

async function handle(msg: Message): Promise<MessageResult<typeof msg.type>> {
  switch (msg.type) {
    case 'PING':
      return { ok: true, data: { pong: true, at: Date.now() } };

    case 'GET_AUTH_STATE':
      return { ok: true, data: { status: 'signed_out' } };

    case 'HEALTH_PING':
      console.debug('[MovieFinder] health', msg.payload);
      return { ok: true, data: { ok: true } };

    // Not-yet-implemented messages return a typed, honest error (wired up in later epics).
    case 'SIGN_IN_REQUEST_CODE':
    case 'SIGN_IN_VERIFY_CODE':
    case 'SIGN_OUT':
    case 'GET_SETTINGS':
    case 'SET_SETTINGS':
    case 'RECOMMEND':
    case 'WATCH_FINISHED':
    case 'EXPORT_DATA':
    case 'DELETE_ALL_DATA':
      return {
        ok: false,
        error: { code: 'INTERNAL', message: `not implemented: ${msg.type}`, retryable: false },
      };

    default:
      return assertNever(msg);
  }
}

registerHandler((msg) => handle(msg));

chrome.runtime.onInstalled.addListener(() => {
  console.debug('[MovieFinder] installed');
});
