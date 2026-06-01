# 01 — Architecture & Data Flow

> Parent: [`../SPEC.md`](../SPEC.md). This doc defines component responsibilities, the
> trust model, and the three end-to-end sequences that matter.

---

## 1. Component responsibilities

### Extension (untrusted zone — runs inside netflix.com)

| Component                  | Owns                                                                 | Must NOT do                                  |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| **Content script**         | Bootstrapping on a matched page; mounting the Shadow-DOM UI root     | Hold secrets; talk to backend directly       |
| **Site adapter** (Netflix) | Reading player progress; resolving the on-screen title; emitting capture events | Throw into the host page; assume DOM stability |
| **Chat UI** (Preact)       | Rendering chat, recs, nudge; user input                              | Call Anthropic/TMDB directly                 |
| **Background SW**          | Auth/session, IndexedDB, outbox sync, all `fetch` to backend        | Keep durable state in memory                 |

### Backend (trusted zone — Supabase)

| Component            | Owns                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| **Edge Functions**   | The only code that sees API keys; validates input; enforces auth & rate limit |
| **Postgres+pgvector**| Catalog + embeddings + per-user data with RLS                              |
| **Catalog ingest**   | Periodic TMDB → embeddings → pgvector population                            |

**Rule of thumb:** if it needs a secret or another user's data, it happens in an Edge
Function. The extension is a thin client.

---

## 2. Trust boundary

```
  UNTRUSTED  │  TRUSTED
             │
  Extension  │  Edge Functions ── Postgres
  (any page  │  (verify JWT,      (RLS by user_id)
   can read  │   own the keys)
   our code) │
─────────────┼──────────────────────────────
  crosses the boundary: only a Supabase JWT + validated JSON DTOs
```

Everything the extension sends is **hostile until validated**. Every Edge Function:
1. Verifies the Supabase JWT (reject `401` if absent/invalid).
2. Parses the body with the zod schema from `@moviefinder/shared` (reject `400` on fail).
3. Applies a per-user rate limit (reject `429 RATE_LIMITED` over budget).
4. For paid paths, checks the **global monthly budget** ([`09 §13`](09-conventions.md#13-cost--budget-guard)) — reject `429 AT_CAPACITY` if over the ceiling.
5. Only then does real work, scoped to `auth.uid()`.

---

## 3. Source-of-truth & sync model

- **IndexedDB** = fast local working copy the UI reads/writes synchronously-ish.
- **Postgres** = durable, cross-device copy.
- **Sync** = client pushes its `outbox` (records with `syncState='pending'`) to `POST /sync`,
  then pulls any server records newer than its last-pulled cursor.
- **Conflict policy:** 🔒 **last-write-wins by `updatedAt`** per record id. Records are
  append-mostly (a `watch` rarely changes), so conflicts are rare; LWW is sufficient for v1.
- **Idempotency & cross-device identity (🔒, resolves review B2):** synced ids are
  **client-generated and stable**, so two devices producing the "same" record converge on
  one row instead of colliding with the natural unique key:
  - `watches`: `id = uuidv5(NAMESPACE, "{tmdbId}:{season ?? ''}:{episode ?? ''}")` —
    **deterministic**. Both devices that finish S1E3 of a show compute the *same* id → the
    second `/sync` is an idempotent upsert, never a unique-constraint violation. Helper:
    `packages/shared/src/ids.ts#watchId()`.
  - `taste_signals`: genuinely distinct events (no natural key) → **random UUIDv4** is correct.
  - `excluded_titles`: keyed by `(user_id, tmdb_id)`; the tmdb_id *is* the identity.
  ⚠️ Never use auto-increment ids for synced records, and never random-UUID a `watch`.

Why not real-time sync? Out of scope for v1 (PRD §10). The outbox model is simple,
resumable across SW eviction, and good enough for a friends/beta cohort.

---

## 4. Sequence: watch capture (FR-1)

```
Player        NetflixAdapter        Background SW        IndexedDB        /sync
  │ play           │                     │                  │              │
  │──progress────► │ sample every 5s     │                  │              │
  │                │ (throttled)         │                  │              │
  │                │ pct ≥ threshold     │                  │              │
  │                │ AND stable 3s ─────►│ WATCH_FINISHED   │              │
  │                │                     │ resolve title    │              │
  │                │                     │ (GET /catalog/resolve)          │
  │                │                     │ ──────────────────────────────► │
  │                │                     │ ◄── tmdbId, confidence           │
  │                │                     │ conf ≥ 0.6? ─────►│ put(watch,   │
  │                │                     │                   │  pending)    │
  │                │                     │ enqueue outbox ──►│              │
  │                │                     │ (debounced) ───────────────────► /sync
```

Key rules:
- Sampling is **throttled to ≤ 1/5s** and only while the tab is visible & playing.
- "Finished" fires **once** per (titleId, episode) per session — dedupe in the adapter.
- If title resolution confidence `< 0.6`, **do not silently record**; surface a small
  "Did you finish _X_?" confirm in the UI (cheap correction beats a wrong profile).

## 5. Sequence: recommendation (FR-3/FR-4)

```
Chat UI        Background SW        /recommend        pgvector        Claude
  │ user query    │                    │                 │              │
  │──RECOMMEND───►│ attach JWT + body  │                 │              │
  │               │ ─────────────────► │ embed query     │              │
  │               │                    │ ──────────────► │ top-K        │
  │               │                    │ ◄── candidates  │              │
  │               │                    │ de-dupe vs watches/excludes     │
  │               │                    │ build cached prompt ──────────► │
  │               │                    │ ◄── ranked ids + why + provider │
  │               │                    │ GROUNDING GATE (drop bad ids)   │
  │               │                    │ enrich posters + where-to-watch │
  │               │ ◄── RecommendResponse (NO deep link from server)      │
  │ adapter fills playDeepLink for the CURRENT title only ───────────────│
  │ ◄── render recs (poster, why, where-to-watch, [play link if current])│
```

Note (resolves review B1): query embedding (OpenAI) is an upstream call on **every**
`/recommend`, in series before pgvector — account for its latency and failure mode (§7).

## 6. Sequence: first-run onboarding (FR-6)

```
Install → SW onInstalled → open onboarding page (extension page, not injected)
  → explain capture + LLM disclosure
  → user enters email → SW signInWithOtp → user pastes 6-digit code → SW verifyOtp (session)
  → user enables Netflix + accepts consent → write settings{consentedAt} to IndexedDB + sync
  → ready. Capture, chat & sync are INERT until consentedAt is set.  🔒
```

⚠️ No **capture, chat/recommend, or sync** call may happen before `consentedAt` is set.
Auth (`signInWithOtp`/`verifyOtp`) is the *only* backend interaction allowed pre-consent —
it is how the user reaches the consent step. This is both a privacy requirement and a test
gate (see [`07-qa-test-plan.md`](07-qa-test-plan.md)).

---

## 7. Failure & degradation matrix

| Failure                         | Behaviour                                                        |
| ------------------------------- | --------------------------------------------------------------- |
| Backend unreachable             | Chat shows "can't reach MovieFinder, retry"; capture still queues locally to outbox |
| Adapter can't find player DOM   | Capture silently no-ops; health ping flags it; chat still works |
| Title resolution low-confidence | Ask user to confirm; never record a guess as fact               |
| Embedding service (OpenAI) down | `/recommend` returns `UPSTREAM_TIMEOUT`/`UPSTREAM_ERROR` (retryable) before any Claude call; UI offers "try again" |
| LLM (Claude) timeout or error   | Return retryable error; UI offers "try again" (timeout ladder in [`05 §3.5`](05-recommendation-engine.md#35-model--params)) |
| pgvector returns 0 candidates   | Honest "I don't have a good match" message, suggest broadening   |
| Rate limit hit                  | `429` with friendly "you've hit today's limit" copy             |

The golden rule: **the extension must never break or jank the Netflix page**, no matter
what fails. Wrap all adapter DOM work in try/catch that degrades to no-op.
