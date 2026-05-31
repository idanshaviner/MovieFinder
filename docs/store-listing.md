# Chrome Web Store Listing (DRAFT) — MovieFinder

> **DRAFT for owner review.** Visibility: **Unlisted** (installable via share link, not
> shown in search). Fill in `<…>` placeholders before submitting.

## Name
**MovieFinder — AI movie & TV recommendations**

## Summary (≤132 chars)
Chat with an AI that knows your taste and recommends movies & shows — with why, and where to
watch — right inside Netflix.

## Category
Entertainment

## Single-purpose description (required by Chrome Web Store)
MovieFinder adds an in-page AI chatbot to supported streaming sites (Netflix in v1) that
recommends movies and TV shows based on your stated taste and the titles you finish, and
shows where to watch each pick. That single purpose — conversational, explainable
recommendations — is the extension's only function.

## Detailed description
MovieFinder is like texting a film-buff friend, built into your streaming tab.

Open the side panel and tell it what you love — "I want a tense, morally-gray thriller like
Sicario" — and it recommends real titles, each with a one-line reason and where you can watch
it. If a pick is on the platform you're using, it links you straight to it; if not, it tells
you where to find it.

It learns your taste two ways: from the conversation, and from what you actually finish
watching. You can optionally connect your Netflix history (read privately on your device) or
import your Netflix CSV for an instant head start.

Built privacy-first:
• Your data lives on your device by default, with a private synced copy only you can read.
• One-click export and delete, anytime.
• No password is ever collected; sign in with a one-time email code.
• We never sell your data.

Note: This product uses the TMDB API but is not endorsed or certified by TMDB. MovieFinder is
not affiliated with Netflix.

## Permission justifications (for the store review form)
- **storage** — to save your settings and sync state on your device.
- **alarms** — to periodically sync your data to your account in the background (Manifest V3
  service workers are short-lived, so a timer alarm is required).
- **Host access to `*.netflix.com`** — to display the chat panel on Netflix and to read
  playback progress / your own viewing activity **only** while you're on Netflix. We request
  no other site access.

## Privacy practices disclosures (store form)
- **Data collected:** "User activity" (titles you watch/like) and "Personal communications"
  (your chat messages), tied to an email used for authentication.
- **Use:** solely to provide the recommendation feature. **Not** sold; **not** used for
  advertising or for purposes unrelated to the single purpose.
- **Link to privacy policy:** `<https://your-domain/privacy>` (host the policy in `docs/privacy-policy.md`).

## Assets to prepare
- Icon (128×128) + small promo tile.
- 3–5 screenshots (1280×800): the side-dock chat, a recommendation with "Watch on Netflix",
  an off-platform "where to watch" example, the Connect/Import screen, the privacy/settings.
- Short demo video (optional).

## Support
Support email / link: `<support@your-domain>`.
