# 07 — QA & Test Plan

> Parent: [`../SPEC.md`](../SPEC.md). Strategy, tooling, and **acceptance criteria mapped to
> every functional requirement**. A feature is not Done until its ACs pass.

---

## 1. Test pyramid

| Level        | Tool                         | Scope                                                        |
| ------------ | ---------------------------- | ----------------------------------------------------------- |
| Unit         | Vitest (ext/shared), Deno test (functions) | Pure logic: scoring, dedupe, grounding gate, repos, schemas |
| Integration  | Deno test + **local Supabase** | Edge Functions against a real local DB (RLS, sync, resolve) |
| Adapter      | Vitest + DOM fixtures        | Netflix scrobbler/title parsing without live Netflix        |
| E2E          | **Playwright** (loads unpacked extension) | Onboarding → chat → recs on a fixture page              |
| Manual / eval| Golden-set script + checklist | Rec quality, full-Netflix smoke before release             |

CI runs unit + integration + adapter + a headless E2E smoke on every PR. The full E2E suite
and manual eval run on release candidates.

---

## 2. What MUST be unit-tested (high-value, deterministic)

- **Grounding gate** ([`05`](05-recommendation-engine.md#34-grounding-gate-🔒-server-side-non-negotiable)):
  given model picks with a hallucinated id, the bad id is dropped; all-bad → no-match path. **0 tolerance.**
- **De-dupe**: watched/excluded ids never appear in candidates or output.
- **Title resolution scoring** ([`05 §5`](05-recommendation-engine.md#title-resolution)):
  confidence thresholds, year/type weighting, the `<0.6` confirm path.
- **Scrobble finish logic**: fires once at threshold after 3s stability; re-arms on video id
  change; ignores scrub-through.
- **Sync LWW**: older `updatedAt` is ignored; idempotent re-sync is a no-op; delete removes.
- **zod schemas**: each DTO rejects malformed input and accepts a valid fixture.

---

## 3. Integration tests (functions + local Supabase)

- **Auth**: no JWT → 401; valid JWT → 200.
- **RLS isolation** (🔒): user B cannot read/write user A's rows across **all** user tables
  (`watches`, `taste_signals`, `excluded_titles`, `chat_threads`, `rate_limits`, `profiles`)
  — verified through the function path, not just raw SQL.
- **Sync identity (review B2)**: two clients upserting the same finished episode (same
  deterministic `watches.id`) converge on one row — no unique-constraint error.
- **/sync** round-trip: push outbox → rows appear; pull `since` → returns server delta
  including `excludedTitles` (review M1); echo-excluded; cursor advances.
- **/recommend** happy path against a seeded mini-catalog: returns only seeded ids, no
  watched/excluded ids (incl. the TV ≥80% rule), every pick has a non-empty `why`, and **no
  `playDeepLink` is ever set by the server** (review B1).
- **/catalog/resolve**: exact match high confidence; ambiguous → lower; miss → 404; lazy
  insert path adds a row + embedding.
- **DELETE /account/data**: removes rows from all six user tables; idempotent when empty.
- **Rate limit**: N+1th call in the window → 429 retryable.

LLM/OpenAI/TMDB upstreams are **mocked** in integration (deterministic, no spend); a separate
opt-in suite hits real upstreams behind an env flag for pre-release verification.

---

## 4. Adapter tests (fixtures) {#adapter-tests}

- Fixtures in `adapters/netflix/__fixtures__/` capture player DOM shapes (current selectors +
  at least one "selectors changed" variant to prove graceful failure).
- Drive a fake `<video>` (`currentTime`/`duration`/`paused`) to simulate playback to 90%+.
- Assert: correct `ScrobbleEvent` (title/season/episode parsed), single finish fire, no throw
  when selectors are missing (→ `onError`, health ping), correct deep-link build/null.
- ⚠️ These are our early-warning system for Netflix DOM drift. Keep them current.

---

## 5. E2E (Playwright, unpacked extension)

Load the built extension against a **local fixture page** that mimics a Netflix watch page
(we do not automate the real netflix.com in CI — login/ToS/anti-bot). Cover:

- E2E-1 Onboarding: install → enter email → enter OTP code (mock auth) → enable Netflix +
  consent → ready.
- E2E-2 Consent gate: before consent, **no capture/sync/recommend** call is made (auth is the
  only permitted pre-consent call); the launcher is inert. After consent, calls flow.
- E2E-3 Chat cold-start: open chat, send a query (mock /recommend) → recs render with poster,
  why, where-to-watch; **no `playDeepLink`** unless the rec is the currently-open fixture title.
- E2E-4 Capture: drive fixture video to 90% → a watch appears in the history view.
- E2E-5 Data management: export downloads JSON (incl. excludes); delete clears the history
  view and (with a live backend) empties server rows.

A **manual** pre-release smoke runs the real extension on real Netflix with a test account
(one tester, checklist in §7).

---

## 6. Acceptance criteria by functional requirement

Each is Given/When/Then. "Done" for the FR = all its ACs green.

### FR-1 Watch capture
- **AC-1.1** Given consent given and a Netflix movie playing, When progress reaches the
  threshold and holds 3s, Then exactly one `watch` is stored with the resolved TMDB id.
- **AC-1.2** Given an episode, When it finishes, Then a `watch` with correct `season`/`episode`
  is stored; finishing the next autoplay episode stores a second distinct `watch`.
- **AC-1.3** Given title resolution confidence `<0.6`, When finished, Then no silent record is
  made; the user is asked to confirm.
- **AC-1.4** Given the history view, When the user deletes/corrects a watch, Then it updates
  locally and syncs to the backend.
- **AC-1.5** Given the adapter selectors are broken, When playing, Then no error reaches the
  Netflix page and a health ping is emitted.

### FR-2 Taste profile
- **AC-2.1** Given finished watches + chat likes/dislikes, When the profile is built, Then it
  reflects both, with reasons captured.
- **AC-2.2** Given the profile view, When the user edits/excludes a title, Then future recs
  exclude it.

### FR-3 / FR-4 Recommender
- **AC-3.1** Given any query (even with no history), When sent, Then ≥1 grounded recommendation
  returns with poster, a why tied to the user's words, and where-to-watch. (Cold-start works.)
- **AC-3.2** 🔒 Given the model returns a title not in the candidate set, When responding, Then
  that title is dropped — **no non-existent or non-retrieved title is ever shown** (0 tolerance).
- **AC-3.3** Given the user has watched/excluded a title per the precise de-dupe rule
  ([`05 §2.4`](05-recommendation-engine.md#2-retrieval): any finished movie; a show only if
  user-excluded or ≥80% of released episodes finished), When recommending, Then it never
  appears. (0-tolerance; the rule makes this deterministic.)
- **AC-3.4** Given `scope="movie"`, When recommending, Then only movies are returned.
- **AC-3.5** Given a follow-up turn referencing a prior rec, When sent, Then refinement uses
  prior context (multi-turn).
- **AC-3.6** (rewritten — resolves review B1) Given a recommended title is available on one of
  the user's `subscriptions`, Then it is boosted and its `whereToWatch` lists that service. A
  `playDeepLink` is present **only when the recommended title is the one currently open on the
  page** (the only case the client adapter can build a link for); for all other recs
  `playDeepLink` is absent and that is correct, not a bug.
- **AC-3.7** (degradation — resolves review m3) Given the embedding service (OpenAI) or Claude
  times out/errors, When recommending, Then `/recommend` returns a retryable error envelope
  before shipping any partial result, and the UI shows a "Try again" affordance. Given pgvector
  returns 0 candidates, Then an honest no-match message is shown and Claude is not called.

### FR-5 In-page integration
- **AC-5.1** Given a Netflix page, When the extension mounts, Then no layout/CSS of the page
  changes and the player never janks (UI inside Shadow DOM, idle-mounted).
- **AC-5.2** Given a site toggle off, Then no UI injects and no capture runs on that site.
- **AC-5.3** (accessibility — resolves review m6) Given the chat panel is open, Then it is
  reachable and operable by keyboard alone (Tab order, focus trap, `Esc` closes), messages and
  the rec list expose correct ARIA roles/labels, focus is visible, contrast meets WCAG AA, and
  animations are suppressed under `prefers-reduced-motion`.

### FR-6 Settings & onboarding
- **AC-6.1** Given first run, When onboarding completes, Then consent + LLM/at-rest disclosure
  were shown and `consentedAt` is set; **no capture/sync/recommend** call flowed to the backend
  before that (auth `signInWithOtp`/`verifyOtp` is the only permitted pre-consent call).
- **AC-6.2** Given settings, When threshold is changed, Then capture uses the new threshold.
- **AC-6.3** Given export, Then a JSON of all local data downloads.
- **AC-6.4** Given delete, Then local data is cleared and server rows are removed (verified).

---

## 7. Pre-release manual smoke checklist
- [ ] Real Netflix: finish a movie → watch recorded with correct title.
- [ ] Real Netflix: finish 2 episodes of a show → both recorded.
- [ ] Chat returns sensible, explained, real recs; when a rec is the currently-open title, its
      play link opens the right title (deep links only appear for the current title — by design).
- [ ] Export & delete behave; after delete the account is empty.
- [ ] No console errors leak into the Netflix page; player unaffected.
- [ ] Golden-set rec eval passes (no hallucinated/ watched titles).
- [ ] Security checklist ([`06 §9`](06-security-privacy.md#9-security-review-gate)) all checked.

---

## 8. Bug severity & exit criteria
- **S1 (blocker):** any hallucinated/watched title shipped; data leak across users; secret in
  bundle; page broken. **Zero S1 to release.**
- **S2:** capture misses common cases; recs visibly poor; sync loses data. Fix before beta.
- **S3:** cosmetic/edge. Track, ship with known-issues note.

Release requires: all ACs green, 0 S1, 0 known S2, security gate signed off.
