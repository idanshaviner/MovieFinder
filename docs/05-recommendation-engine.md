# 05 — Recommendation Engine

> Parent: [`../SPEC.md`](../SPEC.md). Catalog ingest, embeddings, retrieval, the RAG prompt,
> grounding, prompt caching, and title resolution. This is where accuracy & cost are won.

---

## 1. Catalog ingest (Epic E1)

Goal: populate `catalog_titles` + `catalog_embeddings` from TMDB so vector search has
something to retrieve.

### 1.1 What to ingest (v1 curated set)
- TMDB **popular + top-rated** movies and TV, plus anything resolved on-demand (see §5).
- Target ~50–100K titles (PRD cost model). Don't ingest the long tail of obscure titles in
  v1 — it bloats cost and hurts retrieval precision.
- Per title, store the fields in `catalog_titles` and build the **embedding source text**:

```
"{title} ({year}) — {media_type}. Genres: {genres joined}. {overview}"
```

🔒 Keep the source text formula stable; changing it requires re-embedding the whole catalog
(store it in `source_text` so we can detect drift).

### 1.2 Embedding
- Model: **OpenAI `text-embedding-3-small`**, 1536 dims (🔒 must match the `vector(1536)` col).
- Batch up to 100 inputs per request; respect rate limits with backoff.
- Idempotent: skip titles whose `source_text` hash is unchanged.
- After a full run: `ANALYZE catalog_embeddings;` and verify the `ivfflat` `lists` ≈
  `sqrt(rowcount)` (recreate index if the catalog grew an order of magnitude).

### 1.3 Scheduling
- One-time full ingest in E1. Then a **nightly** incremental (new/updated TMDB titles +
  provider refresh) via Supabase scheduled function or a GitHub Action cron.
- Provider availability (`providers` jsonb) is refreshed nightly because it changes often.

### 1.4 Cost guardrail
Full embed of ~100K titles ≈ $0.20–0.40 once (PRD §8). The job logs token totals and
aborts if projected cost exceeds a configurable ceiling (default $2) — a cheap circuit
breaker against a runaway loop.

---

## 2. Retrieval

For a `/recommend` call:

1. Build the **query embedding** from the user's message (+ optionally a short distillation
   of recent taste — see §3.2). Embed with the same model.
2. pgvector nearest neighbours by **cosine distance**:

```sql
select t.tmdb_id, t.title, t.media_type, t.release_year, t.genres, t.overview,
       t.poster_path, t.providers,
       1 - (e.embedding <=> $1) as similarity
from catalog_embeddings e
join catalog_titles t using (tmdb_id)
where ($2::text is null or t.media_type = $2)         -- scope filter
  and t.tmdb_id <> all($3::int[])                     -- exclude watched + excluded
order by e.embedding <=> $1
limit $4;                                              -- K (default 40)
```

3. **K** default 40, cap 60 (🔒 reconciled with SPEC §8; review M5). Smaller K = cheaper
   Claude call + tighter grounding; too small = poor coverage. 40 is the v1 default; config.
4. **De-dupe set `$3` (precise — resolves review M3).** The exclude id set is built as:
   - **Movies:** exclude any `tmdb_id` with ≥ 1 finished `watch` (`progress_pct ≥ threshold`).
   - **TV shows:** exclude a show's `tmdb_id` **only if** (a) it is in `excluded_titles`
     (explicit user exclude), **or** (b) the user has finished **≥ 80% of its released
     episodes** — computed as `distinct finished (season,episode) / released_episode_count`
     (released count comes from `catalog_titles` for the show). Finishing one episode does
     **not** exclude the show, so we can still recommend a show the user is mid-binge on if
     they ask — but we will not push a show they've essentially completed.
   - Plus everything in `excluded_titles` regardless of type.
   This makes AC-3.3 (0-tolerance) deterministic and testable. The `released_episode_count`
   is refreshed by the nightly catalog job.
5. If 0 rows: return the honest "no good match" path (don't call Claude).

---

## 3. The RAG / generation step

### 3.1 Why Claude here at all
Vector search gives *similar* titles; Claude does three things vectors can't: **rank** by the
nuanced reason the user gave, **write the human "why"**, and **converse** (multi-turn
refinement). It must never *invent* titles — only choose and explain among retrieved ones.

### 3.2 Prompt structure (with caching) {#prompt-caching}

🔒 Layout the messages so the **stable prefix is cacheable** and only the tail is fresh:

```
system  (CACHED)  → role, hard rules, output JSON contract, grounding rules
system  (CACHED)  → the user's taste profile, compactly rendered
                    (changes rarely; cache breaks only when profile changes)
user    (FRESH)   → the current query + the candidate list (id, title, year, genres, 1-line)
                    + conversation history for this thread
```

- Use Anthropic **prompt caching** (`cache_control: { type: 'ephemeral' }`) on the two system
  blocks. The candidate list + query are always fresh.
- Render the **taste profile** as a compact, bounded summary (top liked/disliked with
  reasons, recent finishes) — cap its size (e.g. ≤ 800 tokens) so cost stays predictable.
  A long profile is summarised by a cheap periodic job, not sent raw.
- Keep the candidate list compact: `id | title (year) | genres | one-line overview`. Do NOT
  send full overviews for all 40 — it inflates tokens with little ranking benefit.

### 3.3 Output contract (model returns JSON)
Instruct the model to return **only** this JSON (we parse, then validate):

```jsonc
{
  "assistantMessage": "short conversational reply",
  "picks": [
    { "tmdbId": 27205, "why": "one-sentence grounded reason tied to the user's words" }
  ]
}
```

- `picks[].tmdbId` MUST be from the candidate list. The prompt states this explicitly **and**
  we enforce it in code (next section). Belt and suspenders.
- `why` must reference the user's stated taste or a finished watch ("Because you finished
  Sicario and like tense, morally-gray thrillers"). Generic whys are a quality bug.
- Order of `picks` = recommended ranking.

### 3.4 Grounding gate (🔒 server-side, non-negotiable)

```ts
const candidateIds = new Set(candidates.map(c => c.tmdbId));
const grounded = model.picks.filter(p => candidateIds.has(p.tmdbId));
// any non-candidate id is DROPPED, never repaired or looked up.
if (grounded.length === 0) return honestNoMatchResponse(model.assistantMessage);
```

Then enrich each grounded pick from the candidate row we already have: title, year, poster,
and **`whereToWatch`** = `catalog_titles.providers[profile.region]`, ordered so the user's
`profile.subscriptions` come first (review M7). 🔒 The server does **not** set `playDeepLink`
(it cannot map TMDB → a Netflix watch URL); the client adapter fills that post-response for
the current title only (review B1, [`04 §6.5`](04-extension.md#65-deep-links-client-side-only--resolves-review-b1)).
This guarantees **every shipped recommendation is a real TMDB title** the system retrieved.

⚠️ **Provider-name normalization (review m4).** TMDB provider names ("Netflix", "Amazon
Prime Video") must match `profile.subscriptions` and the adapter `siteId` ('netflix'). Keep a
single normalization map in `_shared/providers.ts` (TMDB name → canonical name + optional
siteId) and run all provider strings through it before comparison/boost.

### 3.5 Model & params (timeout ladder — resolves review M4)
- Model: `claude-haiku-4-5-20251001` (🔒 PRD).
- `max_tokens` ~ 600; low temperature (e.g. 0.4) for stable, grounded output.
- **Timeout ladder:** OpenAI embed ≤ **4s** → Claude ≤ **12s** → **server total ≤ 14s** →
  client `/recommend` timeout **18s**. On timeout/error return `UPSTREAM_TIMEOUT`/
  `UPSTREAM_ERROR` (retryable). p95 target < 6s; the ≤14s is the hard ceiling, not the norm.
- If JSON parse fails: one bounded repair retry (counts against the 12s budget), then fail
  gracefully. Never ship unparsed model text as recommendations.

### 3.6 Multi-turn
- A `threadId` keys a server-side **`chat_threads`** row (the table in [`02 §1.2`](02-data-models.md#12-user-data-rls-protected);
  name reconciled — was loosely called `chat_turns`, review B3) storing the running message
  history (bounded to last N turns) under RLS. Refinement ("more like the second one, but
  funnier") re-runs retrieval with the augmented query + prior context. History older than N
  turns is dropped or summarised to keep tokens bounded. The row is purged after 30 days and
  by `DELETE /account/data`. Persisting chat at rest is disclosed in onboarding ([`06 §5`](06-security-privacy.md#5-privacy-by-design-fr-6--nfr)).

---

## 4. Cost model in practice
- Per call: ~2–3K cached input + ~0.5–1K fresh input + ~600 output on Haiku ≈ **~$0.005**.
- ⚠️ **Caching is upside, not a guarantee (resolves review m9).** Anthropic's prompt cache
  TTL is ~5 minutes. For sporadic friends/beta usage, consecutive calls are usually > 5 min
  apart, so the cached blocks expire and the "≈ halved" figure often won't be realized. Budget
  against the **uncached ~$0.005/call**; treat cache hits as a bonus during active sessions.
- Controls: K cap (40/60), profile cap (800 tok), per-user daily limit (60), prompt caching.
- The function logs **token counts + cache-hit tokens only** (no content) per call for cost
  monitoring.

---

## 5. Title resolution {#title-resolution}

Used by `GET /catalog/resolve` (capture path).

```
score = 0.6 * stringSimilarity(scrapedTitle, candidate.title)   // trigram / Jaro-Winkler
      + 0.25 * (yearMatch ? 1 : yearClose ? 0.5 : 0)
      + 0.15 * (mediaTypeMatch ? 1 : 0)
confidence = score   // 0..1
```

- Step 1: search local `catalog_titles` (`ILIKE`/`pg_trgm` + year/type filters), score
  candidates, take the best.
- Step 2: if best `confidence < 0.6`, fall back to **TMDB search API**; if that yields a
  strong match, **insert it into the catalog + embed it** (lazy catalog growth) and return it.
- Step 3: still `< 0.6` → `404`; the client asks the user to confirm/skip (never record a
  guess as a finished watch).
- TV: resolve the **show** to its TMDB id; record `season`/`episode` from the scrape. The
  taste profile aggregates episodes to show-level for recommendations (PRD "finished semantics").

---

## 6. Quality bar / evaluation
- A small **golden set** (`backend/jobs/eval/cases.json`) of ~20 hand-written prompts with
  expected qualities ("returns ≥3 real titles", "no watched title", "why references the
  reason"). Run it manually before each release; it's the smoke test for rec quality.
- Track two regressions explicitly: (a) any hallucinated id surviving the gate (must be 0),
  (b) recommending an already-watched/excluded title (must be 0). Both are blocking bugs.
