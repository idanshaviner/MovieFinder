# 11 — Data Export

> Parent: [`../SPEC.md`](../SPEC.md). Sibling to [`10-history-import.md`](10-history-import.md).
> Two export kinds and the exact file schemas. Implements **FR-6** (raw JSON) and **FR-8** (CSV).

---

## 1. Two exports, two purposes

| Export | Format | Source | Purpose | Has titles? |
| ------ | ------ | ------ | ------- | ----------- |
| **Raw data** (FR-6) | JSON | client-side, iterating `dataManifest.ts` (no network) | Portability + delete-parity | ❌ tmdbIds only |
| **Debug/transparency** (FR-8) | CSV ×2 | `GET /profile` response | Understand & debug what the system thinks | ✅ |

The raw JSON export is the manifest-driven safety net (its store list must match
`DELETE /account/data` so coverage can't drift — DoD §5). The CSV export is the human-readable
one this doc focuses on.

⚠️ **Why CSV needs the server.** The taste profile is **derived server-side and never stored**
(SPEC §1), and local `watches` carry no title — only `tmdbId`. So the CSV export reads
[`GET /profile`](03-api-contracts.md#6-get-profile--debug--export--fr-8) (assembled profile +
title-enriched history) and writes the CSVs client-side from that one response.

---

## 2. `viewing-history.csv`

One row per `watch` (per episode for TV), newest first.

| Column           | Source                         | Example                  |
| ---------------- | ------------------------------ | ------------------------ |
| `watched_at`     | `finishedAt` → ISO-8601        | `2026-05-21T20:14:00Z`   |
| `tmdb_id`        | `tmdbId`                       | `27205`                  |
| `title`          | catalog join (`null` if unresolved) | `Inception`         |
| `media_type`     | `mediaType`                    | `movie` / `tv`           |
| `season`         | `season` (blank for movies)    | `1`                      |
| `episode`        | `episode` (blank for movies)   | `3`                      |
| `completion_pct` | `progressPct × 100`, 1 dp; **blank if `completionKnown=false`** (FR-9) | `97.0` |
| `source`         | `source`                       | `scrobble` / `netflix_session` / `netflix_csv` / `manual` |

---

## 3. `taste-profile.csv`

One row per `TasteProfileItem` (TV shows already rolled up — [`05 §3.7`](05-recommendation-engine.md#37-tv-aggregation-episodes--one-weighted-show-item-)),
sorted by `rank_score` descending. This is the debug artifact: it shows the tier, the weight,
how recency discounts it, and whether an explicit like/dislike overrode the derived tier.

| Column              | Source                | Notes                                            |
| ------------------- | --------------------- | ------------------------------------------------ |
| `kind`              | `mediaType`           | `movie` / `tv`                                   |
| `tmdb_id`           | `tmdbId`              |                                                  |
| `title`             | `title`               |                                                  |
| `tier`              | `tier`                | `movie` / `sampled` / `engaged` / `completed`    |
| `base_weight`       | `baseWeight`          | 1.0 / 0.3 / 1.5                                  |
| `eps_finished`      | `episodesFinished`    | blank for movies                                 |
| `eps_released`      | `episodesReleased`    | blank for movies                                 |
| `fraction`          | `fraction`, 2 dp      | blank for movies                                 |
| `last_finished_at`  | `lastFinishedAt` → ISO|                                                  |
| `explicit_sentiment`| `explicitSentiment`   | `like` / `dislike` / blank                       |
| `reason`            | `reason`              | explicit-signal text (quoted; may contain commas)|
| `effective_weight`  | `effectiveWeight`     | after override (dislike → negative)              |
| `recency_factor`    | `recencyFactor`, 2 dp | 0..1                                             |
| `rank_score`        | `rankScore`, 3 dp     | `effective_weight × recency_factor`              |

**CSV hygiene (🔒):** UTF-8; comma-delimited; fields containing `,` `"` or newlines are
double-quoted with `"` escaped as `""` (RFC-4180). `reason` and `title` are the risky ones.

---

## 4. UX

Settings → **Data** offers: "Export raw data (JSON)" and "Export for debugging (CSV)". The CSV
action fetches `GET /profile`, generates both files, and downloads them (two files, or a single
`moviefinder-export.zip` if zipping client-side is trivial — either is acceptable for v1).

---

## 5. Privacy & security

- `GET /profile` is **RLS-scoped** — only the caller's rows; titles are catalog data, not PII.
- **Consent-gated** like every data path; unreachable before `consentedAt`.
- CSV is generated **client-side** from the response; nothing extra is sent anywhere.
- No profile name / country / device data exists to leak (dropped at import, never captured live).
- Logs for `GET /profile` record counts only, never titles or reasons (no-PII logging rule, [`06`](06-security-privacy.md)).

---

## 6. Acceptance criteria (selected)

- **AC-8.1** Given watches + signals, when the user exports CSV, then `viewing-history.csv` has
  one row per watch with a resolved `title`, and `taste-profile.csv` has one row per show/movie
  (episodes rolled up, never one row per episode).
- **AC-8.2** Given a show with an explicit dislike, then its `taste-profile.csv` row shows
  `explicit_sentiment=dislike` and a negative `effective_weight` regardless of episode count.
- **AC-8.3** Given a `reason` containing a comma, then the CSV field is correctly quoted and
  re-imports cleanly into a spreadsheet (RFC-4180).
- **AC-8.4** Given the export runs, then `GET /profile` returns only the caller's data (verified
  by an RLS test with a second user's token) and logs contain no titles/reasons.
