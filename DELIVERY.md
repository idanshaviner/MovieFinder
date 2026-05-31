# MovieFinder — Delivery Tracker & Milestone Matrix

> The single **living** view of delivery: milestones, gates, status, evidence, blockers, and the
> critical path. Ticket detail lives in [`docs/08-work-breakdown.md`](docs/08-work-breakdown.md);
> this doc rolls it up to milestones and tracks *actual* status. **Update on every merge.**

- **Branch:** `spec/v1-baseline` · **Last updated:** 2026-05-31
- **Release target:** Beta 1 = "Core loop" ([`SPEC.md` §10](SPEC.md) → [Beta-1 scope](docs/08-work-breakdown.md#beta-1-scope))

### Status legend
✅ done & verified · 🟢 in progress · 🟡 partial / stubbed · ⛔ blocked · ⬜ not started

### Snapshot (where we are right now)
- **M0 Foundations: ~95%** — all code green, verified; blocked only on account provisioning (E0-12).
- **M1 Catalog: started** — TMDB client, OpenAI embeddings client, and the ingest job are built
  and `deno check`-clean; `deno task ingest` is ready to run the moment keys land.
- Whole stack builds: `lint · typecheck · 16 tests · build · deno check (all functions + job)` green;
  **all 4 migrations apply on real Postgres 16 + pgvector** (9 tables, 6 RLS policies, ivfflat index).
- **Next unblock is yours:** provision Supabase + TMDB/OpenAI/Anthropic keys → run ingest → M1 gate.

---

## 1. Milestone matrix

| ID | Milestone | Exit gate (binary, measurable) | FRs | Depends on | Owner | Effort | Status |
| -- | --------- | ------------------------------ | --- | ---------- | ----- | ------ | ------ |
| **M0** | Foundations | CI green (lint/type/test/build/deno/migrations); extension loads; migrations apply | infra | — | Eng | ~1.5 wk | ✅ code / ⛔ E0-12 |
| **M1** | Backend live + Catalog | Migrations deployed to Supabase; catalog ingested; `/recommend` returns **real grounded** titles from pgvector | FR-4 | M0, **E0-12** | Eng + **You** | ~1 wk | ⛔ (accounts) |
| **M2** | Capture + cold-start | Finishing a title (scrobble) **and** Connect/CSV import create converging `watches`; `/sync` round-trips incl. settings | FR-1, FR-7, FR-9 | M1 | Eng | ~2 wk | ⬜ |
| **M3** | Recommender E2E | Chat → grounded, **availability-aware** recs with "Watch on Netflix"/where-to-watch; multi-turn; budget guard live | FR-2, FR-3, FR-4 | M1 (soft M2) | Eng | ~2 wk | ⬜ |
| **M4** | Privacy & settings | Onboarding + consent gate; settings (region/family/Connect opt-in); export + delete; telemetry no-PII | FR-5, FR-6 | M3 | Eng | ~1 wk | ⬜ |
| **M5** | **Beta-1 release** | Release checklist ✓; CWS unlisted; privacy policy hosted; smoke + golden-set eval pass; **0 S1 bugs** | all v1 core | M2, M3, M4 | Eng + **You** | ~0.5 wk | ⬜ |
| **M6** | Fast-follow | FR-8 CSV export; "watch next" nudge; profile-edit polish; cost tuning | FR-8 | M5 | Eng | ~1.5 wk | ⬜ (post-beta) |

> **Critical path:** `M0 → E0-12 → M1 → M3 → M4 → M5`. M2 parallels M3 (M3 cold-starts on an empty
> profile, so it doesn't hard-block on capture). Effort = engineer-weeks for a small team building
> in [`docs/08`](docs/08-work-breakdown.md) order; calendar dates set at kickoff once team size is known.

---

## 2. Milestone exit gates (the checklists)

A milestone is **Done** only when every box is checked. These are the acceptance gates.

### M0 — Foundations
- [x] pnpm monorepo + strict TS; `@moviefinder/shared` (types/zod/ids/constants)
- [x] Extension builds (CRXJS) into a loadable MV3 bundle; Shadow-DOM dock mounts
- [x] Edge Function harness `deno check`-clean; migrations apply on PG+pgvector
- [x] CI: build · deno-check · migrations · gitleaks
- [ ] **E0-12 accounts provisioned** (Supabase + TMDB + OpenAI + Anthropic) ⛔
- [ ] `metrics.ts` + Sentry init (E0-11) — needs DSN 🟡

### M1 — Backend live + Catalog
- [ ] `supabase link` + migrations pushed to the cloud project
- [ ] Secrets set via `supabase secrets set` (no key in any bundle — gitleaks ✓)
- [ ] Catalog ingest run: ≥ ~100K multi-language titles embedded; `ANALYZE` done; `ivfflat` tuned
- [ ] `/recommend` deployed; returns ≥1 **grounded** title (id ∈ retrieved candidates) — **AC-3.2 = 0 hallucinations**
- [ ] Nightly incremental + provider refresh scheduled

### M2 — Capture + cold-start
- [ ] Netflix scrobbler: finishing a movie/episode stores one `watch` (AC-1.1/1.2); fixtures in CI
- [ ] "Connect your Netflix" (opt-in + disclaimer) imports session history (AC-9.1–9.5)
- [ ] CSV import via batch-resolve (AC-7.1–7.5)
- [ ] Three lanes converge on deterministic `watchId`; completion is **sticky** (AC-9.3)
- [ ] `/sync` round-trips watches/taste/excludes **+ settings→profiles**; survives SW eviction

### M3 — Recommender end-to-end
- [ ] Chat dock → `/recommend` → explained recs (AC-3.1) with a why tied to the user's words
- [ ] Availability-aware two-tier ordering; on-platform link (exact/search), off-platform = text (AC-3.6/3.6b)
- [ ] De-dupe vs watched/excluded = 0 tolerance (AC-3.3); scope filter (AC-3.4); multi-turn (AC-3.5)
- [ ] Off-platform seed acknowledged (AC-3.6c); honest no-match path (AC-3.7)
- [ ] Per-user caps + **$25 global budget kill-switch** → graceful `AT_CAPACITY` (AC-X.1)

### M4 — Privacy & settings
- [ ] Onboarding: OTP sign-in + consent + LLM/at-rest disclosure (AC-6.1); **consent gate** blocks all pre-consent flows (E2E-2)
- [ ] Settings: region override, family mode, Connect opt-in (AC-6.2/X.2/X.4/X.5/X.6)
- [ ] Export (raw JSON) (AC-6.3); **Delete** purges all 6 user tables + local (AC-6.4)
- [ ] Telemetry: aggregates + Sentry carry **no** titles/queries/PII (AC-X.3)
- [ ] Security review gate signed ([`docs/06 §9`](docs/06-security-privacy.md#9-security-review-gate))

### M5 — Beta-1 release
- [ ] All M2–M4 ACs green; **0 S1, 0 known S2** ([`docs/07 §8`](docs/07-qa-test-plan.md))
- [ ] Manual smoke on real Netflix ✓; golden-set rec eval ✓ (0 hallucinated/watched)
- [ ] Privacy policy hosted + linked; CWS unlisted listing submitted & approved
- [ ] Secrets rotation runbook; release tagged; function set + migration list recorded

---

## 3. Epic status board (rollup)

| Epic | Milestone | Status | Notes |
| ---- | --------- | ------ | ----- |
| E0 Foundations | M0 | ✅ 95% | code complete + verified; E0-12 (accounts) + E0-11 (Sentry) outstanding |
| E1 Catalog ingest | M1 | 🟡 | TMDB + OpenAI clients + ingest job **built & deno-checked**; `watchId` (E1-0) ✅; resolution (E1-6) + nightly (E1-5) pending; **run** blocked on keys |
| E2 Netflix capture | M2 | ⬜ | adapter contract + scrobbler + session read + fixtures |
| E3 Store/profile/sync | M2/M3 | 🟡 | IndexedDB + watchRepo ✅ (E0-5); auth/sync/profile pending |
| E4 Chat + /recommend | M3 | 🟡 | dock UI shell ✅ (E0-3); retrieval/RAG/ranking pending |
| E5 Settings/onboarding/privacy | M4 | ⬜ | — |
| E6 Nudge + tuning | M6 | ⬜ | post-beta |

---

## 4. E0 ticket detail (active milestone)

| Ticket | Status | Verified by |
| ------ | ------ | ----------- |
| E0-1 monorepo scaffold | ✅ | `pnpm install` |
| E0-2 `@moviefinder/shared` contract | ✅ | typecheck + 12 unit tests |
| E0-3 MV3 extension skeleton (dock/theme/fullscreen) | ✅ | CRXJS build → `dist/manifest.json` loadable |
| E0-4 typed message bus | ✅ | exhaustive handler; PING round-trip |
| E0-5 IndexedDB store + repo | ✅ | 4 tests incl. sticky-merge (C4) |
| E0-6 migrations + local config | ✅ | applied on PG16+pgvector (9 tbl, 6 RLS, ivfflat) |
| E0-7 Edge Function harness | ✅ | `deno check` clean (8 files) |
| E0-8 CI pipeline | ✅ | jobs defined: build·deno·migrations·gitleaks |
| E0-9 lint/format | ✅ | `eslint` + `prettier --check` clean |
| E1-0 deterministic `watchId` | ✅ | convergence/uniqueness tests |
| E0-10 budget guard + operational tables | 🟡 | tables + budget logic done; atomic-RPC hardening pending |
| E0-11 metrics + Sentry | ⬜ | needs Sentry DSN |
| E0-12 **provision accounts + secrets** | ⛔ | **You** — see §6 |

---

## 5. Critical path & key dependencies

```
M0 ✅ ──► E0-12 ⛔ (you) ──► M1 (catalog + /recommend) ──┬──► M3 (recommender E2E) ──► M4 (privacy) ──► M5 RELEASE
                                                        └──► M2 (capture) ───────────┘ (M2 ∥ M3; M3 cold-starts empty)
```
- **Single hard blocker today: E0-12.** Nothing on the critical path moves until Supabase + the
  three API keys exist.
- Within M3, sequence is `E4-1/2/2a/3 (retrieval+RAG+ranking) → E4-4 (/recommend) → E4-5/6/7 (UI wiring)`.
- Auth (E3-1) + consent guard (E5-2) are **pulled forward** before E4 (review B5).

---

## 6. Live blockers & risk watch

| # | Item | Type | Owner | Action / mitigation |
| - | ---- | ---- | ----- | ------------------- |
| B1 | No Supabase project / API keys | **Blocker** | **You** | Provision: Supabase (URL+anon+service_role), TMDB, OpenAI, Anthropic → `packages/backend/.env` |
| R1 | Netflix DOM/endpoint drift (scrobble + session read) | Risk | Eng | Versioned adapter + CI fixtures + health ping (M2) |
| R2 | CRXJS beta tooling | Risk | Eng | Pinned; plain-Vite escape hatch documented; CI builds the real bundle |
| R3 | Exact Netflix-id coverage sparse early | Risk (low) | Eng | Search-link fallback always valid; `platform_ids` learns organically |
| R4 | Open sign-up cost exposure | Risk | Eng | $25 kill-switch + per-user caps (verify in M3) |

---

## 7. Always-on quality bar (every merge)
These never regress — CI-enforced (`.github/workflows/ci.yml`):
`format ✓ · lint ✓ · typecheck (tsc) ✓ · unit tests ✓ · extension build ✓ · deno check ✓ ·
migrations apply (pgvector) ✓ · gitleaks (no secrets) ✓`. A PR is mergeable only when all are green
+ DoD ([`SPEC.md` §11](SPEC.md)). 🔴 tickets need a senior reviewer.

**Evidence log (verified milestones):** M0 code — see commits `3e99c76`, `12affd0`, `98f3e36`,
`0ac9b11` on `spec/v1-baseline`; migration verification + `deno check` run locally (Docker PG16).

---

## 8. Immediate next actions
1. **You → B1:** provision the 4 accounts/keys (≈20 min) → drop into `packages/backend/.env`.
2. **Eng (parallel, no accounts needed):** scaffold E1 — TMDB + OpenAI clients + ingest job
   (`deno check`-verifiable before keys); finish `metrics.ts` (E0-11).
3. **On keys landing:** `supabase link` → push migrations → run catalog ingest → deploy `/recommend`
   → **M1 gate**. Then M3 (recommender) on the critical path.
