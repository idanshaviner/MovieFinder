# MovieFinder — Product Requirements Document (v1)

> **One-liner:** A browser extension that augments streaming sites with an in-page
> conversational AI which recommends movies & TV based on what you tell it and what
> it sees you finish watching.

- **Status:** Scope locked (v1)
- **Last updated:** 2026-05-30
- **Owner:** idanshaviner

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
| **Primary UX**     | Conversational chat; secondary end-of-title "watch next" nudge           |
| **Content**        | Movies **and** TV series                                                 |
| **MVP platform**   | Netflix only first; expand to other platforms if it succeeds             |
| **Watch capture**  | In-browser scrobbling; "finished" = **≥90% played** (configurable)       |
| **LLM**            | Claude Haiku 4.5 (with prompt caching)                                   |
| **Embeddings**     | Cheap precomputed (OpenAI `text-embedding-3-small` / Google `text-embedding-005`) |
| **Vector search**  | pgvector (Postgres)                                                      |
| **Metadata**       | TMDB                                                                      |
| **Secrets/backend**| Tiny serverless proxy holds API keys (chosen over bring-your-own-key)    |
| **Browser**        | Manifest V3, Chromium-first                                              |

---

## 3. Key constraints & honest caveats

These do not block the project but must shape expectations:

1. **No official watch-history APIs.** No streaming platform (Netflix, Hulu, Max,
   Disney+, Prime) exposes personal watch history or completion % to third parties.
   Netflix shut down its public API in 2014. Capture is therefore via **in-browser
   scrobbling only**.
2. **Partial history.** The extension only sees viewing that happens in a desktop
   browser — TV apps, mobile apps, and consoles are invisible. Chat input both
   mitigates this and solves cold-start.
3. **"90% finished" is best-effort**, inferred from the web player's progress, not
   official platform data.
4. **No API keys in the bundle.** Shipping secrets in an extension is insecure, so a
   minimal serverless proxy is the one unavoidable backend component.
5. **Per-site scrapers are fragile.** Streaming sites change their player DOM
   frequently → isolate each site behind a **versioned adapter**.

### "Finished" semantics

- **Movie** → finished when the film reaches ≥90%.
- **TV** → finished at the **episode** level when an episode reaches ≥90%. The taste
  profile aggregates episodes up to the show level for recommendations.

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
- Ground recommendations in profile + finished watches + live conversation.
- Each recommendation returns: poster, **why-recommended explanation**, **where to
  watch** on the user's platforms, and a **deep link to play** when on the current site.
- Support multi-turn refinement and graceful cold-start.
- Can scope by content type ("just movies tonight").

### FR-4 Recommendation engine
- TMDB metadata → **embeddings + vector similarity** for "similar to".
- **Claude RAG** layer for ranking + explanations, with **strict grounding** — only
  real, retrieved TMDB titles; never invent movies.
- De-dupe against finished titles; boost titles available on the user's platforms.

### FR-5 In-page integration
- Inject UI without breaking the page; per-site enable/disable toggle.
- Optional end-of-title "watch next" nudge.

### FR-6 Settings & onboarding
- Select enabled sites; set completion threshold (default 90%).
- Data management: view / export / delete history and profile.
- Privacy-first first-run onboarding explaining what is captured.

---

## 5. Non-functional requirements

- **Privacy & data ownership (top priority).** Default to local storage; explicit
  consent; one-click export/delete; transparent that chat content goes to an LLM
  provider. Publish a privacy policy.
- **Security.** No secrets in the bundle; least-privilege host permissions; keys via
  the serverless proxy.
- **Resilience.** Per-site adapter pattern, versioned, with graceful failure.
- **Performance.** In-page UI must never jank the player; async LLM calls with clear
  loading states; cache embeddings.
- **Cost control.** Prompt caching on static system prompt + taste profile; small
  retrieved candidate sets; Haiku-by-default. Target ≈ half a cent per conversation.
- **Compatibility.** Manifest V3, Chromium-first; Firefox later.
- **Trust/accuracy.** Always show "why"; never recommend non-existent titles.

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

## 7. Recommended architecture

```
┌─────────────────────────── Browser Extension (MV3) ───────────────────────────┐
│  Content scripts (per-site adapters)        Background service worker          │
│   • Netflix adapter: capture + inject        • Orchestrates capture events     │
│   • Injected chat UI + "watch next" nudge    • Local store (IndexedDB):        │
│                                                history + taste profile         │
└───────────────────────────────────────┬───────────────────────────────────────┘
                                         │ HTTPS
                          ┌──────────────▼───────────────┐
                          │   Tiny serverless proxy       │
                          │   • Holds LLM + TMDB keys      │
                          │   • Embeds query, vector search│
                          │   • Calls Claude (RAG)         │
                          └──────┬─────────────┬──────────┘
                                 │             │
                     ┌───────────▼──┐   ┌──────▼───────────┐
                     │  pgvector DB  │   │  Claude Haiku 4.5 │
                     │ (TMDB catalog │   │   + prompt cache  │
                     │  embeddings)  │   └───────────────────┘
                     └───────────────┘
```

---

## 8. Cost model

- **One-time:** embed curated TMDB catalog (~50–100K titles ≈ 10–20M tokens) →
  **~$0.20–$0.40 once**.
- **Per conversation:** ~3K input + ~600 output tokens on Haiku 4.5 ≈ **~$0.005**,
  roughly halved with prompt caching. ~$5 ≈ a thousand recommendation conversations.
- **Vector search:** $0 per query (self-hosted pgvector).

---

## 9. Roadmap

- **Phase 0 — Foundations:** serverless proxy (keys + retrieval), TMDB catalog
  embedded into pgvector, MV3 extension skeleton.
- **Phase 1 — MVP:** Netflix capture (90% rule, movies + TV episodes) → local taste
  profile → in-page chat returning explained recommendations with where-to-watch.
- **Phase 2:** "Watch next" nudge, taste-profile editing, data export/delete polish,
  prompt-cache cost tuning.
- **Phase 3:** Second platform adapter (e.g., Max or Prime), then scale out.

---

## 10. Open questions (future)

- Firefox support timing.
- Whether to offer a bring-your-own-key option later for privacy-maximalist users.
- How aggressively to detect "finished the whole show" vs. per-episode.
- Account/sync model if users want history across multiple browsers/devices.
