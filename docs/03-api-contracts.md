# 03 — API Contracts (Edge Functions)

> Parent: [`../SPEC.md`](../SPEC.md). Every endpoint the extension calls. Treat this as the
> binding contract; the `@moviefinder/shared` zod schemas are the enforceable version of it.

---

## 0. Conventions for all endpoints

- **Transport:** HTTPS only. Base URL = the Supabase Functions URL (config, never hardcoded).
- **Auth:** `Authorization: Bearer <supabase_access_token>` on every call. Missing/invalid → `401`.
- **Body:** `application/json`. Parsed with the matching zod schema; failure → `400` with
  `error.code = "INVALID_INPUT"` and a safe message (no echo of raw input).
- **CORS:** `Access-Control-Allow-Origin` set to the extension origin
  (`chrome-extension://<id>`) read from an allowlist env var. Reflecting `*` is forbidden. ⚠️
- **Envelope:** every response is the success/failure envelope from SPEC §5.
- **Idempotency:** `POST /sync` is idempotent by record id; `POST /recommend` is not (it's a
  fresh generation each time) but is safe to retry.
- **Rate limits:** per-user, enforced in a shared helper (`_shared/rateLimit.ts`) backed by
  a Postgres table or Supabase KV. Defaults below; tune in config.

### Error codes (closed set)

| `error.code`       | HTTP | `retryable` | Meaning                                  |
| ------------------ | ---- | ----------- | ---------------------------------------- |
| `UNAUTHENTICATED`  | 401  | false       | No/invalid JWT                           |
| `INVALID_INPUT`    | 400  | false       | Body failed schema validation            |
| `RATE_LIMITED`     | 429  | true        | Per-user budget exceeded                 |
| `UPSTREAM_TIMEOUT` | 504  | true        | Anthropic/OpenAI/TMDB timed out          |
| `UPSTREAM_ERROR`   | 502  | true        | Upstream returned an error               |
| `NOT_FOUND`        | 404  | false       | e.g. resolve found nothing               |
| `INTERNAL`         | 500  | true        | Unexpected; logged with a trace id       |

The client maps `retryable` to whether it shows a "Try again" affordance.

---

## 1. `POST /recommend`  (core)

The full RAG behaviour is in [`05-recommendation-engine.md`](05-recommendation-engine.md);
this is the wire contract.

**Request** (`RecommendRequest`)
```jsonc
{
  "query": "I loved Inception — the layered reality and the score. What else?",
  "scope": "any",            // "movie" | "tv" | "any" (default "any")
  "threadId": "…uuid…",      // omit on first turn; echo back for multi-turn
  "currentSite": "netflix"   // the title the user currently has open (for client deep-linking)
}
```

**Response** (`RecommendResponse`) — ⚠️ the server **never** sets `playDeepLink`; the client
adapter fills it post-response for the title currently open (resolves review B1):
```jsonc
{
  "ok": true,
  "data": {
    "threadId": "…uuid…",
    "assistantMessage": "Since you loved Inception's layered reality, try these:",
    "recommendations": [
      {
        "tmdbId": 1124,
        "mediaType": "movie",
        "title": "The Prestige",
        "year": 2006,
        "posterUrl": "https://image.tmdb.org/t/p/w342/…",
        "why": "Twisty, layered structure and obsessive rivalry — the kind of reality-bending you liked in Inception.",
        "whereToWatch": ["Netflix"]
        // no playDeepLink here: the server cannot map TMDB → a Netflix watch URL.
        // The client adds one ONLY if this title is the one currently open on the page.
      }
    ]
  }
}
```

**Server-side steps (must, in order):** auth → validate → rate-limit → load + assemble
profile from DB (empty profile is valid — cold-start) → embed query (OpenAI) → pgvector
top-K → de-dupe vs `watches`+`excluded_titles` (TV rule in [`05 §2.4`](05-recommendation-engine.md#2-retrieval))
→ build cached prompt → call Claude → **grounding gate** (drop any `tmdbId` not in the
candidate set) → enrich (poster; `whereToWatch` from `catalog_titles.providers[profile.region]`
filtered/boosted by `profile.subscriptions`) → upsert the turn into the `chat_threads` row
keyed by `threadId` → respond. **No deep link is produced server-side.**

**Rate limit (default):** 60 calls / user / day, burst 10 / minute.

**Timeout ladder (🔒, resolves review M4):** OpenAI embed ≤ 4s, Claude ≤ 12s, **server total
≤ 14s** → the client's `/recommend` timeout is **18s** (> server, so the server's typed error
wins instead of a blind client abort). p95 end-to-end target < 6s; the ≤14s ceiling is the
hard cutoff, not the expected latency.

**Grounding guarantee:** `recommendations[].tmdbId` ⊆ retrieved candidate ids. If the model
returns a title not in candidates, it is dropped (not "fixed up"). If all are dropped, return
an honest `assistantMessage` and `recommendations: []`.

---

## 2. `POST /sync`

Push the client outbox, pull the server delta. Idempotent.

**Request** (`SyncRequest`)
```jsonc
{
  "outbox": [
    { "id": "…uuid…", "entity": "watch", "op": "upsert",
      "payload": { /* Watch, id = deterministic uuidv5 */ }, "updatedAt": 1717000000000 },
    { "id": "exclude:603", "entity": "exclude", "op": "delete",
      "payload": { "tmdbId": 603 }, "updatedAt": 1717000001000 }
  ],
  "since": 1716990000000       // pull everything updated_at > since
}
```

**Response** (`SyncResponse`)
```jsonc
{
  "ok": true,
  "data": {
    "applied": ["…uuid…","exclude:603"],
    "serverChanges": {
      "watches":        [ /* Watch[] */ ],
      "tasteSignals":   [ /* TasteSignal[] */ ],
      "excludedTitles": [ /* ExcludedTitle[] */ ]   // included so 2nd device gets them (review M1)
    },
    "cursor": 1717000002000
  }
}
```

**Rules**
- Upsert is keyed by the record **`id`** with `ON CONFLICT (id) DO UPDATE` — and because
  `watches.id` is the deterministic uuidv5 of its natural key (review B2), a second device
  upserting the same episode updates the one row instead of violating the natural-key index.
- Apply only if the item's `updatedAt` ≥ the stored row's `updatedAt` (last-write-wins).
  Older items are acknowledged in `applied` but ignored (client can drop them).
- `op:"delete"` performs a hard delete (RLS-scoped).
- `serverChanges` returns rows (incl. `excludedTitles`) with `updated_at > since`
  **excluding** ones the client just pushed in this call (avoid echo). Client applies them to
  IndexedDB then advances its cursor.
- Cap `outbox` at 500 items/request; client batches beyond that.

**Rate limit:** 120 calls / user / day (sync is frequent but cheap).

> **No `/feedback` endpoint (resolves review M8).** "I liked X because Y" is written as a
> `taste_signals` row in IndexedDB and pushed via this `/sync` path — a single write path,
> so there is no server-vs-client id duplication. The chat UI writes the signal locally and
> triggers a debounced sync; immediacy is preserved without a second endpoint.

---

## 3. `GET /catalog/resolve`

Map a scraped title string (+ optional year/type/season/episode) to a canonical TMDB id.

**Request** (query string)
```
GET /catalog/resolve?title=Inception&year=2010&type=movie
GET /catalog/resolve?title=Severance&type=tv&season=1&episode=3
```

**Response**
```jsonc
{
  "ok": true,
  "data": {
    "tmdbId": 27205,
    "mediaType": "movie",
    "title": "Inception",
    "year": 2010,
    "confidence": 0.94        // 0..1; client records only if ≥ 0.6 (else confirm)
  }
}
```
- Resolution strategy: query the local `catalog_titles` first (trigram/`ILIKE` + year), fall
  back to the TMDB search API, then **persist the resolved title into `catalog_titles` +
  embedding** so the catalog grows lazily toward what users actually watch.
- `confidence` blends string similarity, year match, and media-type match (formula in
  [`05-recommendation-engine.md`](05-recommendation-engine.md#title-resolution)).
- No match → `404 NOT_FOUND` (client then asks the user to confirm/skip).

**Rate limit:** 300 / user / day (capture can be bursty during a binge).

---

## 4. `DELETE /account/data`

The single authoritative data-delete path (resolves review M11). Hard-deletes **all** of the
caller's rows, RLS-scoped, in one transaction.

**Request:** `DELETE /account/data` (no body).

**Response**
```jsonc
{ "ok": true, "data": { "deleted": { "watches": 42, "tasteSignals": 7,
  "excludedTitles": 3, "chatThreads": 5, "rateLimits": 9, "profile": 1 } } }
```
- Deletes from `watches`, `taste_signals`, `excluded_titles`, `chat_threads`, `rate_limits`,
  and `profiles` where `user_id = auth.uid()`. The `auth.users` row itself is retained (the
  account still exists, just empty) unless the user also chooses account closure (out of v1).
- The client pairs this with clearing all registered IndexedDB stores (`dataManifest.ts`).
- Idempotent: deleting when already empty returns zero counts, still `ok: true`.

**Rate limit:** 5 / user / day (it's a rare, deliberate action).

---

## 5. Auth (email OTP code — resolves review B4)

Auth is handled by the **Supabase Auth client inside the background SW**, not a custom
endpoint. We use **OTP code entry, not magic links**, because a magic link is an `https://`
redirect that lands in a normal web tab — it cannot deliver a token into a `chrome-extension://`
SW. OTP keeps the whole flow in-extension:

1. User types their email into the SW-owned onboarding UI → SW calls
   `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`.
2. Supabase emails a **6-digit code**. The user pastes the code into the onboarding UI.
3. SW calls `supabase.auth.verifyOtp({ email, token: code, type: 'email' })` → receives the
   session (`access_token`, `refresh_token`).
4. SW stores the session in **`chrome.storage.session`** (not IndexedDB, not localStorage,
   never in the injected page). ⚠️ Tokens never touch page context.
5. SW refreshes the token before a backend call when near expiry; on refresh failure → sign
   the user out and prompt re-auth.

> Fallback if a future requirement forces magic links: host a callback page on a real origin
> that `postMessage`s the verified token-hash to the extension, or use `verifyOtp` with a
> `token_hash` query param. Not needed for v1.

See [`06-security-privacy.md`](06-security-privacy.md#token-handling) for token storage rules.

---

## 6. `GET /profile`  (debug & export — FR-8)

Read-only. Returns the **assembled taste profile** (the same server-side aggregation
`/recommend` builds — see [`05 §3.7`](05-recommendation-engine.md#37-tv-aggregation-episodes--one-weighted-show-item-)) plus the user's **title-enriched viewing history**. Powers the
CSV export and is the canonical "what does the system think of me?" view. No LLM, no
embeddings → cheap and fast.

**Request:** `GET /profile` (no body).

**Response**
```jsonc
{
  "ok": true,
  "data": {
    "profile": { /* TasteProfile incl. items: TasteProfileItem[] */ },
    "history": [
      { "tmdbId": 27205, "title": "Inception", "year": 2010, "mediaType": "movie",
        "season": null, "episode": null, "progressPct": 0.97,
        "finishedAt": 1716990000000, "source": "scrobble" }
      // one row per watch (per episode for TV), joined to catalog_titles for title/year
    ]
  }
}
```
- RLS-scoped to `auth.uid()`; returns **only the caller's** data. Titles come from
  `catalog_titles` (catalog data, not PII).
- `history` is `watches` left-joined to `catalog_titles`; a watch whose title isn't yet in the
  catalog returns `title: null` (rare; resolve backfills it).
- The client renders two CSVs from this payload — schemas in [`11-data-export.md`](11-data-export.md).
- Consent-gated like every data path. The response DTO + its zod schema are added together
  per the type↔schema rule ([`02-data-models.md` §3](02-data-models.md)).

**Rate limit:** 30 / user / day (a deliberate, occasional action).

---

## 7. Versioning

- Path-version when a breaking change is unavoidable: `/v2/recommend`. v1 stays until all
  installed clients update (extensions auto-update, but allow a 2-week overlap).
- Additive fields are non-breaking; clients MUST ignore unknown response fields.
- The deployed function set is pinned per release in [`08-work-breakdown.md`](08-work-breakdown.md#release-checklist).
