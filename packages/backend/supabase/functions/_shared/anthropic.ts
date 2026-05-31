import { CLAUDE_MODEL } from '@moviefinder/shared';
import { withRetry } from './withRetry.ts';
import type { ChatMsg, SystemBlock } from './prompt.ts';

/**
 * Claude (Anthropic) client for /recommend (E4). Sends the prompt-cached system blocks + the
 * fresh user message, returns the raw text + token usage. Caller parses/validates the JSON
 * (parseModelOutput) and applies the grounding gate. Prices are approximate — adjust to current
 * Haiku pricing; they feed the cost ledger, which has headroom.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const PRICE_IN_PER_1M = 1.0; // $/1M input tokens (approx)
const PRICE_OUT_PER_1M = 5.0; // $/1M output tokens (approx)

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export async function callClaude(
  system: SystemBlock[],
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<ClaudeResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('missing ANTHROPIC_API_KEY');

  const json = await withRetry(
    async (signal) => {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: opts.maxTokens ?? 700,
          temperature: opts.temperature ?? 0.4,
          system,
          messages,
        }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`anthropic ${res.status}`);
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
      return (await res.json()) as AnthropicResponse;
    },
    { label: 'anthropic', timeoutMs: 12000, retries: 1 },
  );

  const text = json.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('');

  return {
    text,
    inputTokens: json.usage.input_tokens,
    outputTokens: json.usage.output_tokens,
    cachedTokens: json.usage.cache_read_input_tokens ?? 0,
  };
}

export function estimateClaudeCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_IN_PER_1M + (outputTokens / 1_000_000) * PRICE_OUT_PER_1M
  );
}
