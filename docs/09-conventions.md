# 09 — Engineering Conventions

> Parent: [`../SPEC.md`](../SPEC.md). The house rules. Following these is what lets a mixed-
> experience team produce consistent, reviewable code.

---

## 1. Pinned versions {#pinned-versions}

Do not float majors during v1. Exact versions are in the lockfile; the intended majors:

| Dep                    | Major | Notes                                  |
| ---------------------- | ----- | -------------------------------------- |
| TypeScript             | 5.x   | `strict: true`, `noUncheckedIndexedAccess` |
| Preact                 | 10.x  | with `@preact/signals` if state grows  |
| Vite                   | 5.x   | + `@crxjs/vite-plugin`                 |
| zod                    | 3.x   | shared schemas                         |
| idb                    | 8.x   | IndexedDB wrapper                      |
| @supabase/supabase-js  | 2.x   | extension auth + (server) DB           |
| @anthropic-ai/sdk      | latest 0.x | server only                       |
| Vitest / Playwright    | latest | tests                                  |

Model id: `claude-haiku-4-5-20251001`. Embedding model: `text-embedding-3-small` (1536).

---

## 2. TypeScript rules
- `strict: true`, no `any` (use `unknown` + narrowing). `// eslint-disable` requires a reason.
- Exhaustive switches end with `default: assertNever(x)`.
- Validate at boundaries with zod; inside the boundary, trust the types.
- Shared DTOs come from `@moviefinder/shared` — never redefine locally.
- Prefer pure functions for logic (scoring, dedupe, grounding) so they're trivially testable.

## 3. Error handling
- Backend: every handler is wrapped so it always returns the standard envelope; uncaught →
  `INTERNAL` + a logged `traceId`. Never leak stack traces or upstream messages to the client.
- External calls (Anthropic/OpenAI/TMDB/DB): always a timeout + bounded retry (max 2,
  exponential backoff, only on retryable/5xx/timeout). A helper `withRetry()` lives in
  `_shared/`.
- Extension: `apiClient` throws typed `ApiError{code, retryable}`; UI renders an explicit
  error state; adapters degrade to no-op + health ping, never throw into the page.
- ⚠️ No empty `catch {}`. Either handle, degrade explicitly, or rethrow a typed error.

## 4. Logging {#logging}
- Server: structured JSON logs, **no PII / no content** ([`06 §6`](06-security-privacy.md#no-pii)).
  Fields: `fn`, `traceId`, `code`, `ms`, `tokensIn/Out`. One log line per request outcome.
- Client: a `logger` writing to a 50-line ring buffer (in-memory + last copy in
  `chrome.storage.local`), shown in settings for bug reports. No auto-upload.
- Log levels: `debug` stripped in production builds; `info`/`warn`/`error` kept.

## 5. Config & env
- No magic strings/URLs in code. Backend reads `Deno.env`; extension reads a typed `config.ts`
  populated at build time from env (`VITE_*`). Secrets are backend-only.
- One source for shared constants (`@moviefinder/shared/constants.ts`): default threshold
  (0.90), default region, K (40), rate limits, model ids.

## 6. Git & PR workflow
- Branch per ticket: `e2/netflix-scrobbler`. Small PRs (< ~400 lines diff where possible).
- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`.
- PR template requires: linked ticket, what/why, test evidence, and the DoD checklist (SPEC
  §11). 🔴 tickets need a senior reviewer.
- CI must be green to merge: lint → typecheck → unit → integration → build. No merging red.
- Never commit secrets; `.env*` is gitignored; secret-scan runs in CI.

## 7. Testing conventions
- Co-locate tests: `foo.ts` ↔ `foo.test.ts`. Fixtures in `__fixtures__/`.
- Deterministic by default; upstreams mocked. Real-upstream tests behind an env flag.
- A bug fix lands with a regression test reproducing it.

## 8. Definition of Ready (before a ticket is picked up)
A ticket is Ready when: it links the relevant spec section, lists files to touch, has ACs or
a DoD, and its dependencies are merged. Unready tickets go back to the lead, not into a guess.

## 9. Accessibility & UX baseline
- Chat panel: focus-trapped when open, `Esc` closes, ARIA roles on messages/list, visible
  focus rings, color-contrast AA, respects `prefers-reduced-motion`.
- Loading states are skeletons, not spinners-with-no-context; errors are actionable.

## 10. Performance budgets
- Injected bundle (content script + UI) gzipped target < 150KB; lazy-load the chat panel.
- UI mount must not block the main thread > 50ms; use `requestIdleCallback`.
- `/recommend` p95 < 6s end-to-end (dominated by the LLM call); show progress after 1s.
- Timeout ladder (🔒): OpenAI embed ≤4s → Claude ≤12s → server total ≤14s → client 18s. The
  client timeout sits **above** the server ceiling so the server's typed error wins.

## 11. Service-role boundary {#11-service-role-boundary}
🔒 Two Supabase clients exist in the Edge Functions, and mixing them up is a silent
cross-user data leak (review m5):
- **Caller-JWT client** (built from the request's `Authorization` header) — used for **all
  user tables** (`watches`, `taste_signals`, `excluded_titles`, `chat_threads`, `rate_limits`,
  `profiles`). RLS applies, so it can only see the caller's rows.
- **Service-role client** — **bypasses RLS**. Used for **catalog tables only**
  (`catalog_titles`, `catalog_embeddings`) and the catalog-ingest job. ⚠️ It must **never**
  read or write a user table.
- Enforcement: the two clients are constructed by separate helpers
  (`_shared/userClient.ts` vs `_shared/serviceClient.ts`); `serviceClient` is lint-restricted
  (an ESLint `no-restricted-imports`/grep CI check) so it can only be imported by catalog/ingest
  modules. A reviewer rejecting any user-table query on the service client is the backstop.

## 12. Module-level invariants (quick reference for reviewers)
- `watches.id` is **always** `watchId()` (deterministic uuidv5); never `crypto.randomUUID()`.
- The server **never** sets `Recommendation.playDeepLink`; only the client adapter does.
- Every Edge Function: validate (zod) → auth → rate-limit → work, in that order.
- Nothing but auth touches the network before `settings.consentedAt` is set.
