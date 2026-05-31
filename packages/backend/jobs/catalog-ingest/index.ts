import postgres from 'postgres';
import { EMBEDDING_MODEL } from '@moviefinder/shared';
import {
  type CatalogUpsert,
  discoverPage,
  embeddingSourceText,
  getDetails,
  getProviders,
  toCatalogUpsert,
} from '../../supabase/functions/_shared/tmdb.ts';
import {
  embedTexts,
  estimateEmbedCostUsd,
  toVectorLiteral,
} from '../../supabase/functions/_shared/openai.ts';

/**
 * Catalog ingest (E1). Pipeline: TMDB popular titles → details + providers → upsert
 * catalog_titles → embed the blurb → upsert catalog_embeddings → ANALYZE.
 *
 * Run locally once your keys are in packages/backend/.env:
 *   cd packages/backend/jobs/catalog-ingest && deno task ingest
 *
 * Config (env): INGEST_TARGET (default 5000 — start small, then raise + re-run), CONCURRENCY,
 * EMBED_COST_CEILING_USD (circuit breaker). Idempotent: re-running upserts and only re-embeds
 * titles whose blurb changed.
 */

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

const TARGET = Number(Deno.env.get('INGEST_TARGET') ?? '5000');
const COST_CEILING = Number(Deno.env.get('EMBED_COST_CEILING_USD') ?? '3');
const CONCURRENCY = Number(Deno.env.get('INGEST_CONCURRENCY') ?? '8');
const CHUNK = 100; // titles processed (and embedded) per batch

/** Run `fn` over `items` with at most `limit` in flight. Preserves order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type Ref = { mediaType: 'movie' | 'tv'; id: number };

/** Page through popular titles (popularity desc) until we have `limit` ids. */
async function enumerate(mediaType: 'movie' | 'tv', limit: number): Promise<Ref[]> {
  const refs: Ref[] = [];
  let page = 1;
  let totalPages = Infinity;
  while (refs.length < limit && page <= totalPages) {
    const { items, totalPages: tp } = await discoverPage(mediaType, page);
    totalPages = tp;
    for (const it of items) {
      refs.push({ mediaType, id: it.id });
      if (refs.length >= limit) break;
    }
    page++;
  }
  return refs;
}

async function main(): Promise<void> {
  const sql = postgres(env('SUPABASE_DB_URL'), { prepare: false });
  const started = Date.now();
  let titlesUpserted = 0;
  let embedded = 0;
  let skippedEmbed = 0;
  let failed = 0;
  let totalTokens = 0;
  let totalCost = 0;

  try {
    // ~60% movies / 40% TV of the target, popularity-ranked across all languages.
    const movieTarget = Math.ceil(TARGET * 0.6);
    const tvTarget = TARGET - movieTarget;
    console.log(`Enumerating ${movieTarget} movies + ${tvTarget} TV (popularity desc)…`);
    const refs = [...(await enumerate('movie', movieTarget)), ...(await enumerate('tv', tvTarget))];
    console.log(`Got ${refs.length} title ids. Fetching details + providers + embedding…`);

    for (let i = 0; i < refs.length; i += CHUNK) {
      const chunk = refs.slice(i, i + CHUNK);

      // 1) fetch details + providers (bounded concurrency); skip individual failures
      const rows = (
        await mapPool(chunk, CONCURRENCY, async (ref): Promise<CatalogUpsert | null> => {
          try {
            const [details, providers] = await Promise.all([
              getDetails(ref.mediaType, ref.id),
              getProviders(ref.mediaType, ref.id),
            ]);
            return toCatalogUpsert(ref.mediaType, details, providers);
          } catch (e) {
            failed++;
            console.warn(`  skip ${ref.mediaType}/${ref.id}: ${(e as Error).message}`);
            return null;
          }
        })
      ).filter((r): r is CatalogUpsert => r !== null);

      // 2) upsert catalog_titles
      for (const r of rows) {
        await sql`
          insert into catalog_titles (
            tmdb_id, media_type, title, original_title, original_language, release_year,
            overview, genres, poster_path, popularity, adult, maturity_rank,
            released_episode_count, providers, updated_at
          ) values (
            ${r.tmdb_id}, ${r.media_type}, ${r.title}, ${r.original_title}, ${r.original_language},
            ${r.release_year}, ${r.overview}, ${r.genres}, ${r.poster_path}, ${r.popularity},
            ${r.adult}, ${r.maturity_rank}, ${r.released_episode_count},
            ${JSON.stringify(r.providers)}::jsonb, now()
          )
          on conflict (tmdb_id) do update set
            title = excluded.title, original_title = excluded.original_title,
            original_language = excluded.original_language, release_year = excluded.release_year,
            overview = excluded.overview, genres = excluded.genres,
            poster_path = excluded.poster_path, popularity = excluded.popularity,
            adult = excluded.adult, maturity_rank = excluded.maturity_rank,
            released_episode_count = excluded.released_episode_count,
            providers = excluded.providers, updated_at = now()
        `;
      }
      titlesUpserted += rows.length;

      // 3) embed only titles whose blurb is new or changed (idempotency)
      const ids = rows.map((r) => r.tmdb_id);
      const existing = ids.length
        ? await sql<{ tmdb_id: number; source_text: string }[]>`
            select tmdb_id, source_text from catalog_embeddings where tmdb_id in ${sql(ids)}`
        : [];
      const existingText = new Map(existing.map((e) => [e.tmdb_id, e.source_text]));
      const toEmbed = rows.filter((r) => existingText.get(r.tmdb_id) !== embeddingSourceText(r));
      skippedEmbed += rows.length - toEmbed.length;

      if (toEmbed.length) {
        const texts = toEmbed.map(embeddingSourceText);
        const { vectors, tokens } = await embedTexts(texts);
        totalTokens += tokens;
        totalCost += estimateEmbedCostUsd(tokens);

        // cost circuit breaker
        if (totalCost > COST_CEILING) {
          throw new Error(
            `cost ceiling hit ($${totalCost.toFixed(2)} > $${COST_CEILING}); aborting safely`,
          );
        }

        // 4) upsert catalog_embeddings (vector cast from the text literal)
        for (let j = 0; j < toEmbed.length; j++) {
          const r = toEmbed[j]!;
          await sql`
            insert into catalog_embeddings (tmdb_id, embedding, model, source_text, updated_at)
            values (${r.tmdb_id}, ${toVectorLiteral(vectors[j]!)}::vector, ${EMBEDDING_MODEL},
                    ${texts[j]!}, now())
            on conflict (tmdb_id) do update set
              embedding = excluded.embedding, model = excluded.model,
              source_text = excluded.source_text, updated_at = now()
          `;
        }
        embedded += toEmbed.length;
      }

      const pct = Math.round(((i + chunk.length) / refs.length) * 100);
      console.log(
        `  [${pct}%] titles=${titlesUpserted} embedded=${embedded} skipped=${skippedEmbed} ` +
          `failed=${failed} cost=$${totalCost.toFixed(4)}`,
      );
    }

    // 5) tune the vector index for the new data
    console.log('ANALYZE catalog_embeddings…');
    await sql`analyze catalog_embeddings`;

    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `\n✓ Done in ${secs}s — titles=${titlesUpserted} embedded=${embedded} ` +
        `skipped=${skippedEmbed} failed=${failed} tokens=${totalTokens} cost=$${totalCost.toFixed(4)}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('ingest failed:', e);
  Deno.exit(1);
});
