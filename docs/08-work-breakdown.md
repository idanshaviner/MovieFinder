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

---

## Epic E1 — Catalog ingest → pgvector (PRD Phase 0)
**Gate:** `/recommend` (E4) can retrieve real grounded titles.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E1-0 | `watchId()` deterministic uuidv5 helper (shared) | `packages/shared/src/ids.ts` | E0-2 | 🟢 | Same natural key → same id; unit-tested (review B2) |
| E1-1 | Catalog + embeddings tables + ivfflat index (+ released_episode_count) | `migrations/0001_catalog.sql` | E0-6 | 🟡 | Schema from [`02 §1.1`](02-data-models.md); index created; show episode counts populated |
| E1-2 | TMDB client (search, details, providers) + rate-limit/backoff | `backend/.../_shared/tmdb.ts` | E0-7 | 🟡 | Fetches a known title; handles 429 with backoff |
| E1-3 | OpenAI embeddings client + batching | `_shared/openai.ts` | E0-7 | 🟡 | Embeds a batch; dim=1536 asserted |
| E1-4 | Ingest job: TMDB→source_text→embed→upsert→ANALYZE | `backend/jobs/catalog-ingest/*` | E1-1..3 | 🔴 | Idempotent; cost circuit-breaker; runs full curated set |
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

---

## Epic E3 — Local store, taste profile & sync (PRD Phase 1)
**Gate:** data survives SW restart and round-trips to the backend.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E3-1 | **(critical path)** Auth in SW: email **OTP** (`signInWithOtp`/`verifyOtp`) + session in `chrome.storage.session` | `background/auth.ts`, `onboarding.html` | E0-3 | 🔴 | OTP flow [`03 §5`](03-api-contracts.md#5-auth-email-otp-code--resolves-review-b4); token rules [`06 §3`](06-security-privacy.md#token-handling); refresh handled |
| E3-2 | User-data migrations + RLS (incl. `chat_threads`, `rate_limits`) | `migrations/0002,0003` | E0-6 | 🔴 | RLS isolation across all 6 user tables passes ([`07 §3`](07-qa-test-plan.md)) |
| E3-3 | `POST /sync` Edge Function (LWW upsert-by-id + delta pull incl. excludes) | `functions/sync/*` | E3-2,E1-0,E0-7 | 🔴 | Contract [`03 §2`](03-api-contracts.md#2-post-sync); idempotent; deterministic-id convergence (B2); excludes in serverChanges (M1) |
| E3-4 | Outbox + sync engine (debounce + `chrome.alarms`) | `background/sync.ts` | E0-5,E3-1,E3-3 | 🔴 | Drains outbox; applies serverChanges; advances cursor; resumes after eviction |
| E3-5 | Taste signal capture from chat ("liked X because Y") via **outbox/sync** (no `/feedback`) | `background/feedback.ts` (writes taste_signals + enqueues outbox) | E3-3 | 🟡 | Single write path (M8); flows via `/sync`; debounced immediacy |
| E3-6 | Taste profile assembly (bounded summary for prompt) | `_shared/profile.ts` | E1, E3-2 | 🔴 | ≤800 tok bounded; aggregates TV to show-level; empty-profile path valid |
| E3-7 | History & profile view (review/correct/delete/exclude) | `ui/HistoryView.tsx`, `ProfileView.tsx` | E3-3 | 🟡 | FR-1.4/FR-2.2 ACs; edits sync |

---

## Epic E4 — In-page chat + `/recommend` (PRD Phase 1) — **demoable milestone**
**Gate:** end-to-end chat → explained recommendations.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E4-1 | Anthropic client + prompt builder (cached blocks) | `_shared/anthropic.ts`, `prompt.ts` | E0-7 | 🔴 | Caching layout [`05 §3.2`](05-recommendation-engine.md#prompt-caching); JSON output contract |
| E4-2 | Retrieval query (pgvector top-K + scope + exclude) | `_shared/retrieve.ts` | E1-1 | 🟡 | SQL from [`05 §2`](05-recommendation-engine.md#2-retrieval); K configurable |
| E4-3 | Grounding gate + enrichment | `_shared/ground.ts` | E4-1,E4-2 | 🔴 | 0-tolerance drop of non-candidate ids; all-bad → no-match |
| E4-4 | `POST /recommend` Edge Function (full pipeline + multi-turn) | `functions/recommend/*` | E4-1..3, E3-1 (auth), E5-2 (consent guard); **soft:** E3-6 (empty profile OK) | 🔴 | Contract [`03 §1`](03-api-contracts.md#1-post-recommend-core); `chat_threads` persistence; timeout ladder; **server never sets playDeepLink** |
| E4-5 | Chat panel UI (launcher, messages, input, loading/skeletons) | `ui/Chat/*` | E0-3,E0-4 | 🟡 | a11y baseline [`09 §9`](09-conventions.md#9-accessibility--ux-baseline) |
| E4-6 | Recommendation card (poster, why, where-to-watch, play link) | `ui/RecCard.tsx` | E4-5 | 🟢 | Renders all fields; play link only when present |
| E4-7 | Wire chat → SW → `/recommend`; error/retry states | `ui/Chat`, `background`, `lib/apiClient.ts` | E4-4,E4-5 | 🟡 | Retryable errors show "Try again"; timeouts handled |
| E4-8 | Multi-turn refinement (threadId, context) | `functions/recommend`, `ui/Chat` | E4-4 | 🟡 | AC-3.5 passes |
| E4-9 | Per-user rate limiting on `/recommend` | `_shared/rateLimit.ts` usage | E0-7 | 🟢 | 429 over budget; friendly copy |

---

## Epic E5 — Settings, onboarding, privacy (PRD Phase 1) — **beta gate**
**Gate:** privacy ACs pass; security review signed off.

| # | Ticket | Files | Deps | Diff | DoD |
|---|--------|-------|------|------|-----|
| E5-1 | First-run onboarding (OTP sign-in + consent + LLM/at-rest disclosure + seed subscriptions) | `onboarding.html`, `ui/Onboarding/*` | E3-1 | 🟡 | AC-6.1; consentedAt set; discloses chat-at-rest |
| E5-2 | **(critical path)** `assertConsent()` guard across SW — capture/sync/recommend inert pre-consent (auth allowed) | `background/*` | E3-1 | 🔴 | E2E-2 passes; only auth calls pre-consent (m8) |
| E5-3 | Settings UI (enabled sites, **subscriptions**, threshold, region) | `ui/Settings/*` | E0-5 | 🟢 | AC-6.2; subscriptions editable (M7); persists + syncs |
| E5-4 | Data export (client-side JSON via `dataManifest`, incl. excludes) | `ui/Settings`, `store/dataManifest.ts` | E0-5 | 🟢 | AC-6.3; iterates manifest (M1/M10) |
| E5-5 | `DELETE /account/data` fn + UI (local clear + server hard-delete all 6 tables) | `functions/account-delete/*`, `ui/Settings` | E3-2 | 🔴 | Contract [`03 §4`](03-api-contracts.md#4-delete-accountdata); AC-6.4 verified rows gone (M11) |
| E5-6 | Privacy policy page + store listing copy | `docs/privacy-policy.md`, listing | — | 🟢 | Linked from onboarding |
| E5-7 | Security review gate execution | checklist [`06 §9`](06-security-privacy.md#9-security-review-gate) | all | 🔴 | All boxes checked |
| E5-8 | Golden-set rec eval + run | `backend/jobs/eval/*` | E4 | 🟡 | 0 hallucinated/watched titles |

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
