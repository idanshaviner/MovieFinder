# 12 — Netflix "Connect" (in-session history read)

> Parent: [`../SPEC.md`](../SPEC.md). Implements **FR-9**. The realistic, honest form of
> "connect your Netflix": because the extension runs inside the user's **already-logged-in
> Netflix tab**, it can read **the user's own viewing activity from that session** — no Netflix
> API, no password, no credential ever handled by us.

---

## 0. Honest framing (read this first)

- 🔒 **There is no official Netflix watch-history API** (shut down 2014). We are **not** logging
  into Netflix on a server, not using OAuth, not storing Netflix credentials. Nothing about the
  user's Netflix password ever touches our code or backend.
- What we *can* do: the content script, running on `netflix.com` in the user's authenticated
  session, fetches **that session's own** viewing-activity list — the same data the user sees at
  `netflix.com/viewingactivity`. This is **client-side**, scoped to the logged-in **profile**.
- This endpoint is **unofficial and fragile** (same risk class as the player scraper) → it lives
  behind a **versioned adapter method** and fails closed (no error into the page, a health ping).
- Completion data **may or may not** be present per item (see §3). We degrade gracefully.

**Why it's worth it:** unlike live scrobbling (only what they watch in-browser from now on) or
the CSV (≤30-day wait), this delivers the user's **whole Netflix history instantly**, including
titles watched on TVs/phones/consoles that the browser never sees — the strongest possible
cold-start. It complements, not replaces, the other lanes.

The three capture lanes, unified by the same `watchId()` → resolve → outbox pipeline:

| Lane | Source value | Completion? | When | Coverage |
| ---- | ------------ | ----------- | ---- | -------- |
| Live scrobble (FR-1)       | `scrobble`        | ✅ accurate            | ongoing      | in-browser only |
| **Session read (FR-9)**    | `netflix_session` | ⚠️ if endpoint carries it | on connect | **all** profile history |
| CSV import (FR-7)          | `netflix_csv`     | ✅ accurate (Bookmark) | on file upload | all, ≤30-day wait |

---

## 1. Mechanism

1. The Netflix adapter exposes `readViewingActivity(): AsyncIterable<RawViewedItem>` (a new
   method on the versioned adapter; see [`04 §6`](04-extension.md#netflix-adapter)).
2. Implementation: read the page's bootstrap context (`netflix.reactContext`) for the API
   `buildId` + `authURL`, then page through the internal viewing-activity endpoint with
   `fetch(..., { credentials: 'include' })`. ⚠️ All selector/endpoint specifics live in
   `adapters/netflix/session.ts` behind the adapter `version`; if the shape changes, the method
   fails closed and pings health — it never throws into the page.
3. Each `RawViewedItem` is normalized, resolved (batch), and written exactly like an import row.

⚠️ **Per-profile.** The read reflects the **currently-selected Netflix profile**. We record
which profile label it came from (stored locally only, never synced as PII — see §5) and let the
user re-run after switching profiles. We do **not** enumerate or switch profiles for them.

---

## 2. Pipeline (shares FR-7's)

```
Connect ─► readViewingActivity() (paged) ─► normalize each item
   ─► dedupe titles ─► POST /catalog/resolve-batch (≤100/req)
   ─► group by watchId(tmdbId, season?, episode?)
   ─► completion present?  ── yes ─► pct = bookmark/runtime; finished if ≥ threshold
                            ── no  ─► record as "watched, completion unknown" (§3)
   ─► low-confidence (<0.6) matches ─► review list (confirm/skip)
   ─► enqueue outbox → /sync
```

Reuses [`10-history-import.md`](10-history-import.md) §3 wholesale (same resolver, same
`watchId()` idempotency, same review list). Only the **input source** differs.

---

## 3. Completion-unknown watches (🔒 data-model decision)

When the session item lacks enough to compute completion, we still know the user **watched** the
title — valuable taste signal, but not a confirmed "finished ≥90%". Model it on `watches`:

- `completion_known boolean not null default true`. When `false`, `progress_pct` is null and the
  row means "watched, completion unknown."
- **Exclusion (don't re-recommend):** a title the user has **any** watch record for — known or
  unknown completion — is excluded from recommendations (they've seen it). TV still follows the
  ≥80%-of-released-episodes rule for *show-level* exclusion ([`05 §2.4`](05-recommendation-engine.md#2-retrieval)).
- **Taste weight ([`05 §3.7`](05-recommendation-engine.md#37-tv-aggregation-episodes--one-weighted-show-item-)):**
  a completion-unknown movie is a **weaker** positive than a confirmed finish — weight **0.5**
  (vs 1.0 for a finished movie). A later confirmed finish (scrobble/CSV) upgrades the same row
  (deterministic `watchId` → convergence) to completion-known, weight 1.0.
- 🔒 **No downgrades.** Convergence is one-way on completion: a `completion_known=true` row is
  **sticky** and is never overwritten by a completion-unknown import, even if the import is
  "newer" (`03 §2` merge rule). So running Connect after watching live can only *add* history,
  never weaken what you actually finished.

This keeps one table, one id space, and lets the three lanes converge instead of conflict.

---

## 4. UX

🔒 **Opt-in, off by default** (`settings.sessionImportEnabled` defaults `false`). It is never
auto-run; the user explicitly chooses it.

1. Onboarding and Settings show **"Connect your Netflix history"**. On tap, **before** reading
   anything, show a one-time **plain-language disclaimer** the user must accept:
   > _"This reads **your own** Netflix viewing history from the session you're already logged
   > into — on your device, no password, nothing we can see. It's an **unofficial** method (there's
   > no Netflix API for this), so it may stop working if Netflix changes, and in theory Netflix
   > could limit access. You can skip this and still use everything else."_
   Accepting sets `sessionImportEnabled = true`; declining leaves the feature off.
2. On accept: read → resolve (progress bar) → review screen for low-confidence → summary
   (_"Connected — learned from 612 titles"_). Re-runnable; offer it again after a profile switch.
3. If the read fails (endpoint changed / not logged in), show a calm fallback: _"Couldn't read
   your history right now — you can still chat, and import a CSV instead."_ Never a hard error.

---

## 5. Privacy & security (🔒)

- **Client-side only.** The viewing activity is read in the extension; only normalized
  `{tmdbId, season?, episode?, completion?, ts, source}` rows leave the device, via `/sync`.
- **No credentials, ever.** We use the browser's existing Netflix session cookies implicitly via
  `credentials: 'include'`; we never read, store, or transmit cookies or passwords.
- **Profile label stays local** (used only to prompt "re-run after switching profiles"); it is
  **not** synced and **not** PII we retain server-side.
- **Consent-gated** like every data path; unreachable before `consentedAt`. Disclosed plainly in
  onboarding and the privacy policy, including the honest "unofficial, may break" caveat.
- **Hardening:** cap pages/rows read; bound memory; validate each item with zod; fail closed.

---

## 6. Acceptance criteria (selected)

- **AC-9.1** Given a logged-in Netflix session and consent, When the user taps Connect, Then
  their viewing activity is read client-side and resolved titles become `watches` with
  `source='netflix_session'` (idempotent via `watchId()`).
- **AC-9.2** Given a session item with completion data ≥ threshold, Then its watch is
  `completion_known=true` and counts as a finished title; given an item without completion data,
  Then `completion_known=false` and it is weighted 0.5 in the profile but still excluded from recs.
- **AC-9.3** Given the same title later finished via scrobble/CSV, Then the row converges (no
  duplicate) and upgrades to completion-known. **Conversely**, given a title already finished
  live (completion-known), When a later session-import reports it completion-unknown, Then the
  row is **not** downgraded (stickiness, `03 §2`).
- **AC-9.4** Given the read runs, Then no Netflix cookie/credential and no raw viewing-activity
  payload is ever sent to our backend (network assertion); only normalized rows via `/sync`.
- **AC-9.5** Given the endpoint shape has changed, Then the read fails closed (no page error, a
  health ping, calm UI fallback), and chat + CSV import still work.

---

## 7. Out of scope

Switching/enumerating Netflix profiles for the user; other platforms' in-session reads (same
adapter pattern when their adapters land); any server-side fetch of Netflix data (impossible and
out of bounds).
