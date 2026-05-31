# MovieFinder — Product Requirements Document (v1)

> **One-liner:** A browser extension that augments streaming sites with an in-page
> conversational AI which recommends movies & TV based on what you tell it and what
> it sees you finish watching.

- **Status:** Scope locked (v1) — engineering detail in [`SPEC.md`](SPEC.md)
- **Last updated:** 2026-05-30
- **Owner:** idanshaviner

> This PRD says **what** and **why**. The companion [`SPEC.md`](SPEC.md) (+ [`docs/`](docs/))
> says **how**, and is the source of truth for implementation detail. Where this PRD names a
> technology, the SPEC's §2 stack table is authoritative.

---

## 1. Product definition

MovieFinder is a **browser extension** (no separate web app). It injects a
conversational AI assistant directly into supported streaming sites. You talk to it
like a knowledgeable friend — _"I loved Inception, especially the layered reality and
the score — what else would I like?"_ — and it recommends similar movies and shows,
each with a **reason** and **where to watch it**.

It learns from two signals:

1. **Conversation** — what you explicitly tell it you liked/disliked, and _why_.
2. **Finished watches** — titles it observes you complete in-browser (played **≥90%**).

---

## 2. Locked decisions

| Dimension          | Decision                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| **Product form**   | Browser extension only; injected in-page chatbot is the primary UI       |
| **Ambition**       | Small product for friends/beta — accounts, per-user isolation, basic privacy |
| **Primary UX**     | Conversational chat in a **right-side docked panel that reshapes the page** (theme-aware; auto-collapses to the launcher in fullscreen playback); secondary "watch next" nudge |
| **Content**        | Movies **and** TV series                                                 |
| **MVP platform**   | Netflix only first; expand to other platforms if it succeeds             |
| **Watch capture**  | Three lanes → one pipeline: **live scrobble** (FR-1), **in-session Netflix history read** (FR-9, "Connect"), **CSV import** (FR-7). "finished" = **≥90% played** (configurable) |
| **LLM**            | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), prompt caching on system + profile |
| **Embeddings**     | **OpenAI `text-embedding-3-small`** (1536-dim) — single model, no mixing |
| **Vector search**  | pgvector on Supabase Postgres (cosine, `ivfflat`)                        |
| **Metadata**       | TMDB (catalog + posters + watch providers)                               |
| **Backend**        | **Supabase** Edge Functions (Deno) — the only backend we run; holds all API keys (chosen over bring-your-own-key) |
| **Auth**           | Supabase Auth, email OTP (6-digit, in-extension, one-time); **open sign-up**; email = identity |
| **Data storage**   | Local working copy in IndexedDB; durable cross-device copy in Supabase Postgres (RLS per user); non-real-time outbox sync |
| **Region**         | **Auto-detected per user** (overridable); international **multi-language** catalog |
| **Cost/abuse**     | Per-user daily caps **+ global monthly budget kill-switch** (graceful degradation) |
| **Observability**  | Anonymous aggregates + error monitoring (Sentry); **never** PII/content |
| **Distribution**   | Chrome Web Store **unlisted** (share-link + auto-update)                 |
| **Codebase**       | TypeScript (strict) pnpm monorepo; Preact + Vite + CRXJS extension       |
| **Browser**        | Manifest V3, Chromium-first (Chrome/Edge/Brave/Arc)                      |

---

## 3. Key constraints & honest caveats

These do not block the project but must shape expectations:

1. **No official watch-history APIs.** No streaming platform (Netflix, Hulu, Max,
   Disney+, Prime) exposes personal watch history or completion % to third parties, and
   Netflix shut down its public API in 2014. We therefore **never** call a Netflix API or
   handle Netflix credentials. The only "connection" is reading the user's **own** viewing
   activity from **their already-logged-in session, client-side** (FR-9) — plus live
   scrobbling (FR-1) and the CSV import (FR-7).
2. **Partial / best-effort history.** Live scrobbling sees only desktop-browser viewing. The
   FR-9 session read and FR-7 CSV both recover history from *any* device, but the session
   endpoint is unofficial (may break; may lack completion % for some items → those become
   weaker "watched" signals). Chat input ("name a few films you loved") covers any remaining gap
   and solves cold-start.
3. **"90% finished" is best-effort**, inferred from the web player's progress, not
   official platform data.
4. **No API keys in the bundle.** Shipping secrets in an extension is insecure, so the
   Supabase Edge Functions are the one unavoidable backend component — they hold every key
   and are the trust boundary; the extension is a thin, untrusted client.
5. **Per-site scrapers are fragile.** Streaming sites change their player DOM
   frequently → isolate each site behind a **versioned adapter**.

### "Finished" semantics

- **Movie** → finished when the film reaches ≥90%; counts as **one** taste item (weight 1.0).
- **TV** → finished at the **episode** level when an episode reaches ≥90%. Episodes then
  **roll up into a single weighted show item** so a binge can't drown out movies and one
  sampled episode isn't mistaken for devotion:
  - **Sampled** (1–2 episodes finished) → weight 0.3
  - **Engaged** (≥3 episodes finished) → weight 1.0 (≈ one finished movie)
  - **Completed** (≥80% of released episodes) → weight 1.5, and excluded from being
    recommended back
  - Explicit chat likes/dislikes override the derived tier. Exact formula:
    [`docs/05-recommendation-engine.md` §3.7](docs/05-recommendation-engine.md).

---

## 4. Functional requirements

### FR-1 Watch capture (in-browser scrobbling)
- Detect active playback on supported streaming web players (Netflix first).
- Track progress; mark a movie/episode **finished at ≥90%** (user-configurable).
- Resolve the watched title to a canonical TMDB ID + platform + timestamp.
- Store finished-watch history locally; allow user to **review, correct, delete**.

### FR-2 Taste profile
- Build a profile from finished watches **+** explicit chat feedback.
- Capture _what_ and _why_ (likes/dislikes with reasons).
- User can view/edit the profile and exclude already-watched titles.

### FR-3 Conversational recommender (core)
- In-page chatbot launcher + panel injected on streaming pages.
- Natural-language requests, including "I liked X because Y".
- **Acknowledge titles the user names even when they're not on the current platform.** If a
  user cites a liked movie that isn't on Netflix (or isn't yet in our catalog), recognize it,
  reflect it back, and use it as a taste seed — never dismiss it for being unavailable.
- Ground recommendations in profile + finished watches + live conversation.
- Each recommendation returns: poster, **why-recommended explanation**, and an
  **availability-aware action**:
  - **On the current platform →** a clickable link to that title on the platform
    (exact title page when known, platform search otherwise).
  - **Not on the current platform →** name where it *can* be watched (its providers); no play link.
- Support multi-turn refinement and graceful cold-start.
- Can scope by content type ("just movies tonight").

### FR-4 Recommendation engine
- TMDB metadata → **embeddings + vector similarity** for "similar to".
- **Claude RAG** layer for ranking + explanations, with **strict grounding** — only
  real, retrieved TMDB titles; never invent movies.
- De-dupe against finished titles.
- **Availability-aware, two-tier ranking:** retrieve platform-agnostically, then prioritize
  titles **available on the user's current platform**. Surface an off-platform title only when
  it's a meaningfully better match than the best on-platform option — and when doing so, the
  reply must **state that on-platform alternatives exist**. If nothing good is on-platform,
  recommend off-platform with clear where-to-watch rather than returning nothing.

### FR-5 In-page integration
- Inject UI without breaking the page; per-site enable/disable toggle.
- Optional end-of-title "watch next" nudge.

### FR-6 Settings & onboarding
- Select enabled sites; set completion threshold (default 90%); subscriptions; region (auto-
  detected, overridable).
- **Content filter:** adult titles are **always excluded**; an optional **family/kids mode**
  (default off) additionally filters out higher-maturity titles.
- Data management: view / **export (raw JSON, for portability)** / delete history and profile.
- Privacy-first first-run onboarding explaining what is captured; UI is **English-only in v1**
  (the chatbot still converses in the user's language).

### FR-7 Prior-history import (cold-start backfill)
- Optional onboarding step (and re-runnable from settings) to import the user's past
  viewing so the first recommendation isn't blind.
- **v1 source: Netflix privacy-export `ViewingActivity.csv`** (`netflix.com/account/getmyinfo`).
- Parse **entirely client-side** (raw CSV never uploaded; PII dropped); compute completion
  from `Bookmark` ÷ TMDB runtime; titles ≥90% become finished `watches` (`source='netflix_csv'`).
- Idempotent and convergent with live capture (shared deterministic watch id); low-confidence
  title matches go to a user review list, never recorded silently.
- Future lanes (same pipeline, deferred): Letterboxd/IMDb ratings CSV, browser-history scan.
- Full spec: [`docs/10-history-import.md`](docs/10-history-import.md).

### FR-8 CSV export (debugging & transparency)
- Export two human-readable CSVs from Settings: **`viewing-history.csv`** (title-enriched
  finished watches) and **`taste-profile.csv`** (the assembled per-title taste items with
  tier, weight, recency, and any explicit like/dislike override).
- Lets the user — and us, when debugging — see exactly *what the recommender thinks of them*
  and why a title does or doesn't influence recommendations.
- Powered by a read-only `GET /profile` endpoint (the taste profile is server-derived and not
  stored locally; local watches carry no titles). Returns only the caller's own data (RLS),
  consent-gated. Distinct from FR-6's raw JSON portability export.
- Full spec + column schemas: [`docs/11-data-export.md`](docs/11-data-export.md).

### FR-9 "Connect your Netflix" (in-session history read)
- One-tap cold-start: because the extension runs in the user's **already-logged-in Netflix
  tab**, it reads **the user's own viewing activity from that session** — client-side, **no
  Netflix API, no password, no credentials handled by us**.
- Delivers the user's **whole Netflix history at once** (including TV/mobile viewing the browser
  never sees) — the strongest cold-start. Completion % is honored when the session data carries
  it; otherwise the title is a weaker "watched" signal (still excluded from re-recommendation).
- 🔒 **Opt-in, off by default**, behind a one-time plain-language disclaimer (it's an
  unofficial method that could in theory be limited by Netflix). Per-profile, consent-gated,
  fails closed (versioned adapter). Shares FR-7's resolve → `watchId()` → outbox pipeline.
- Full spec: [`docs/12-netflix-session-import.md`](docs/12-netflix-session-import.md).

---

## 5. Non-functional requirements

- **Privacy & data ownership (top priority).** Local-first: IndexedDB is the working copy,
  with a durable per-user copy in Postgres protected by Row-Level Security. **Consent-gated** —
  no capture, chat/recommend, or sync happens before the user accepts consent at first run
  (auth is the only pre-consent backend call). Explicit consent; one-click export/delete;
  transparent that chat content goes to an LLM provider. Publish a privacy policy.
- **Security.** No secrets in the bundle; least-privilege host permissions (`netflix.com`
  only in v1); CORS locked to the extension origin; per-user RLS; keys live only in the
  Edge Functions.
- **Resilience.** Per-site adapter pattern, versioned, with graceful failure.
- **Performance.** In-page UI must never jank the player; async LLM calls with clear
  loading states; cache embeddings.
- **Cost control.** Prompt caching on static system prompt + taste profile; small
  retrieved candidate sets; Haiku-by-default. Target ≈ half a cent per conversation. Because
  sign-up is **open**, defense-in-depth on spend: per-user daily caps **and** a **global
  monthly budget kill-switch** that degrades recommendations gracefully ("we're at capacity")
  instead of running up an unbounded bill.
- **Observability (privacy-preserving).** Anonymous **aggregate** metrics (recs served, latency,
  error rates) + backend **error monitoring** (e.g. Sentry) — **never** titles, queries, emails,
  user ids, or IP-derived identity. Disclosed in the privacy policy. (This refines the earlier
  "no telemetry" stance: aggregates + crash tracking are allowed; PII/content is not.)
- **Localization / region.** Availability + where-to-watch use the user's **auto-detected
  region** (overridable in settings); the embedded catalog is **international, multi-language**
  popular + top-rated so non-US/non-English users get good matches. The **UI chrome is
  English-only in v1**; the chatbot itself converses in whatever language the user writes.
- **Compatibility.** Manifest V3, Chromium-first (Chrome/Edge/Brave/Arc); Firefox later.
- **Trust/accuracy.** Always show "why"; never recommend non-existent titles.

### Distribution & access (v1 beta)
- **Open sign-up** (anyone with an email; one-time OTP verification, persistent session).
- **Chrome Web Store, unlisted** (share-link install + auto-update); requires a published
  privacy policy and basic store assets.

---

## 6. UX principles

- **Unobtrusive** — augments, never blocks, the viewing experience; chat is user-invoked.
- **Conversational-first** — natural language, including "I liked X because Y".
- **Always explainable** — _"Because you finished Sicario and said you love tense,
  morally-gray thrillers."_
- **In-context & actionable** — every rec shows where to watch + a play link when possible.
- **Trust & control** — visible privacy posture, easy correction/deletion, opt-in per site.
- **Graceful cold-start** — fully usable from chat input alone before history exists.

### Key user flows
1. Install → onboard (enable Netflix, consent) → ready.
2. Passive capture → finish a movie/episode → optional "watch next" nudge.
3. Open chat → describe taste → explained recommendations with where-to-watch.
4. Refine over follow-up turns.
5. Manage data → review history, edit taste, export/delete anytime.

---

## 7. Architecture (summary — full detail in [`SPEC.md`](SPEC.md) + [`docs/01-architecture.md`](docs/01-architecture.md))

```
┌──────────────── Browser Extension (MV3, Preact) — UNTRUSTED ───────────────┐
│  Content script (per-site adapter)        Background service worker         │
│   • Netflix adapter: scrobble + inject     • Auth (email-OTP JWT)           │
│   • Injected chat UI + "watch next" nudge  • IndexedDB (local working copy) │
│                                            • Outbox sync engine             │
└───────────────────────────────────────┬────────────────────────────────────┘
                                         │ HTTPS (Bearer = Supabase JWT)
                          ┌──────────────▼───────────────┐
                          │  Supabase Edge Functions      │  ← TRUST BOUNDARY
                          │  /recommend /sync             │    (holds ANTHROPIC +
                          │  /catalog/resolve             │     OPENAI + TMDB keys)
                          │  /account/data (delete)       │
                          └──────┬───────────────┬─────────┘
                                 │               │
                  ┌──────────────▼──┐     ┌──────▼───────────┐
                  │ Supabase Postgres│     │ Claude Haiku 4.5  │
                  │ • pgvector catalog│     │ (+ prompt caching)│
                  │ • user data + RLS │     └──────────────────┘
                  └──────────▲────────┘
                             │ one-time + nightly
                  ┌──────────┴───────────┐
                  │ Catalog ingest job    │  TMDB → OpenAI embeddings → pgvector
                  └───────────────────────┘
```

**Two trust zones.** The extension is untrusted (it runs on a third-party page); the Edge
Functions are the trust boundary. No API key, no other user's data, and no recommendation
computation ever crosses into the extension.

**Source of truth & sync.** IndexedDB is the local working copy of the user's *raw* data
(finished watches, taste signals, excludes, settings); Postgres is the durable, cross-device
copy. A **non-real-time, last-write-wins outbox sync** keeps them aligned. The assembled
taste profile is **derived server-side at recommend time** (not stored on the client), and
recommendations are always computed server-side so grounding and keys stay server-side.

---

## 8. Cost model

- **One-time:** embed the international, multi-language TMDB catalog (~100–150K titles) →
  **~$0.30–$0.60 once** (ingest job aborts above `EMBED_COST_CEILING_USD`, default $3).
- **Per conversation:** ~3K input + ~600 output tokens on Haiku 4.5 ≈ **~$0.005**.
  ~$5 ≈ a thousand recommendation conversations. ⚠️ Budget against this **uncached** figure:
  the prompt cache has a ~5-min TTL, and sporadic beta usage will usually miss it — treat
  caching as upside, not a reliable halving.
- **Spend ceiling:** open sign-up is bounded by per-user daily caps **and** a global
  **`MONTHLY_BUDGET_USD` kill-switch (default $25)** that degrades to "at capacity" rather than
  running up the bill.
- **Vector search:** $0 per query (pgvector on Supabase Postgres).

---

## 9. Roadmap

- **Phase 0 — Foundations:** Supabase Edge Functions (keys + retrieval) + Postgres/pgvector
  + auth, TMDB catalog ingested into pgvector, MV3 extension skeleton.
- **Phase 1 — Beta 1 ("Core loop"):** Netflix capture (90% rule, movies + TV episodes) +
  **cold-start via "Connect your Netflix"** (FR-9, in-session read) **and the Netflix CSV
  import** (FR-7) → taste profile → in-page chat returning explained, availability-aware
  recommendations with where-to-watch. Consent, raw-JSON export, and one-click delete included.
  Exact in/out list: [`SPEC.md` §10 → docs/08 Beta-1 scope cut](SPEC.md).
- **Phase 2 — fast-follow:** **CSV debug export** (FR-8, `GET /profile`), "Watch next" nudge,
  taste-profile editing polish, prompt-cache cost tuning.
- **Phase 3:** Second platform adapter (e.g., Max or Prime), then scale out.

---

## 10. Open questions & out of scope for v1

**Resolved since v1 scoping:**
- _Cross-device history_ — decided: **non-real-time outbox sync is in v1** (durable Postgres
  copy with RLS). Real-time multi-device sync remains out of scope.

**Explicitly out of scope for v1** (tracked here, re-specced when prioritized — see [`SPEC.md`](SPEC.md) §13):
- Firefox support.
- Bring-your-own-key option for privacy-maximalist users.
- Non-Netflix **live** site adapters (one-time Netflix CSV import *is* in v1 — see FR-7).
- Additional cold-start import lanes: Letterboxd/IMDb tracker CSV, browser-history scan
  (`history` permission). Deferred; reuse the FR-7 pipeline.
- Google / YouTube Takeout as a source — **ruled out** (exports YouTube + search, not
  streaming watches; too noisy for film taste).
- Real-time multi-device sync.
- Social / sharing features.
- "Finished the whole show" detection beyond per-episode aggregation.
