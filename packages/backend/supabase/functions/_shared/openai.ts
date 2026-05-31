import { EMBEDDING_DIM, EMBEDDING_MODEL } from '@moviefinder/shared';
import { withRetry } from './withRetry.ts';

/**
 * OpenAI embeddings client. Turns text → a 1536-number vector with `text-embedding-3-small`
 * (the locked model — its dimension MUST match the `vector(1536)` column). Used by the ingest
 * job (E1) to embed catalog titles, and by /recommend (E4) to embed the user's query.
 *
 * Two jobs only: (1) batch many texts per request so a big ingest is fast + cheap, and
 * (2) validate every returned vector is exactly 1536 long, so a bad response can't poison the
 * vector index. All requests go through withRetry (429/5xx backoff).
 */

const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MAX_BATCH = 100; // OpenAI accepts large arrays; 100 keeps each request snappy.
/** text-embedding-3-small price: $0.02 per 1M tokens. */
const PRICE_PER_1M_TOKENS = 0.02;

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
  usage: { prompt_tokens: number; total_tokens: number };
}

function apiKey(): string {
  const k = Deno.env.get('OPENAI_API_KEY');
  if (!k) throw new Error('missing OPENAI_API_KEY');
  return k;
}

/** Embed one batch (≤ MAX_BATCH texts) in a single request. Returns vectors in input order. */
async function embedBatch(texts: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  if (texts.length === 0) return { vectors: [], tokens: 0 };

  const json = await withRetry(
    async (signal) => {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          encoding_format: 'float',
        }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`openai ${res.status}`);
      if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
      return (await res.json()) as EmbeddingResponse;
    },
    { label: 'openai-embed', timeoutMs: 20000, retries: 3 },
  );

  // Response order isn't guaranteed — sort by `index` to align with `texts`.
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => d.embedding);

  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(`unexpected embedding dim ${v.length} (expected ${EMBEDDING_DIM})`);
    }
  }
  return { vectors, tokens: json.usage.total_tokens };
}

/**
 * Embed any number of texts, chunking into ≤ MAX_BATCH requests. Returns vectors aligned 1:1
 * with `texts`, plus total tokens used (for cost accounting). `onProgress` fires per batch.
 */
export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ vectors: number[][]; tokens: number }> {
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const r = await embedBatch(batch);
    vectors.push(...r.vectors);
    tokens += r.tokens;
    onProgress?.(Math.min(i + MAX_BATCH, texts.length), texts.length);
  }
  return { vectors, tokens };
}

/** Embed a single query string (the /recommend path). */
export async function embedOne(text: string): Promise<{ vector: number[]; tokens: number }> {
  const { vectors, tokens } = await embedBatch([text]);
  return { vector: vectors[0]!, tokens };
}

/** Estimated USD cost for a token count — feeds the cost ledger / budget guard. */
export function estimateEmbedCostUsd(tokens: number): number {
  return (tokens / 1_000_000) * PRICE_PER_1M_TOKENS;
}

/** pgvector wants the vector as a string literal like "[0.1,0.2,...]" for inserts. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
