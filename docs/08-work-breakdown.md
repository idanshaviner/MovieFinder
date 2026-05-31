# 08 — Work Breakdown Structure

> Parent: [`../SPEC.md`](../SPEC.md). Epics → tickets, each with files touched, dependencies,
> a Definition of Done, and a difficulty tag so a lead can assign by experience:
> 🟢 junior-friendly · 🟡 needs review · 🔴 senior-led.

**Build order (critical path — corrected per review B5):**
`E0 → E1 → (E3-1 auth + E5-2 consent guard, pulled forward) → E4`.
The "demoable recommender before capture" goal is real, but `/recommend` is **authenticated**
and gated by **consent**, so a minimal slice of E3 (auth) and E5 (the consent guard) must come
*before* E4 — not after. The taste-**profile** dependency (E3-6), by contrast, is **soft**:
`/recommend` runs cold-start against an **empty profile**, so E4 does not block on E3-6. Build
order is therefore: **E0 → E1 → E3-1 → E5-2 → E4**, then E2 (capture) → rest of E3 (sync,
profile, history) → rest of E5 → E6. Dependencies in the tables below reflect this.

Every ticket also inherits the global DoD (SPEC §11). Below, "DoD" lists ticket-specific
acceptance on top of that.

### 🎯 Beta 1 scope cut — "Core loop" (what we ship to friends FIRST) {#beta-1-scope}
Owner decision: ship the core loop first, fast-follow the rest. **In Beta 1:**
- **In:** E0 (all) · E1 (catalog) · E2 (live capture) · E2-10/E5-9b (**Connect your Netflix**) ·
  E5-9/E5-9a (**CSV import**) · E3-1..E3-6 (auth, sync, profile) · E4-1..E4-9 (**chat + recs**,
  incl. availability links, budget guard) · E3-8 (region) · E5-1/E5-2 (onboarding + consent) ·
  E5-3 (settings incl. family mode + Connect opt-in) · E5-4 (**raw JSON export**) · E5-5
  (**delete**) · E5-6/E5-7/E5-8 (policy, security gate, eval) · E0-10/E0-11 (budget, telemetry).
- **Fast-follow (deferred, not in first beta):** E3-7 profile-editing polish · **FR-8** CSV
  debug export (E5-10 `GET /profile`, E5-11) · **E6** entirely ("watch next" nudge, cost tuning,
  profile summariser).
- **Beta-1 gate:** a friend can install (unlisted), verify email, optionally Connect/Import,
  chat, and get explained recommendations with working "Watch on Netflix" / where-to-watch —
  with consent, delete, and the $25 budget guard all live.

---

## Epic E0 — Foundations & scaffolding (PRD Phase 0)
**Gate to next epic:** CI green; `pnpm dev` loads the unpacked extension; local Supabase up.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E0-1 | Monorepo + pnpm workspace + tsconfig base | root, `pnpm-workspace.yaml`, `tsconfig.base.json` | — | 🟡 | `pnpm i` works; shared/extension/backend packages resolve |
| E0-2 | `@moviefinder/shared`: types + zod schemas + constants | `packages/shared/src/*` | E0-1 | 🟡 | Every DTO in [`02`](02-data-models.md) has a type + matching zod schema; unit test proves parse/reject |
| E0-3 | Extension skeleton: Vite + CRXJS + MV3 manifest + Preact mount | `packages/extension/*` | E0-1 | 🔴 | Loads on `netflix.com`, mounts a Shadow-DOM "hello" island, no page CSS bleed |
| E0-4 | Typed message bus (content ↔ SW) | `extension/src/messaging/*` | E0-3 | 🟡 | Exhaustive switch; round-trips a test message; validated with zod |
| E0-5 | IndexedDB schema + repositories | `extension/src/store/*` | E0-2 | 🟡 | CRUD + survives SW restart; repos are the only DB access |
| E0-6 | Supabase project + local dev + migrations runner | `packages/backend/supabase/*` | E0-1 | 🔴 | `supabase start` works; migrations apply; seed loads |
| E0-7 | Edge Function harness: `_shared` (cors, auth, envelope, rateLimit, withRetry) | `backend/.../functions/_shared/*` | E0-6 | 🔴 | A hello function returns the envelope; 401 without JWT; CORS locked |
| E0-8 | CI pipeline (lint→typecheck→test→build→secret-scan) | `.github/workflows/ci.yml` | E0-1 | 🟡 | Red on lint/type/test failure; secret scan over ext build |
| E0-9 | ESLint/Prettier shared config + conventions | root configs | E0-1 | 🟢 | `pnpm lint` enforces [`09`](09-conventions.md) |
| E0-10 | **Operational-tables migration** (`rate_limits` + `cost_ledger`) + budget guard + `AT_CAPACITY` | `_shared/budget.ts`, `_shared/rateLimit.ts`, `migrations`, `_shared/metrics.ts` | E0-7 | 🔴 | [`09 §13`](09-conventions.md#13-cost--budget-guard); these infra tables exist **before** the harness rate-limiter/budget check are exercised; ≥100% → graceful `AT_CAPACITY`; fail-safe-allow |
| E0-11 | Telemetry: anonymous aggregate metrics + Sentry (no-PII, `beforeSend` redactor) | `_shared/metrics.ts`, function init | E0-7 | 🟡 | [`06 §6`](06-security-privacy.md#no-pii); no titles/queries/ids/IP; DSN is a secret |
| E0-12 | **Provision accounts + secrets** (nothing exists yet): Anthropic, OpenAI, TMDB, Supabase, Sentry, a domain for the policy; set via `supabase secrets set` | ops runbook | — | 🟡 | All keys in Edge Function env only; documented rotation; none in the bundle |

---

## Epic E1 — Catalog ingest → pgvector (PRD Phase 0)
**Gate:** `/recommend` (E4) can retrieve real grounded titles.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E1-0 | `watchId()` deterministic uuidv5 helper (shared) | `packages/shared/src/ids.ts` | E0-2 | 🟢 | Same natural key → same id; unit-tested (review B2) |
| E1-1 | Catalog + embeddings tables + ivfflat index (+ released_episode_count) | `migrations/0001_catalog.sql` | E0-6 | 🟡 | Schema from [`02 §1.1`](02-data-models.md); index created; show episode counts populated |
| E1-2 | TMDB client (search, details, providers) + rate-limit/backoff | `backend/.../_shared/tmdb.ts` | E0-7 | 🟡 | Fetches a known title; handles 429 with backoff |
| E1-3 | OpenAI embeddings client + batching | `_shared/openai.ts` | E0-7 | 🟡 | Embeds a batch; dim=1536 asserted |
| E1-4 | Ingest job: TMDB→source_text→embed→upsert→ANALYZE — **multi-language/international** set | `backend/jobs/catalog-ingest/*` | E1-1..3 | 🔴 | [`05 §1.1`](05-recommendation-engine.md#1-catalog-ingest-epic-e1); per-language+region discover, dedup; idempotent; cost circuit-breaker |
| E1-5 | Nightly incremental + provider refresh schedule | job + cron config | E1-4 | 🟡 | New titles + providers update without full re-embed |
| E1-6 | Title resolution module (scoring + lazy insert) | `_shared/resolve.ts` | E1-1..4 | 🔴 | Scoring per [`05 §5`](05-recommendation-engine.md#title-resolution); unit-tested thresholds |

---

## Epic E2 — Netflix capture (PRD Phase 1)
**Gate:** finishing a title on Netflix creates a local `watch` with the right TMDB id.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E2-1 | `SiteAdapter` interface + registry + activeAdapter() | `extension/src/adapters/types.ts`, `index.ts` | E0-3 | 🟡 | Contract from [`04 §5`](04-extension.md#5-site-adapter-contract-the-fragility-firewall) |
| E2-2 | Netflix adapter: detect player + read progress (throttled) | `adapters/netflix/*` | E2-1 | 🔴 | Reads `currentTime/duration`; visible+playing only; ≤1/5s |
| E2-3 | Netflix title/season/episode parsing (selectors w/ fallbacks) | `adapters/netflix/selectors.ts` | E2-2 | 🟡 | Parses `Show • S1:E3` shapes; falls back to document.title |
| E2-4 | Finish detection (threshold + 3s stability + dedupe + re-arm) | `adapters/netflix/scrobbler.ts` | E2-2 | 🔴 | Fires once/title; re-arms on video id change; ignores scrub |
| E2-5 | `GET /catalog/resolve` Edge Function | `functions/catalog-resolve/*` | E1-6, E0-7 | 🟡 | Contract [`03 §3`](03-api-contracts.md#3-get-catalogresolve); 404 on miss |
| E2-6 | SW capture handler: resolve → confidence gate → write watch | `background/captureHandler.ts` | E2-4,E2-5,E0-5 | 🟡 | <0.6 → confirm UI; ≥0.6 → store + enqueue outbox |
| E2-7 | Low-confidence confirm UI | `ui/ConfirmWatch.tsx` | E2-6 | 🟢 | "Did you finish X?" confirm/skip; no silent wrong record |
| E2-8 | Adapter fixture tests + health ping | `adapters/netflix/__fixtures__/*`, tests | E2-2..4 | 🟡 | Tests in [`07 §4`](07-qa-test-plan.md#adapter-tests); graceful-fail covered |
| E2-9 | `buildPlayDeepLink` (current-title only in v1) | `adapters/netflix/*` | E2-2 | 🟢 | Returns link for known siteVideoId, null otherwise |
| E2-10 | **Netflix session read (FR-9)**: `readViewingActivity()` paged + fixtures + fail-closed | `adapters/netflix/session.ts`, `__fixtures__/*` | E2-1 | 🔴 | [`12`](12-netflix-session-import.md); reads logged-in session client-side; no creds leave; health ping on shape change |

---

## Epic E3 — Local store, taste profile & sync (PRD Phase 1)
**Gate:** data survives SW restart and round-trips to the backend.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E3-1 | **(critical path)** Auth in SW: email **OTP** (`signInWithOtp`/`verifyOtp`) + session in `chrome.storage.session` | `background/auth.ts`, `onboarding.html` | E0-3 | 🔴 | OTP flow [`03 §5`](03-api-contracts.md#5-auth-email-otp-code--resolves-review-b4); token rules [`06 §3`](06-security-privacy.md#token-handling); refresh handled |
| E3-2 | User-feature migrations + RLS (`profiles`, `watches`, `taste_signals`, `excluded_titles`, `chat_threads`; `rate_limits` RLS) — note `rate_limits`/`cost_ledger` tables are created earlier in E0-10 | `migrations/0002,0003` | E0-6, E0-10 | 🔴 | RLS isolation across all 6 user tables passes ([`07 §3`](07-qa-test-plan.md)) |
| E3-3 | `POST /sync` Edge Function (LWW upsert-by-id + delta pull incl. excludes + **settings↔profiles** + default-profile create) | `functions/sync/*` | E3-2,E1-0,E0-7 | 🔴 | Contract [`03 §2`](03-api-contracts.md#2-post-sync); idempotent; deterministic-id convergence (B2); excludes in serverChanges (M1); settings upsert profiles (LWW) |
| E3-4 | Outbox + sync engine (debounce + `chrome.alarms`) | `background/sync.ts` | E0-5,E3-1,E3-3 | 🔴 | Drains outbox; applies serverChanges; advances cursor; resumes after eviction |
| E3-5 | Taste signal capture from chat ("liked X because Y") via **outbox/sync** (no `/feedback`) | `background/feedback.ts` (writes taste_signals + enqueues outbox) | E3-3 | 🟡 | Single write path (M8); flows via `/sync`; debounced immediacy |
| E3-6 | Taste profile assembly (bounded summary for prompt) | `_shared/profile.ts` | E1, E3-2 | 🔴 | ≤800 tok bounded; aggregates TV to show-level; empty-profile path valid |
| E3-7 | History & profile view (review/correct/delete/exclude) | `ui/HistoryView.tsx`, `ProfileView.tsx` | E3-3 | 🟡 | FR-1.4/FR-2.2 ACs; edits sync |
| E3-8 | Region auto-detect (client locale → server IP fallback) + settings override | `background/region.ts`, `_shared/region.ts`, `ui/Settings` | E3-1 | 🟡 | sets `profiles.region`/`region_source`; used by availability ([`05 §2.5`](05-recommendation-engine.md#25-availability-aware-two-tier-ranking-fr-4)) |

---

## Epic E4 — In-page chat + `/recommend` (PRD Phase 1) — **demoable milestone**
**Gate:** end-to-end chat → explained recommendations.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E4-1 | Anthropic client + prompt builder (cached blocks + onPlatform flags + acknowledgment/two-tier rules) | `_shared/anthropic.ts`, `prompt.ts` | E0-7 | 🔴 | Caching layout [`05 §3.2`](05-recommendation-engine.md#prompt-caching); JSON output contract; FR-3/FR-4 rules in cached system block |
| E4-2 | Retrieval (pgvector): **global top-K ∪ platform-filtered top-M** union, scope + exclude + **adult/family filter** | `_shared/retrieve.ts` | E1-1, E4-2a | 🟡 | SQL from [`05 §2`](05-recommendation-engine.md#2-retrieval)/[`§2.5`](05-recommendation-engine.md#25-availability-aware-two-tier-ranking-fr-4); adult always excluded; family mode applies maturity threshold; union dedup ≤60 |
| E4-2a | Provider normalization map (TMDB name ↔ canonical ↔ siteId) | `_shared/providers.ts` | E1-2 | 🟢 | review m4; unit-tested; used by availability + boost |
| E4-3 | Grounding gate + **availability two-tier ranking** + enrichment (onCurrentPlatform, whereToWatch, currentPlatformUrl hybrid) | `_shared/ground.ts`, `_shared/availability.ts` | E4-1,E4-2,E4-2a | 🔴 | 0-tolerance drop; [`05 §2.5`](05-recommendation-engine.md#25-availability-aware-two-tier-ranking-fr-4) δ-margin + caps; exact-vs-search link; **server never sets playDeepLink** |
| E4-4 | `POST /recommend` Edge Function (full pipeline + multi-turn) | `functions/recommend/*` | E4-1..3, E3-1 (auth), E5-2 (consent guard); **soft:** E3-6 (empty profile OK) | 🔴 | Contract [`03 §1`](03-api-contracts.md#1-post-recommend-core); `chat_threads` persistence; timeout ladder; availability fields server-authoritative |
| E4-5 | Chat panel UI: **right-side layout-pushing dock**, theme-aware (light/dark), **fullscreen auto-collapse**, launcher tab, messages, input, skeletons | `ui/Chat/*`, `content/dock.ts` | E0-3,E0-4 | 🔴 | [`04 §4`](04-extension.md#4-ui-mounting-shadow-dom--preact); reshapes page via owned margin; a11y [`09 §9`](09-conventions.md#9-accessibility--ux-baseline); AC-5.1/5.3 |
| E4-6 | Recommendation card: poster, why, **"Watch on Netflix" link when onCurrentPlatform**, else **where-to-watch text only**; client play-link upgrade for current title | `ui/RecCard.tsx` | E4-5, E2-9 | 🟡 | AC-3.6/3.6a–e; off-platform shows no link; uses `currentPlatformUrl`/`playDeepLink` |
| E4-6a | `POST /catalog/platform-link` fn + adapter reporting of `tmdbId↔siteVideoId` | `functions/catalog-platform-link/*`, `adapters/netflix/*` | E1-6, E2-2 | 🟡 | Contract [`03 §3b`](03-api-contracts.md#3b-post-catalogplatform-link-organic-exact-link-learning--fr-3); catalog-only write; best-effort; AC-3.6e |
| E4-7 | Wire chat → SW → `/recommend`; error/retry states | `ui/Chat`, `background`, `lib/apiClient.ts` | E4-4,E4-5 | 🟡 | Retryable errors show "Try again"; timeouts handled |
| E4-8 | Multi-turn refinement (threadId, context) | `functions/recommend`, `ui/Chat` | E4-4 | 🟡 | AC-3.5 passes |
| E4-9 | Per-user rate limiting + budget gate on `/recommend` | `_shared/rateLimit.ts`, `_shared/budget.ts` usage | E0-10 | 🟢 | `RATE_LIMITED` over per-user cap; `AT_CAPACITY` over monthly budget; friendly copy |

---

## Epic E5 — Settings, onboarding, privacy (PRD Phase 1) — **beta gate**
**Gate:** privacy ACs pass; security review signed off.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E5-1 | First-run onboarding (OTP sign-in + consent + LLM/at-rest disclosure + detect region + seed subscriptions + **push initial settings via /sync**) | `onboarding.html`, `ui/Onboarding/*` | E3-1, E3-3, E3-8 | 🟡 | AC-6.1; consentedAt set; discloses chat-at-rest; profile row populated server-side before first recommend |
| E5-2 | **(critical path)** `assertConsent()` guard across SW — capture/sync/recommend inert pre-consent (auth allowed) | `background/*` | E3-1 | 🔴 | E2E-2 passes; only auth calls pre-consent (m8) |
| E5-3 | Settings UI (enabled sites, **subscriptions**, threshold, region override, **family mode**, **Connect opt-in**) | `ui/Settings/*` | E0-5 | 🟢 | AC-6.2 + AC-X.2/X.4; family mode + region override persist & sync; Connect toggle gated by disclaimer |
| E5-4 | Data export (client-side JSON via `dataManifest`, incl. excludes) | `ui/Settings`, `store/dataManifest.ts` | E0-5 | 🟢 | AC-6.3; iterates manifest (M1/M10) |
| E5-5 | `DELETE /account/data` fn + UI (local clear + server hard-delete all 6 tables) | `functions/account-delete/*`, `ui/Settings` | E3-2 | 🔴 | Contract [`03 §4`](03-api-contracts.md#4-delete-accountdata); AC-6.4 verified rows gone (M11) |
| E5-6 | Finalize + **host** privacy policy & store listing (drafts exist) | [`docs/privacy-policy.md`](privacy-policy.md), [`docs/store-listing.md`](store-listing.md) | — | 🟢 | Legal review; fill `<…>`; host policy URL; linked from onboarding + store |
| E5-7 | Security review gate execution | checklist [`06 §9`](06-security-privacy.md#9-security-review-gate) | all | 🔴 | All boxes checked |
| E5-8 | Golden-set rec eval + run | `backend/jobs/eval/*` | E4 | 🟡 | 0 hallucinated/watched titles |
| E5-9a | **`POST /catalog/resolve-batch` fn (FR-7/R4)** — ≤100 items/req, bounded concurrency, lazy-insert, `ref` echo | `functions/catalog-resolve-batch/*` | E1-6, E0-7 | 🟡 | Contract [`03 §3a`](03-api-contracts.md#3a-post-catalogresolve-batch-bulk-import--resolves-review-r4); reuses resolve scoring; partial-success (null on miss); own rate limit |
| E5-9 | **Netflix CSV import (FR-7)**: client-side parse → dedupe → **batch** resolve → `watchId()` upsert → outbox; review list for low-confidence | `ui/Import/*`, `lib/netflixCsv.ts`, `store/*` | E5-9a, E2 (resolve), E3 | 🟡 | [`10`](10-history-import.md) AC-7.1–7.5; idempotent; PII dropped; raw CSV never uploaded; progress + resumable |
| E5-9b | **"Connect your Netflix" (FR-9)**: drive `readViewingActivity()` → batch resolve → `completion_known` → outbox; onboarding + Settings entry; review list; calm fallback | `ui/Connect/*`, `background/sessionImport.ts` | E2-10, E5-9a, E3 | 🔴 | [`12`](12-netflix-session-import.md) AC-9.1–9.5; honest copy; no creds/raw payload leave; consent-gated |
| E5-10 | **`GET /profile` fn (FR-8)** — assemble `TasteProfile.items` (tiers/weights, [`05 §3.7`](05-recommendation-engine.md#37-tv-aggregation-episodes--one-weighted-show-item-)) + title-enriched history | `functions/profile/*` | E4, E3-6 | 🟡 | Contract [`03 §6`](03-api-contracts.md#6-get-profile--debug--export--fr-8); RLS: only caller's rows; no LLM/embeddings |
| E5-11 | **CSV debug export UI (FR-8)** — `viewing-history.csv` + `taste-profile.csv` from `/profile` | `ui/Settings`, `lib/csv.ts` | E5-10 | 🟢 | [`11`](11-data-export.md) AC-8.1–8.3; RFC-4180 quoting |

---

## Epic E6 — "Watch next" nudge & cost tuning (PRD Phase 2)
| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E6-1 | End-of-title "watch next" nudge (uses /recommend) | `ui/Nudge.tsx`, adapter `ended` hook | E2,E4 | 🟡 | Unobtrusive; dismissible; FR-5 |
| E6-2 | Prompt-cache cost tuning + token dashboards | `_shared/anthropic`, logs | E4 | 🟡 | Measured cost ≈ target; cache-hit logged |
| E6-3 | Profile summarisation job (keep prompt bounded) | `backend/jobs/profile-summarise` | E3-6 | 🟡 | Long profiles stay ≤ cap |

---

## Release checklist {#release-checklist}

Before publishing the extension (beta):
- [ ] All FR acceptance criteria green ([`07 §6`](07-qa-test-plan.md#6-acceptance-criteria-by-functional-requirement)); 0 S1, 0 known S2.
- [ ] Security gate signed ([`06 §9`](06-security-privacy.md#9-security-review-gate)).
- [ ] Secret scan over the final bundle: clean.
- [ ] Catalog ingested + nightly job scheduled and verified.
- [ ] Edge Functions deployed; secrets set via `supabase secrets set`; CORS allowlist = the
      published extension id.
- [ ] Rate limits + cost circuit-breaker enabled.
- [ ] Privacy policy live and linked from onboarding + store listing.
- [ ] Manual smoke on real Netflix passed ([`07 §7`](07-qa-test-plan.md#7-pre-release-manual-smoke-checklist)).
- [ ] Key rotation runbook documented (how to rotate Anthropic/OpenAI/TMDB/Supabase keys
      without downtime: set new secret → redeploy functions → revoke old).
- [ ] Version tagged; pinned function set + migration list recorded in the release notes.

## Effort signal (planning only, not a commitment)
Roughly: E0 ≈ 1–1.5 wk, E1 ≈ 1 wk, E2 ≈ 1.5 wk, E3 ≈ 1.5 wk, E4 ≈ 1.5–2 wk, E5 ≈ 1 wk for a
small team building in the critical-path order. 🔴 tickets should be paired or senior-led.
