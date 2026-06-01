# 10 — Prior-History Import (cold-start backfill)

> Parent: [`../SPEC.md`](../SPEC.md). Implements **FR-7** (PRD §4). Solves the cold-start
> problem by importing a user's *past* viewing so the first recommendation isn't blind.

- **v1 scope (🔒):** **Netflix CSV import only.** It is the single source that carries
  enough data to retroactively apply the "finished = ≥90%" rule.
- **Deferred (future lanes, same pipeline):** tracker CSV (Letterboxd/IMDb ratings),
  browser-history scan (`chrome.history`), other platforms' privacy exports.
- **Ruled out:** Google / YouTube Takeout — it exports YouTube + search activity, **not**
  streaming watches; noisy for film taste. Do not build.

---

## 1. Why the Netflix privacy export (and not the quick one)

Netflix offers two downloads:

| Source | Contents | Completion? | Verdict |
| ------ | -------- | ----------- | ------- |
| `netflix.com/viewingactivity` → "Download all" | `Title, Date` only | ❌ | Not enough — can't honor ≥90% |
| **`netflix.com/account/getmyinfo` → "Download your personal information"** | Full archive incl. `CONTENT_INTERACTION/ViewingActivity.csv` | ✅ via `Bookmark` | **🔒 the one we use** |

The full export takes **up to 30 days** to arrive (often faster) and is **per-profile**
(repeat per profile). We accept that latency because completion data is what makes the
import worth doing. Conversational seeding (PRD UX cold-start) covers the gap while it's pending.

Sources: [Netflix help — request your data](https://help.netflix.com/en/node/100624),
[ViewingActivity.csv column breakdown](https://nitinahuja.github.io/2023/netflix-viewing-analysis/).

---

## 2. File format

`ViewingActivity.csv` — UTF-8, comma-delimited, **11 columns**:

```
Profile Name, Start Time, Duration, Attributes, Title,
Supplemental Video Type, Device Type, Bookmark, Latest Bookmark, Country
```

Columns we use:
- **`Title`** — movie title, or `"Series: Season N: Episode Title"` for TV.
- **`Start Time`** — UTC timestamp of the session → the watch `ts` (use the latest per title).
- **`Bookmark`** — furthest playback position (timedelta) → numerator for completion.
- **`Supplemental Video Type`** — non-empty = trailer/teaser/hook → **🔒 skip the row**.

Columns we **ignore and never store/sync** (PII): `Profile Name`, `Country`, `Device Type`,
`Attributes`, `Latest Bookmark`, `Duration` (session length, not position).

⚠️ v1 accepts the **`.csv`** directly (user extracts it from the archive). Zip handling is a
future nicety.

---

## 3. Parsing pipeline

```
upload CSV ─► stream-parse rows ─► drop supplemental rows ─► parse Title
   ─► dedupe titles ─► resolve in batches of ≤100 (POST /catalog/resolve-batch, fuzzy + confidence)
   ─► group by watchId(tmdbId, season?, episode?)
   ─► completion = max(Bookmark in group) / TMDB runtime   (clamp 0..1)
   ─► completion ≥ threshold(0.90)?  ─ yes ─► write `watch` (finished, source=netflix_csv)
                                      ─ no  ─► ignore in v1 (not a "finished" watch)
   ─► low-confidence (<0.6) matches ─► "Review these" list; user confirms/skips
   ─► enqueue outbox → /sync
```

**🔒 Non-negotiables**
- **Reuse `watchId()`** (`packages/shared/src/ids.ts`, the deterministic
  `uuidv5(tmdbId:season:episode)`). This makes import **idempotent** and makes an imported
  watch **converge** with a live-captured one (LWW by `updatedAt`) instead of duplicating.
- **Resolve in bulk, not one-by-one.** Dedupe titles client-side first, then call
  **`POST /catalog/resolve-batch`** (≤100/req, [`03 §3a`](03-api-contracts.md#3a-post-catalogresolve-batch-bulk-import--resolves-review-r4)) so a
  large history doesn't exhaust the single-title resolve budget (review R4). Show a progress
  bar; paginate; the import is resumable and never silently stalls.
- **Completion needs TMDB runtime**, which the CSV lacks → resolve first, then divide by the
  title's (or episode's) runtime. No runtime ⇒ cannot compute ⇒ treat as low-confidence review.
- **Title resolution mirrors live capture** (doc 01 §4): confidence `< 0.6` is **never
  silently recorded** — it goes to the review list.
- Re-importing the same file is safe (idempotent upserts).

**TV parsing.** Split `Title` on `": "` into series / season / episode; resolve the series,
map season+episode to a TMDB episode id, use the episode runtime. Ambiguous splits → review list.

---

## 4. Data-model additions

Add to `watches` (Postgres + IndexedDB + `packages/shared`):
- `source: 'scrobble' | 'netflix_csv' | 'manual'` (default `'scrobble'`; canonical enum in
  [`02 §3`](02-data-models.md)). Future import lanes extend the enum.

Imports write `watches` rows and flow through the existing `POST /sync`. The only new
endpoint is **`POST /catalog/resolve-batch`** (bulk title resolution, [`03 §3a`](03-api-contracts.md#3a-post-catalogresolve-batch-bulk-import--resolves-review-r4));
`completion` maps to the existing percentage field; `finished` is derived as today.

---

## 5. Privacy & security (🔒)

- **Parsed entirely client-side.** The raw CSV is **never uploaded**; it is read in the
  extension, and discarded after parse. Only the normalized `{tmdbId, season?, episode?,
  completion, ts, source}` rows leave the device, via the same `/sync` path.
- **No PII leaves the device** — profile name, country, device are dropped at parse time.
- **Consent-gated** like everything else: import is only reachable *after* `consentedAt`.
- **Input hardening:** cap rows processed; stream-parse to bound memory; reject files over a
  size limit; never `eval`; validate each row against a zod schema before use.

---

## 6. UX flow (FR-6 / FR-7)

1. Onboarding offers an **optional** "Import your Netflix history" step with: a short
   how-to, a link to [`netflix.com/account/getmyinfo`](https://www.netflix.com/account/getmyinfo),
   and a note that it can take up to 30 days — _"You can start chatting now; import whenever
   your file arrives."_
2. File picker → progress bar → **review screen** for low-confidence matches (confirm/skip).
3. Summary: _"Imported 142 finished titles."_ Re-runnable anytime from **Settings**.

---

## 7. Acceptance criteria (selected)

- **AC-7.1** Given a valid `ViewingActivity.csv`, when imported, then every row with empty
  `Supplemental Video Type` and a ≥0.6-confidence TMDB match and ≥90% completion becomes a
  `watch` with `source='netflix_csv'`.
- **AC-7.2** Given the same file imported twice, then no duplicate `watches` are created
  (idempotent via `watchId()`).
- **AC-7.3** Given a title later captured live that was already imported, then the rows
  converge to one `watch` (no duplicate).
- **AC-7.4** Given the import runs, then the raw CSV is never sent to the backend (verified by
  network assertion) and no `Profile Name`/`Country` value is persisted or synced.
- **AC-7.5** Given a row with match confidence `< 0.6`, then it is not recorded automatically
  and appears in the review list.

---

## 8. Out of scope for this doc (future lanes)

Tracker CSV (Letterboxd/IMDb ratings → `taste_signals`), browser-history seed
(`chrome.history`, requested at import time), and non-Netflix privacy exports. All reuse this
same parse → resolve → `watchId()` → outbox pipeline; only the parser and `source` value differ.
