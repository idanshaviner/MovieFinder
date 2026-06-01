# 05 — Recommendation Engine

> Parent: [`../SPEC.md`](../SPEC.md). Catalog ingest, embeddings, retrieval, the RAG prompt,
> grounding, prompt caching, and title resolution. This is where accuracy & cost are won.

---

## 1. Catalog ingest (Epic E1)

Goal: populate `catalog_titles` + `catalog_embeddings` from TMDB so vector search has
something to retrieve.

### 1.1 What to ingest (v1 curated set — international, multi-language)
- TMDB **popular + top-rated** movies and TV, **across major markets/languages** (not English
  only — availability auto-detects region, so international users must get good matches). Source
  via TMDB discover/popular per language **and** per major region, then de-dupe by `tmdb_id`.
- Target ~100–150K titles (multi-language widens the set; cost is still tens of dollars, §1.4).
  Still avoid the obscure long tail — it bloats cost and hurts precision; lazy on-demand resolve
  (§5) backfills whatever real users actually watch.
- Store the **original language** and keep `overview` in a consistent language for embeddings
  (prefer English overview when available for a shared vector space; fall back to original).
- Per title, store the fields in `catalog_titles` (incl. `released_episode_count`, `providers`
  per region, `platform_ids`, the TMDB **`adult`** flag, and a best-effort **`maturity_rank`**
  0–5 derived from TMDB certifications/content-ratings — null when unknown, treated as 0) and
  build the **embedding source text**:

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
Full embed of ~100–150K multi-language titles ≈ **$0.30–0.60 once**. The job logs token
totals and aborts if projected cost exceeds a configurable ceiling (default $3) — a cheap
circuit breaker against a runaway loop. (Distinct from the runtime `MONTHLY_BUDGET_USD`
kill-switch in [`09 §13`](09-conventions.md#13-cost--budget-guard).)

---

## 2. Retrieval

For a `/recommend` call:

1. Build the **query embedding** from the user's message (+ optionally a short distillation
   of recent taste — see §3.2). Embed with the same model.
2. pgvector nearest neighbours by **cosine distance**:

```sql
select t.tmdb_id, t.title, t.media_type, t.release_year, t.genres, t.overview,
       t.poster_path, t.providers, t.platform_ids,
       1 - (e.embedding <=> $1) as similarity
from catalog_embeddings e
join catalog_titles t using (tmdb_id)
where ($2::text is null or t.media_type = $2)         -- scope filter
  and t.tmdb_id <> all($3::int[])                     -- exclude watched + excluded
  and t.adult = false                                 -- 🔒 adult ALWAYS excluded (FR-6)
  and ($5::boolean = false                            -- $5 = familyMode (content_filter='family')
       or coalesce(t.maturity_rank, 0) <= $6)         -- $6 = FAMILY_MAX_MATURITY (e.g. 2)
order by e.embedding <=> $1
limit $4;                                              -- K (default 40)
```

3. **K** default 40, cap 60 (🔒 reconciled with SPEC §8; review M5). Smaller K = cheaper
   Claude call + tighter grounding; too small = poor coverage. 40 is the v1 default; config.
4. **De-dupe set `$3` (precise — resolves review M3).** The exclude id set is built as:
   - **Movies:** exclude any `tmdb_id` the user has **any** `watch` for — finished *or*
     completion-unknown (FR-9). Rationale: they've already seen it; don't re-recommend.
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

### 2.5 Availability-aware two-tier ranking (FR-4) {#25-availability-aware-two-tier-ranking-fr-4}

🔒 Retrieval is **platform-agnostic** (we never filter the catalog by platform — that's what
lets us match the user's taste honestly). Availability shapes **ranking and presentation**, not
what we retrieve.

**Candidate sourcing (so the on-platform tier is never starved).** A single global top-K can,
by chance, contain few or no on-platform titles even when good ones exist just outside it. So
retrieval (§2) runs **two queries and unions them**: the global top-K (platform-agnostic), plus
a **platform-filtered top-M** (`where providers[region] ⊇ currentSite`, M ≈ 20). The union (cap
≈ 60, dedup) is the candidate set. This guarantees the model and the ranker actually *see*
on-platform options to prefer. Cheap: same index, one extra ANN query.

For each candidate, compute `onPlatform = providers[region]` contains a provider that the
[`_shared/providers.ts`](#) normalization map ties to the request's `currentSite` (e.g.
`"Netflix"` → `netflix`). Then compose the final list (target `N` ≈ 5):

1. **Partition** candidates into `onPlatform` and `offPlatform`, each kept in similarity/taste
   rank order (`rankScore` from §3.7 where applicable).
2. **On-platform first.** Fill the result from `onPlatform` candidates.
3. **"Much better" off-platform rule.** Include an `offPlatform` title only if **either**:
   - the on-platform pool can't fill `N` (not enough good on-platform matches), **or**
   - its score beats the **best on-platform candidate** by a margin `δ` (default `δ = 0.05`
     cosine similarity; tunable). This is the crisp meaning of "unless it's much better."
   Cap off-platform picks at **≤ 2** of `N` unless the on-platform pool is empty.
4. **If the on-platform pool is empty**, return the best off-platform matches (with clear
   where-to-watch) rather than nothing — never refuse just because the platform lacks a match.
5. **Disclosure flag.** If the final list contains **any** off-platform title while on-platform
   alternatives also existed, set an internal `hasOnPlatformAlternatives = true` so the prompt
   instructs the model to **say so** in `assistantMessage` ("…X is the strongest match but it's
   on Prime; if you'd rather stay on Netflix, Y and Z are close"). The structured per-rec
   `onCurrentPlatform` badge is the authoritative UI signal; the prose note reinforces it.

The model receives each candidate's `onPlatform` flag and this policy, and orders within it; the
server then enforces the caps (drops excess off-platform) and sets the authoritative
availability fields. ⚠️ **Never trust the model for availability or links** — those are computed
from `catalog_titles`.

---

## 3. The RAG / generation step

### 3.1 Why Claude here at all
Vector search gives *similar* titles; Claude does three things vectors can't: **rank** by the
nuanced reason the user gave, **write the human "why"**, and **converse** (multi-turn
refinement). It must never *invent* titles — only choose and explain among retrieved ones.

### 3.2 Prompt structure (with caching) {#prompt-caching}

🔒 Layout the messages so the **stable prefix is cacheable** and only the tail is fresh:

```
system  (CACHED)  → role, hard rules, output JSON contract, grounding rules,
                    acknowledgment rule, two-tier availability rule (see below)
system  (CACHED)  → the user's taste profile, compactly rendered
                    (changes rarely; cache breaks only when profile changes)
user    (FRESH)   → the current query + the candidate list
                    (id | title (year) | genres | 1-line | onPlatform: yes/no)
                    + hasOnPlatformAlternatives flag + conversation history for this thread
```

- Use Anthropic **prompt caching** (`cache_control: { type: 'ephemeral' }`) on the two system
  blocks. The candidate list + query are always fresh.
- Render the **taste profile** as a compact, bounded summary (top liked/disliked with
  reasons, recent finishes) — cap its size (e.g. ≤ 800 tokens) so cost stays predictable.
  A long profile is summarised by a cheap periodic job, not sent raw.
- Keep the candidate list compact: `id | title (year) | genres | one-line overview | onPlatform`.
  The `onPlatform` flag is what lets the model do the two-tier ordering; it's cheap.
- **Two cached system rules added for this feature:**
  - **Acknowledgment rule:** "If the user names a title they liked, acknowledge it by name in
    your reply **even if it is not in the candidate list / not on the platform** — then make
    your picks." (The named title may be off-platform or not retrieved; we still recognize it.)
  - **Two-tier rule:** "Prefer titles with `onPlatform: yes`. Only choose an `onPlatform: no`
    title when it is a clearly better match. **If `hasOnPlatformAlternatives` is true and you
    include any off-platform pick, explicitly tell the user that on-platform options also
    exist.**"

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
- `assistantMessage` should **acknowledge any title the user named** (even off-platform / not
  retrieved), and — when the picks include an off-platform title and on-platform ones existed —
  **note that on-platform alternatives are available** (driven by `hasOnPlatformAlternatives`).
- Order of `picks` = recommended ranking (the server still enforces §2.5 caps after).

### 3.4 Grounding gate (🔒 server-side, non-negotiable)

```ts
const candidateIds = new Set(candidates.map(c => c.tmdbId));
const grounded = model.picks.filter(p => candidateIds.has(p.tmdbId));
// any non-candidate id is DROPPED, never repaired or looked up.
if (grounded.length === 0) return honestNoMatchResponse(model.assistantMessage);
```

Then apply the **availability-aware ordering/caps** (§2.5) and enrich each grounded pick from
the candidate row we already have:
- `title`, `year`, `poster`.
- `onCurrentPlatform` = the §2.5 `onPlatform` flag for the request's `currentSite`.
- `whereToWatch` = `catalog_titles.providers[profile.region]`, ordered so the user's
  `profile.subscriptions` come first (review M7). For **off-platform** picks this is the display
  text ("On Prime Video, Max") — names only, **no link** (per product decision).
- For **on-platform** picks, build `currentPlatformUrl` (the hybrid — product decision):
  ```ts
  const nativeId = catalogRow.platform_ids?.[currentSite];           // learned via /catalog/platform-link
  rec.currentPlatformUrl = nativeId
    ? buildExactTitleUrl(currentSite, nativeId)                       // e.g. netflix.com/title/70131314
    : buildSearchUrl(currentSite, rec.title);                        // e.g. netflix.com/search?q=The%20Prestige
  ```
- 🔒 The server still does **not** set `playDeepLink` (it can't synthesize an exact
  `/watch/<id>` *play* URL); the client adapter upgrades that for the **currently-open** title
  only ([`04 §6.5`](04-extension.md#65-deep-links--availability-links)).

This guarantees **every shipped recommendation is a real TMDB title** the system retrieved, with
honest, server-authoritative availability.

⚠️ **Provider-name normalization (review m4).** TMDB provider names ("Netflix", "Amazon
Prime Video") must match `profile.subscriptions` and the adapter `siteId` ('netflix'). Keep a
single normalization map in `_shared/providers.ts` (TMDB name → canonical name + optional
siteId) and run all provider strings through it before comparison/boost.

### 3.5 Model & params (timeout ladder — resolves review M4) {#35-model--params}
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

### 3.7 TV aggregation: episodes → one weighted show item (🔒)

Capture is per **episode** (a `watch` per episode ≥ threshold). But the **taste profile and the
query-distillation embedding treat each show as a single weighted item**, so a 40-episode binge
doesn't drown out movies and a one-episode sample isn't mistaken for devotion. This is the crisp
meaning of "aggregate to show level." It is computed **server-side at recommend time** (the
profile is server-derived per SPEC §1); nothing extra is persisted.

For each show `S` with ≥ 1 finished episode:
- `epsFinished(S)` = distinct finished `(season, episode)` count.
- `epsReleased(S)` = `catalog_titles.released_episode_count` (nightly-refreshed; same source as §2.4).
- `frac(S) = epsFinished / max(epsReleased, 1)`.
- `lastFinishedAt(S)` = max finished-episode `ts` (drives recency).

**Engagement tier → taste weight** (evaluate top-down; first match wins):

| Tier          | Condition           | Weight | Notes                                                        |
| ------------- | ------------------- | ------ | ------------------------------------------------------------ |
| **Completed** | `frac ≥ 0.80`       | 1.5    | Same 80% line as the exclusion rule (§2.4) → also excluded from recs |
| **Engaged**   | `epsFinished ≥ 3`   | 1.0    | Calibrated to equal **one finished movie**                   |
| **Sampled**   | `epsFinished ∈ {1,2}` | 0.3  | Weak / low-confidence ("gave it a try")                      |

🔒 A finished **movie** is a single item of weight **1.0** — the unit the TV weights are
calibrated against. Top-down evaluation means a 2-of-2 limited series scores `frac=1.0` →
**Completed**, not Sampled.

🔒 **Completion-unknown watches (FR-9, [`12 §3`](12-netflix-session-import.md#3-completion-unknown-watches--data-model-decision)).**
A movie watch with `completion_known=false` is a weaker positive than a confirmed finish →
weight **0.5** (vs 1.0). A later confirmed finish (scrobble/CSV) converges on the same
deterministic `watchId` and upgrades it to 1.0. For TV, only `completion_known` episodes count
toward `epsFinished` in the tier fractions.

**How the weight is used**
- **Profile selection:** when capping the profile to ≤ 800 tokens / top-N items (§3.2), rank
  items by `weight × recency`, where `recency` is a decay on `lastFinishedAt` (suggest a 90-day
  half-life; tune later). **One line per show, never per episode.**
- **Query distillation (§2 step 1):** weight each seed title's contribution to the query vector
  by its item weight, so Completed/recent shows pull harder than Sampled/old ones.
- **Rendering:** one profile line per show, e.g. `The Bear (TV, Engaged, 8 eps) — recent`.
- **Inspectable:** these items are the `TasteProfile.items` shape returned by
  [`GET /profile`](03-api-contracts.md#6-get-profile--debug--export--fr-8) and exported to
  `taste-profile.csv` ([`11`](11-data-export.md)) — the debug view of what the recommender thinks.

**Explicit signals win.** A `taste_signals` like/dislike on a show **overrides** the derived
tier: a dislike makes the item **negative** regardless of episode count; an explicit like raises
it to at least Engaged. Episodes only set the *default* weight.

⚠️ Don't conflate this with **exclusion** (§2.4). Aggregation answers "*how strongly does this
show shape taste?*"; exclusion answers "*may we recommend this show back?*". They share the 80%
"Completed" line but are different decisions.

**Worked examples**

| Show                       | epsFinished | epsReleased | frac | Tier      | Weight        |
| -------------------------- | ----------- | ----------- | ---- | --------- | ------------- |
| Limited series, both eps   | 2           | 2           | 1.00 | Completed | 1.5 (excluded)|
| Drama, finished season 1   | 8           | 62          | 0.13 | Engaged   | 1.0           |
| Watched only the pilot     | 1           | 24          | 0.04 | Sampled   | 0.3           |
| Long-runner, caught up     | 180         | 200         | 0.90 | Completed | 1.5 (excluded)|

---

## 4. Cost model in practice
- Per call: ~2–3K cached input + ~0.5–1K fresh input + ~600 output on Haiku ≈ **~$0.004** warm.
- ⚠️ **Caching is upside, not a guarantee (resolves review m9).** Anthropic's prompt cache
  TTL is ~5 minutes. For sporadic friends/beta usage, consecutive calls are usually > 5 min
  apart, so the cached blocks expire and the "≈ halved" figure often won't be realized. Budget
  against the **uncached ~$0.006/call** (3K in × $1/1M + 600 out × $5/1M); cache hits are a bonus.
- Controls: K cap (40/60), profile cap (800 tok), per-user caps (75/mo + 15/day), monthly $5
  kill-switch, prompt caching. Caps are sized so `75 × 10 users × $0.006 ≤ $5` (docs/09 §13).
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
- TV: resolve the **show** to its TMDB id; record `season`/`episode` from the scrape. Episodes
  roll up into one weighted show item for the taste profile — see the crisp rule in [§3.7](#37-tv-aggregation-episodes--one-weighted-show-item-).

---

## 6. Quality bar / evaluation
- A small **golden set** (`backend/jobs/eval/cases.json`) of ~20 hand-written prompts with
  expected qualities ("returns ≥3 real titles", "no watched title", "why references the
  reason"). Run it manually before each release; it's the smoke test for rec quality.
- Track two regressions explicitly: (a) any hallucinated id surviving the gate (must be 0),
  (b) recommending an already-watched/excluded title (must be 0). Both are blocking bugs.
