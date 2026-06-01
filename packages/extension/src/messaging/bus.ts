import type { ApiError } from '@moviefinder/shared';
import type { Message, MessageResult, MessageType } from './types';

/** Send a typed message from content/UI to the background SW and await a typed result. */
export async function sendMessage<T extends MessageType>(
  msg: Extract<Message, { type: T }>,
): Promise<MessageResult<T>> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as MessageResult<T>;
  } catch (err) {
    const error: ApiError = {
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : 'messaging failure',
      retryable: true,
    };
    return { ok: false, error };
  }
}

export type Handler = (msg: Message, sender: chrome.runtime.MessageSender) => Promise<unknown>;

/**
 * Register the single SW message handler. The handler returns the standard result envelope.
 * Returns `true` synchronously to keep the message channel open for the async reply.
 */
export function registerHandler(handler: Handler): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handler(msg as Message, sender)
      .then(sendResponse)
      .catch((err: unknown) => {
        const error: ApiError = {
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : 'handler failure',
          retryable: true,
        };
        sendResponse({ ok: false, error });
      });
    return true;
  });
}
