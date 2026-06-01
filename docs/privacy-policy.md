# MovieFinder — Privacy Policy (DRAFT)

> **DRAFT for owner review — not legal advice.** Have counsel review before publishing.
> Last updated: 2026-05-31 · Contact: **<privacy@your-domain>** (fill in before launch).

MovieFinder is a browser extension that adds an AI movie/TV recommender to streaming
sites you already use. This policy explains, in plain language, what it does with your
data. The guiding principle: **your viewing data lives on your device by default, you can
export or delete it anytime, and we never sell it.**

## What MovieFinder stores about you

- **Finished/watched titles** — which movies and shows you finish (or have watched),
  with timestamps, captured three ways you control: (a) live, as you watch in your
  browser; (b) by reading **your own** Netflix viewing history from your logged-in session
  *if you choose to "Connect your Netflix"*; (c) by importing a Netflix CSV you download.
- **Taste signals** — likes/dislikes and reasons you tell the chatbot.
- **Your settings** — enabled sites, completion threshold, region, content-filter choice.
- **Your account** — just the **email** you verify with (for sign-in and to sync your data
  across browsers). No password is created or stored.

This data is kept **locally on your device** (in the browser) and in a **private,
per-account copy** on our backend (Supabase) so it can sync across your browsers. Database
access is row-level-secured: **only your account can read your rows.**

## What we send to other companies (and why)

To generate recommendations we send the **minimum necessary** to trusted processors:

- **Anthropic (Claude)** — your chat message and a short summary of your taste, to write
  recommendations and explanations. Your chat history is also stored on our backend
  (private to you, deleted after 30 days) to support follow-up questions.
- **OpenAI (embeddings)** — your query text, turned into a numeric vector for matching.
- **TMDB (The Movie Database)** — used for movie/show metadata, posters, and where-to-watch
  availability. *This product uses the TMDB API but is not endorsed or certified by TMDB.*

We do **not** send your email, your identity, or your full history to these companies.

## What we never do

- We **never** see, store, or transmit your **Netflix (or any streaming) password or
  cookies**. The "Connect your Netflix" feature reads only **your own** viewing activity
  from the session you're already logged into, on your device.
- We **never sell** your data or use it for advertising.
- Our diagnostics (aggregate usage counts + crash reports) contain **no** titles, queries,
  email, account id, or IP-derived identity.

## Closed beta — operator visibility

MovieFinder is currently a **closed beta limited to 10 users**. To run the service within a tiny
budget, the operator receives **operational summaries**: a notification when a new user signs up
(your sign-up email + time) and a **daily usage report** (per-account counts such as
recommendations served and titles captured, plus total spend). These summaries are used **only**
to operate and support the beta — never sold, never used for advertising. They do **not** include
your chat messages or the specific titles in your history. (This operator visibility is distinct
from the anonymous diagnostics below.)

## "Connect your Netflix" (optional)

This is **off until you turn it on**. It reads your own Netflix viewing list from your
logged-in browser session to learn your taste faster. It's an **unofficial** method (there
is no Netflix API for this), so it may stop working if Netflix changes, and in theory
Netflix could limit access — we show you this note before you enable it. You can skip it
entirely and still use everything else.

## Your controls

- **Export** your data anytime (a JSON file, and human-readable CSVs).
- **Delete everything** in one click — clears your device copy and permanently deletes your
  rows from our backend.
- **Per-site & consent:** nothing is captured or sent until you accept consent at first run,
  and only on sites you enable.

## Data retention

Your watch/taste data is kept until you delete it. Chat history is auto-deleted after 30
days. Aggregate, non-identifying diagnostics may be retained longer.

## Children

MovieFinder is not directed at children under 13 (or the minimum age in your region) and we
don't knowingly collect their data.

## Changes & contact

We'll update this policy as the product evolves and note the date above. Questions or
requests: **<privacy@your-domain>**.
