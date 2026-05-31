# MovieFinder — Engineering Specification (v1)

> **Companion to [`PRD.md`](PRD.md).** The PRD says _what_ and _why_; this spec says
> _how_. It is written to be executed by a team of **mixed experience** — every
> non-obvious decision is spelled out, every interface is typed, and every ticket has a
> Definition of Done.

- **Status:** Ready for build (incorporates panel review v1; B1–B5 + M/m findings resolved)
- **Last updated:** 2026-05-30
- **Owner:** idanshaviner
- **Scope:** v1 (Phase 0 + Phase 1 of the PRD roadmap), with hooks for Phase 2.

---

## 0. How to read this document

| If you are…              | Start with…                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| New to the project       | §1 (architecture), §2 (stack), §3 (repo layout)                        |
| Building the extension   | §6 (extension), §7.x adapter spec, §5 (API contracts)                  |
| Building the backend     | §4 (data models), §5 (API contracts), §7 (rec engine)                  |
| QA / test                | §9 (test plan & acceptance criteria)                                   |
| A lead assigning work    | §10 (work breakdown), §11 (Definition of Done)                         |

**Conventions in this doc**
- 🔒 = a locked decision; do not change without owner sign-off.
- ⚠️ = a known sharp edge / common mistake.
- `MUST` / `SHOULD` / `MAY` follow RFC-2119 meaning.
- All code samples are **TypeScript** unless stated otherwise.

The detailed sub-specs live in [`docs/`](docs/):
- [`docs/01-architecture.md`](docs/01-architecture.md) — components & data flow
- [`docs/02-data-models.md`](docs/02-data-models.md) — DB schema, IndexedDB, shared types
- [`docs/03-api-contracts.md`](docs/03-api-contracts.md) — every Edge Function endpoint
- [`docs/04-extension.md`](docs/04-extension.md) — MV3, messaging, UI, site adapters
- [`docs/05-recommendation-engine.md`](docs/05-recommendation-engine.md) — embeddings, retrieval, RAG
- [`docs/06-security-privacy.md`](docs/06-security-privacy.md) — threat model, RLS, consent
- [`docs/07-qa-test-plan.md`](docs/07-qa-test-plan.md) — test strategy & acceptance criteria
- [`docs/08-work-breakdown.md`](docs/08-work-breakdown.md) — epics, tickets, DoD
- [`docs/09-conventions.md`](docs/09-conventions.md) — coding standards, errors, logging

---

## 1. Architecture at a glance

```
┌──────────────────────── Browser Extension (MV3, Preact) ────────────────────────┐
│                                                                                  │
│  Content script (per-site adapter)         Background service worker             │
│   • NetflixAdapter v1                        • Auth/session (email OTP token)     │
│     – scrobbler (progress → finished)        • Local store (IndexedDB) owner:     │
│     – DOM injector (Shadow DOM root)            history + taste signals + outbox   │
│   • Injected Chat UI (Preact island)         • Sync engine (outbox → backend)     │
│   • End-of-title "watch next" nudge          • Calls backend /recommend, /sync     │
│                                                                                  │
└───────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ HTTPS (Bearer = Supabase JWT)
                          ┌──────────────▼───────────────┐
                          │   Supabase Edge Functions     │   (the "tiny proxy")
                          │   • POST /recommend            │
                          │   • POST /sync (history/taste) │
                          │   • GET  /catalog/resolve      │
                          │   • DELETE /account/data       │
                          │   Holds: ANTHROPIC + OPENAI +  │
                          │   TMDB keys (never in bundle)  │
                          └──────┬───────────────┬─────────┘
                                 │               │
          ┌──────────────────────▼──┐     ┌──────▼───────────────┐
          │ Supabase Postgres        │     │ Claude Haiku 4.5      │
          │  • pgvector catalog       │     │  (Anthropic API)      │
          │  • users / profiles       │     │  + prompt caching     │
          │  • RLS per-user isolation  │     └──────────────────────┘
          └───────────────────────────┘
                  ▲
                  │ one-time + nightly
          ┌───────┴────────────┐
          │ Catalog ingest job  │  TMDB → embeddings (OpenAI) → pgvector
          │ (Supabase cron /    │
          │  GH Action)         │
          └─────────────────────┘
```

**Two trust zones.** The extension is **untrusted** (runs on a third-party page); the
Edge Functions are the **trust boundary**. No API key, no other user's data, and no
unvalidated SQL ever crosses into the extension. See [`docs/06-security-privacy.md`](docs/06-security-privacy.md).

**Source of truth for user data.** The **extension's IndexedDB is the local working
copy** of the user's *raw* data — finished watches, taste signals, excludes, settings;
**Postgres is the durable, cross-device copy**. A **bidirectional, non-real-time,
last-write-wins outbox sync** (push local changes, pull a server delta) keeps them
aligned. The **assembled taste profile is derived server-side** at recommend time from
those raw rows (not stored on the client) — see [`docs/05`](docs/05-recommendation-engine.md).
Recommendations are always computed server-side so grounding/keys stay server-side.

Full component responsibilities and the end-to-end sequence diagrams are in
[`docs/01-architecture.md`](docs/01-architecture.md).

---

## 2. Tech stack (🔒 locked)

| Layer                | Choice                                                | Notes                                              |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Language             | **TypeScript 5.x**, `strict: true` everywhere         | One language across extension + functions          |
| Extension framework  | **Preact 10 + Vite 5 + `@crxjs/vite-plugin`**         | MV3 build + HMR; Shadow DOM for isolation          |
| Extension manifest   | **Manifest V3**, Chromium-first                       | Firefox deferred (PRD §10)                          |
| Local storage        | **IndexedDB** via **`idb`** wrapper                   | Structured, async, survives SW restarts            |
| Backend runtime      | **Supabase Edge Functions** (Deno)                    | Holds secrets; the only backend we run             |
| Database             | **Supabase Postgres 15 + `pgvector`**                 | Catalog embeddings + user data, RLS on             |
| Auth                 | **Supabase Auth, email OTP (6-digit code)**           | In-extension code entry (no redirect); JWT as Bearer. See [`docs/04`](docs/04-extension.md#auth) |
| LLM                  | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`)    | Prompt caching on system + profile                 |
| Embeddings           | **OpenAI `text-embedding-3-small`** (1536-dim)        | 🔒 pick one; do not mix models in one index        |
| Metadata             | **TMDB API**                                          | Catalog source + posters + watch providers         |
| Shared code          | **pnpm workspace** monorepo                           | `packages/shared` for types shared both sides      |
| Testing              | **Vitest** (unit), **Playwright** (E2E ext), **Deno test** (functions) | See §9                          |
| Lint/format          | **ESLint + Prettier**, shared config                  | CI-enforced                                        |
| CI/CD                | **GitHub Actions**                                    | Lint → typecheck → test → build → deploy functions |

**Pinned versions** live in [`docs/09-conventions.md`](docs/09-conventions.md#pinned-versions);
do not float majors mid-v1.

---

## 3. Repository layout (pnpm monorepo)

```
moviefinder/
├─ PRD.md
├─ SPEC.md                      ← this file
├─ docs/                        ← sub-specs (see §0)
├─ package.json                 ← workspace root, scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .github/workflows/ci.yml
│
├─ packages/
│  ├─ shared/                   ← types + constants shared by extension & backend
│  │  └─ src/
│  │     ├─ types.ts            ← Watch, TasteSignal, OutboxItem, ChatThread,
│  │     │                         TasteProfile (response-only), Recommendation, DTOs
│  │     ├─ schemas.ts          ← zod schemas (single source of validation truth)
│  │     ├─ ids.ts              ← deterministic watch-id (uuidv5 of natural key)
│  │     └─ constants.ts        ← COMPLETION_THRESHOLD_DEFAULT, model ids, etc.
│  │
│  ├─ extension/                ← the MV3 extension
│  │  ├─ manifest.config.ts     ← CRXJS manifest (typed)
│  │  ├─ src/
│  │  │  ├─ background/         ← service worker: auth, store, sync
│  │  │  ├─ content/            ← content-script entry + injector
│  │  │  ├─ adapters/           ← site adapters (Netflix v1)
│  │  │  │  ├─ types.ts         ← SiteAdapter interface (the contract)
│  │  │  │  └─ netflix/
│  │  │  ├─ ui/                 ← Preact chat panel, launcher, nudge
│  │  │  ├─ store/              ← IndexedDB schema + repositories
│  │  │  ├─ messaging/          ← typed message bus (content ↔ bg)
│  │  │  └─ lib/                ← api client, logger, config
│  │  └─ tests/                 ← vitest + playwright
│  │
│  └─ backend/                  ← Supabase project
│     ├─ supabase/
│     │  ├─ migrations/         ← SQL migrations (schema + RLS)
│     │  ├─ functions/          ← Edge Functions (one folder each)
│     │  │  ├─ recommend/
│     │  │  ├─ sync/
│     │  │  ├─ catalog-resolve/
│     │  │  ├─ account-delete/  ← DELETE /account/data
│     │  │  ├─ deno.json        ← import map: "@moviefinder/shared" → ../../shared/src
│     │  │  └─ _shared/         ← cors, auth, anthropic, openai, tmdb clients
│     │  └─ seed.sql
│     └─ jobs/
│        └─ catalog-ingest/     ← TMDB → embeddings → pgvector (Deno script)
│
└─ tools/                       ← dev scripts (local supabase, fixtures)
```

**Why a monorepo:** the request/response DTOs and the "finished = 90%" constant MUST be
identical on both sides. `packages/shared` makes that a compile-time guarantee instead of
a copy-paste bug. ⚠️ Never redefine an API type locally — import it from `@moviefinder/shared`.

**How Deno (Edge Functions) consumes `shared`:** Deno does not resolve pnpm `node_modules`.
The functions root carries a `deno.json` whose `imports` map points `@moviefinder/shared` at
`../../shared/src/*` (the raw `.ts`). The extension (Vite/pnpm) consumes the same package via
the workspace. One source, two resolution mechanisms — both compile-checked in CI (E0-2/E0-7).

---

## 4. Data models (summary — full DDL in [`docs/02-data-models.md`](docs/02-data-models.md))

### 4.1 Postgres (server, durable)

- `catalog_titles` — one row per TMDB movie/show; canonical metadata.
- `catalog_embeddings` — `vector(1536)` per title, `ivfflat` index, cosine distance.
- `profiles` — one per auth user (FK `auth.users`).
- `watches` — finished watches synced from clients (TMDB id, type, episode, pct, ts).
- `taste_signals` — explicit likes/dislikes + reason text from chat.
- `excluded_titles` — user "don't recommend this" set.
- `chat_threads` — server-side bounded multi-turn history per `threadId` (RLS, retention).
- `rate_limits` — per-user request counters backing the rate limiter.

All user tables have `user_id uuid` + **Row-Level Security** so a JWT can only read/write
its own rows. RLS policies are in the migrations and are **non-optional**.

### 4.2 IndexedDB (client, local working copy)

Object stores: `watches`, `taste_signals`, `excluded_titles`, `settings`, `outbox`,
`chat_threads` (UI-only local cache of the active conversation). Every user record carries
`updatedAt` (ms) and `syncState: 'pending' | 'synced'` to drive the outbox. Schema + `idb`
wrapper code in [`docs/02-data-models.md`](docs/02-data-models.md#indexeddb).

### 4.3 Shared types (the contract)

Defined once in `packages/shared/src/types.ts` and validated with zod in `schemas.ts`.
Key types: `Watch`, `TasteSignal`, `ExcludedTitle`, `OutboxItem`, `ChatThread`, `Settings`,
`Recommendation`, `RecommendRequest`/`RecommendResponse`, `SyncRequest`/`SyncResponse`.
`TasteProfile` is a **server-derived, response-only** shape (not persisted client-side).
Every Edge Function parses input with the zod schema **first thing**; invalid input → `400`.

---

## 5. API contracts (full detail in [`docs/03-api-contracts.md`](docs/03-api-contracts.md))

All endpoints: HTTPS, `Authorization: Bearer <supabase_jwt>`, JSON, CORS locked to the
extension origin. Standard error envelope:

```jsonc
// success
{ "ok": true, "data": { /* endpoint-specific */ } }
// failure
{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "…", "retryable": true } }
```

| Method & path           | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `POST /recommend`        | Core. Body = query + content-type scope. Returns grounded, explained recs. |
| `POST /sync`             | Push local outbox (watches, taste_signals, excludes); pull server delta.   |
| `GET  /catalog/resolve`  | Resolve a scraped title string → canonical TMDB id (fuzzy match).          |
| `DELETE /account/data`   | Hard-delete all of the user's server rows (watches, taste, excludes, threads, rate-limit, profile). |

> ⚠️ There is **no** `/feedback` endpoint in v1. "I liked X because Y" is captured as a
> `taste_signals` row written locally and pushed via `/sync` (one write path → no dup-id risk).

`/recommend` is the heart of the system; its full request/response schema, the RAG flow,
grounding rules, and prompt-cache layout are specified in
[`docs/05-recommendation-engine.md`](docs/05-recommendation-engine.md).

---

## 6. Extension (full detail in [`docs/04-extension.md`](docs/04-extension.md))

Highlights a builder must respect:

1. **Style isolation is mandatory.** All injected UI mounts inside a **Shadow DOM** root
   so Netflix's CSS can't touch us and ours can't touch them. ⚠️ Never append styled
   nodes to the page `<body>` directly.
2. **The adapter contract** (`SiteAdapter` interface) is the seam that keeps per-site
   fragility contained. Netflix is `NetflixAdapter` `v1`; a broken adapter MUST fail
   silently (no thrown errors into the page) and report a health ping.
3. **Scrobbling** reads progress from the player and emits a `WATCH_FINISHED` event at
   ≥ threshold. The exact Netflix DOM/heuristics, debouncing, and dedupe are in
   [`docs/04-extension.md#netflix-adapter`](docs/04-extension.md#netflix-adapter).
4. **Service worker is ephemeral** (MV3 kills it). All state lives in IndexedDB;
   nothing important is kept in SW memory. Messaging is typed via `packages/extension/src/messaging`.
5. **No `eval`, no remote code.** MV3 + our CSP forbid it; the LLM call is server-side anyway.

---

## 7. Recommendation engine (full detail in [`docs/05-recommendation-engine.md`](docs/05-recommendation-engine.md))

Pipeline for one `/recommend` call:

```
query + profile ──► embed query (OpenAI) ──► pgvector top-K candidates (cosine)
                                                   │
        de-dupe vs watches/excludes ──────────────┘
                                                   │
        assemble grounded prompt (cached system + profile, fresh candidates+query)
                                                   │
        Claude Haiku 4.5 ──► rank + write "why" + pick where-to-watch
                                                   │
        validate every returned id ∈ candidate set  ◄── 🔒 hard grounding gate
                                                   │
        server enrich (poster, providers/where-to-watch) ──► RecommendResponse
                                                   │
        client adapter fills playDeepLink for the CURRENT title only (post-response)
```

**Non-negotiables**
- 🔒 **Strict grounding:** the model may only return titles whose TMDB id was in the
  retrieved candidate set. Any hallucinated id is dropped server-side before responding.
- 🔒 **Prompt caching:** static system prompt + the user's taste profile are sent as
  cached blocks; only the query + candidate list are fresh per call. Target ≈ $0.005/convo
  **when the cache is warm** — for sporadic beta usage the 5-min cache TTL often lapses, so
  budget against the uncached ≈$0.005 figure and treat caching as upside (see [`docs/05 §4`](docs/05-recommendation-engine.md#4-cost-model-in-practice)).
- **`playDeepLink` is client-side only.** The server cannot map a TMDB id → a Netflix watch
  URL; only the page adapter can, and only for the title currently open. The server never
  returns a deep link; the client fills one in post-response for the current title.
- Boost titles available on the user's **subscriptions**; always attach a "why".

---

## 8. Cross-cutting requirements

| Concern        | Requirement (see linked sub-spec for detail)                                          |
| -------------- | -------------------------------------------------------------------------------------- |
| **Privacy**    | Local-first; explicit first-run consent; one-click export + delete; clear LLM disclosure. [`docs/06`](docs/06-security-privacy.md) |
| **Security**   | No secrets in bundle; RLS per user; least-privilege host perms (`netflix.com` only in v1); CORS locked. [`docs/06`](docs/06-security-privacy.md) |
| **Resilience** | Versioned adapters; every external call wrapped with timeout + retry + graceful degrade. [`docs/09`](docs/09-conventions.md) |
| **Performance**| Injected UI never blocks the player (idle-mount, `requestIdleCallback`); LLM calls async with skeleton states; embeddings cached. |
| **Cost**       | Haiku + prompt cache + small candidate sets (K=40 default, ≤60); per-user daily rate limit on `/recommend`. |
| **Observability** | Structured logs (no PII) in functions; client error ring-buffer; adapter health pings. [`docs/09`](docs/09-conventions.md) |
| **Accessibility** | Chat panel keyboard-navigable, ARIA-labelled, respects `prefers-reduced-motion`. |

---

## 9. QA & acceptance (full plan in [`docs/07-qa-test-plan.md`](docs/07-qa-test-plan.md))

Test pyramid: **unit (Vitest/Deno) → integration (functions against local Supabase) →
E2E (Playwright loading the unpacked extension on a Netflix fixture page)**. The Netflix
adapter is covered by **recorded-DOM fixture tests** so we don't depend on a live login in
CI. Every functional requirement (FR-1…FR-6) maps to numbered acceptance criteria with
Given/When/Then in the QA doc; a feature is not "done" until its ACs pass.

---

## 10. Work breakdown (full backlog in [`docs/08-work-breakdown.md`](docs/08-work-breakdown.md))

Sequenced into **6 epics** mapped to PRD phases. Each ticket has: description, the files it
touches, dependencies, a Definition of Done, and a difficulty tag (🟢 junior-friendly /
🟡 needs review / 🔴 senior-led) so a lead can assign by experience.

| Epic | Title                                   | PRD phase | Gate to next epic                          |
| ---- | --------------------------------------- | --------- | ------------------------------------------ |
| E0   | Foundations & scaffolding               | Phase 0   | CI green; local Supabase + extension load  |
| E1   | Catalog ingest → pgvector               | Phase 0   | `/recommend` returns real grounded titles  |
| E2   | Netflix capture (scrobbler + resolve)   | Phase 1   | Finishing a title creates a `watch` locally|
| E3   | Local store, taste profile & sync       | Phase 1   | Data survives SW restart and round-trips   |
| E4   | In-page chat UI + `/recommend` wired     | Phase 1   | End-to-end: chat → explained recs          |
| E5   | Settings, onboarding, export/delete     | Phase 1   | Privacy ACs pass; ready for beta           |
| E6   | "Watch next" nudge & cost tuning        | Phase 2   | Post-MVP                                    |

**Critical path (corrected):** `E0 → E1 → (E3-1 auth + E5-2 consent guard) → E4`. The
demoable recommender needs three things the naïve "E0→E1→E4" order hid: **authenticated**
calls (E3-1), the **consent gate** that must precede any LLM/data flow (E5-2, pulled
forward), and a profile — but the profile dep is **soft**: `/recommend` runs cold-start with
an **empty profile** (PRD UX principle), so E4 does not block on E3-6. Capture (E2) and full
sync (E3) follow. This corrected ordering is the authoritative one; see [`docs/08`](docs/08-work-breakdown.md).

---

## 11. Definition of Done (applies to every ticket)

A change is **Done** only when **all** are true:

1. Code typechecks under `strict` and passes ESLint/Prettier.
2. Unit tests for new logic; touched FRs' acceptance criteria pass.
3. No secret, key, or other user's data is reachable from the extension bundle.
4. External calls have timeout + error handling + a user-visible failure state.
5. Any new user-data store is **registered in the central export & delete manifest**
   (one list that the export builder and `DELETE /account/data` both iterate). Wiring the
   export/delete UI is E5, but registration is required at the time the store is added so
   the coverage can never silently lapse.
6. PR reviewed by someone other than the author (🔴 tickets: by a senior).
7. Docs updated if a contract in `packages/shared` or an API changed.

The full release checklist (store listing, privacy policy, key rotation, smoke test) is in
[`docs/08-work-breakdown.md#release-checklist`](docs/08-work-breakdown.md#release-checklist).

---

## 12. Risk register (top items)

| Risk                                              | Likelihood | Impact | Mitigation                                                        |
| ------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------- |
| Netflix changes player DOM → scrobbler breaks     | High       | Med    | Versioned adapter, fixture tests, health ping, graceful no-op     |
| LLM hallucinates a non-existent title             | Med        | High   | Hard server-side grounding gate (§7); never trust model ids       |
| Title-string → TMDB resolution is wrong/ambiguous | Med        | Med    | Fuzzy match + confidence score; low-confidence → don't record, ask|
| Cost overrun from heavy users                     | Low        | Med    | Per-user daily rate limit; prompt caching; K cap                  |
| Privacy mistake (PII in logs / leaked data)       | Low        | High   | No-PII logging rule, RLS, security review before beta (§9, §11)   |
| MV3 service-worker eviction loses in-flight state | Med        | Low    | All state in IndexedDB; outbox makes sync resumable               |
| In-extension email-OTP auth flow harder than hoped | Med       | Med    | Chose OTP code entry (no redirect) over magic-link; fully in-extension; fallback documented in [`docs/04`](docs/04-extension.md#auth) |
| CRXJS MV3 tooling immaturity (SW HMR / manifest)  | Med        | Low    | Pin version; keep a plain-Vite build escape hatch; CI builds the real bundle |

---

## 13. Out of scope for v1 (do not build)

Firefox, bring-your-own-key, non-Netflix adapters, multi-device real-time sync,
social/sharing, and "whole-show finished" detection beyond per-episode aggregation. These
are tracked in PRD §10 and will be re-specced when prioritized.
```
