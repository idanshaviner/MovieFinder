# 06 — Security & Privacy

> Parent: [`../SPEC.md`](../SPEC.md). Privacy is the PRD's #1 non-functional requirement.
> This doc is the threat model + the concrete rules. Items here are **release-blocking**.

---

## 1. Threat model (what we defend against in v1)

| Asset                     | Threat                                         | Control                                          |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| API keys (Anthropic/OpenAI/TMDB) | Extracted from the shipped bundle       | Keys live ONLY in Edge Function env; never in extension. 🔒 |
| One user's data           | Read/written by another user                   | RLS by `auth.uid()` on every user table          |
| Auth tokens               | Stolen by the host page (Netflix or an XSS)    | Tokens in `chrome.storage.session`, never in page context |
| User viewing history      | Leaked via logs/telemetry                      | No-PII logging rule; no content in logs          |
| The injected UI           | Page CSS/JS interfering or scraping it         | Shadow DOM isolation; no secrets in DOM          |
| Backend abuse             | A valid user hammering / running up cost       | Per-user rate limits; cost circuit breaker       |

Out of scope for v1: nation-state adversaries, defeating a malicious browser, DRM/anti-bot
evasion. We are a friends/beta product.

---

## 2. Secrets handling 🔒

- The extension bundle contains **zero** third-party API keys. CI runs a secret scan
  (`gitleaks` or equivalent) over `packages/extension` build output; a hit fails the build.
- Edge Function secrets are set via `supabase secrets set` and read from `Deno.env`. They are
  never logged, never returned in a response, never echoed in errors.
- The Supabase **service-role key** is used only inside Edge Functions (for catalog tables);
  it is never shipped to the client. The client uses only the **anon key** + the user JWT.
- Key rotation procedure is in [`08-work-breakdown.md`](08-work-breakdown.md#release-checklist).

---

## 3. Auth & token handling {#token-handling}

- **Email OTP code** sign-in via Supabase Auth (`signInWithOtp` → `verifyOtp`), entirely
  inside the SW-owned UI — no redirect, so no token ever lands on a web origin (resolves
  review B4). Full flow in [`03 §5`](03-api-contracts.md#5-auth-email-otp-code--resolves-review-b4).
- Tokens (`access_token`, `refresh_token`) stored in **`chrome.storage.session`** — cleared
  when the browser closes, isolated from web page JS. ⚠️ Never `localStorage`, never inside
  the injected page's `window`, never IndexedDB.
- The background SW is the only context that holds tokens; the content script/UI asks the SW
  to make authenticated calls and never sees the token.
- Token refresh handled by the SW before expiry; on refresh failure → sign-out + prompt.

---

## 4. Per-user isolation (RLS)

- Every user table (`profiles`, `watches`, `taste_signals`, `excluded_titles`, `chat_threads`,
  `rate_limits`) has RLS enabled with `user_id = auth.uid()` policies (DDL in [`02-data-models.md`](02-data-models.md#13-row-level-security-🔒-non-optional)).
- Edge Functions perform user-scoped reads/writes using the **caller's JWT** (so RLS applies),
  and use the service-role client only for **catalog** access. A function must never widen a
  query to another `user_id`.
- ⚠️ **Service-role footgun (review m5):** the service-role client **bypasses RLS entirely**.
  Using it to read a user table would silently leak across users. Rule: the service-role
  client touches **catalog tables only** — never user tables. Enforced in [`09 §11`](09-conventions.md#11-service-role-boundary).
- A required test: signing in as user B and attempting to read user A's `watches` returns
  empty (see [`07-qa-test-plan.md`](07-qa-test-plan.md)).

---

## 5. Privacy by design (FR-6 / NFR)

1. **Consent gate (precise wording — resolves review m8).** No **capture, sync, or
   recommend** call happens until first-run consent (`settings.consentedAt` set). The **only**
   backend interaction allowed pre-consent is **auth** (`signInWithOtp`/`verifyOtp`) — it's how
   the user reaches the consent step. 🔒 Enforced in the SW and tested (E2E-2).
2. **Local-first.** Raw history and taste signals live in IndexedDB; the backend copy exists
   for cross-device durability and to compute recommendations. The user is told this plainly.
3. **LLM + at-rest disclosure (review B3).** Onboarding states clearly that (a) **chat text
   and a compact taste summary are sent to Anthropic** to generate recommendations, and (b)
   **your chat history is stored on our server** (`chat_threads`) to support multi-turn
   refinement, retained ≤ 30 days, and removed by delete. No surprise data flows.
4. **One-click export.** Produces a JSON of all local data (client-side, no server call).
5. **One-click delete.** Clears all registered IndexedDB stores **and** calls
   `DELETE /account/data`, which hard-deletes the user's rows across `watches`,
   `taste_signals`, `excluded_titles`, `chat_threads`, `rate_limits`, and `profiles`
   (RLS-scoped; review M11). After delete, the account holds no viewing or chat data.
6. **Per-site opt-in.** v1 only requests `netflix.com` host permission; capture only runs on
   enabled sites.
7. **Data minimisation.** We send the LLM only what's needed (query + bounded profile +
   candidate list), never the raw full history.
8. **Publish a privacy policy** before beta (linked from onboarding & store listing).

---

## 6. Logging & telemetry rules {#no-pii}

- **No PII, no content, no ids** in server logs. Allowed: `error.code`, latency, token
  counts, a random `traceId`, the function name. Forbidden: query text, titles, email,
  `user_id`, JWT, IP-derived identity.
- The client log ring buffer (for bug reports) stays **on the device**; it is shown to the
  user and only leaves the machine if the user manually copies it into a report.
- No third-party analytics SDKs in v1.

---

## 7. Input validation & injection

- Every Edge Function validates input with zod before use (SPEC §5). No string concatenation
  into SQL — use parameterised queries / the Supabase client exclusively. ⚠️
- Treat all extension→backend input as hostile (the content script runs in a page we don't
  control).
- The LLM output is parsed as JSON and **grounded** (only known TMDB ids survive), so prompt
  injection in a user's query can at worst produce a weird `why` string, never a fake title or
  a data leak. Still: never let model output drive a DB write or a privileged action.

---

## 8. CORS & CSP

- Edge Function CORS `Allow-Origin` = the extension origin from an allowlist env var; no `*`.
- Extension CSP forbids `eval` and remote scripts (manifest in [`04-extension.md`](04-extension.md#1-manifest-v3-least-privilege)).
- Host permissions limited to `*.netflix.com` in v1.

---

## 9. Security review gate

Before beta release, a security pass MUST confirm:
- [ ] No key/secret in the extension build (automated scan + manual spot check).
- [ ] RLS cross-user isolation test passes.
- [ ] Consent gate blocks all data flows pre-consent.
- [ ] Tokens are only in `chrome.storage.session`.
- [ ] No PII in server logs (log sample reviewed).
- [ ] Delete actually removes server rows.
- [ ] CORS not wildcard; CSP has no `unsafe-eval`.

This checklist is part of the release Definition of Done ([`08-work-breakdown.md`](08-work-breakdown.md#release-checklist)).
