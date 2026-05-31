# 04 — Browser Extension (MV3)

> Parent: [`../SPEC.md`](../SPEC.md). Manifest, messaging, UI mounting, and the all-important
> **site adapter** spec (Netflix v1).

---

## 1. Manifest V3 (least privilege)

```ts
// packages/extension/manifest.config.ts (CRXJS, typed)
export default defineManifest({
  manifest_version: 3,
  name: 'MovieFinder',
  version: '0.1.0',
  permissions: ['storage', 'alarms'],        // storage; alarms drives the sync engine (review M6)
  host_permissions: ['*://*.netflix.com/*'], // 🔒 v1: Netflix only — no <all_urls>
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [{
    matches: ['*://*.netflix.com/*'],
    js: ['src/content/index.ts'],
    run_at: 'document_idle',
  }],
  action: { default_popup: 'popup.html', default_title: 'MovieFinder' }, // settings/onboarding
  // onboarding.html / settings are EXTENSION PAGES, opened at chrome-extension://<id>/onboarding.html
  // (via the action popup or chrome.tabs on install). They do NOT need to be web-accessible.
  // web_accessible_resources is ONLY for assets the injected content script loads into the
  // netflix.com page (icons/fonts). (resolves review m10)
  web_accessible_resources: [{
    resources: ['assets/*'],
    matches: ['*://*.netflix.com/*'],
  }],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",  // no eval, no remote
  },
});
```

⚠️ **Do not** add `tabs`, `<all_urls>`, `webRequest`, or `scripting` unless a ticket
explicitly justifies it in review. Every permission is a store-review and trust cost.
(`alarms` is justified: MV3 evicts the SW, so the periodic sync must use `chrome.alarms`,
not `setInterval`.)

---

## 2. Process model & where state lives

| Context              | Lifetime                    | Holds                                  |
| -------------------- | --------------------------- | -------------------------------------- |
| Content script       | Per page load               | UI mount, adapter instance (no durable state) |
| Service worker (SW)  | **Ephemeral** (evicted ~30s idle) | Auth session, IndexedDB access, sync   |
| IndexedDB            | Persistent                  | All durable user data                  |
| `chrome.storage.session` | Until browser closes    | Auth tokens (not durable, not on page) |

🔒 **Never** keep durable state in SW module scope — it vanishes on eviction. On each
message, the SW re-opens IndexedDB (cheap, cached by `idb`) and reads what it needs.

---

## 3. Typed message bus (content ↔ background)

One discriminated union, one `sendMessage` wrapper, exhaustive handler. No stringly-typed
messages.

```ts
// packages/extension/src/messaging/types.ts
export type Message =
  | { type: 'WATCH_FINISHED'; payload: ScrobbleEvent }
  | { type: 'RESOLVE_TITLE'; payload: { title: string; year?: number; mediaType?: MediaType } }
  | { type: 'RECOMMEND'; payload: RecommendRequest }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; payload: Partial<Settings> }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'SIGN_IN_REQUEST_CODE'; payload: { email: string } }   // signInWithOtp
  | { type: 'SIGN_IN_VERIFY_CODE'; payload: { email: string; code: string } } // verifyOtp
  | { type: 'SIGN_OUT' }
  | { type: 'EXPORT_DATA' }
  | { type: 'DELETE_ALL_DATA' };

export type Response<M extends Message['type']> = /* mapped per type */;
```

```ts
// usage in content/UI
const res = await sendMessage({ type: 'RECOMMEND', payload: req });
```

Rules:
- The SW handler is a single `switch (msg.type)` with a `default: assertNever(msg)` so a new
  message type fails to compile until handled.
- Messages are validated on receipt (zod) — the content script is in an untrusted page.
- All async handlers return the standard `{ ok, data }|{ ok:false, error }` envelope.

---

## 4. UI mounting (Shadow DOM + Preact)

```ts
// content/index.ts (simplified)
const host = document.createElement('div');
host.id = 'moviefinder-root';
host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646;';
const shadow = host.attachShadow({ mode: 'open' });
document.documentElement.appendChild(host);
// inject our compiled CSS into the shadow root ONLY
shadow.adoptedStyleSheets = [mfStyleSheet];
render(<App adapter={adapter} />, shadow);
```

Rules:
- 🔒 All UI lives inside the shadow root. The only thing we add to the page is the single
  `#moviefinder-root` host. This guarantees style isolation both ways.
- Mount lazily: wait for `document_idle` + `requestIdleCallback` so we never delay the player.
- Launcher = a small floating button; clicking opens the chat panel. Panel is dismissible and
  remembers open/closed per-tab in `sessionStorage` (UI-only state).
- Respect `prefers-reduced-motion`; panel is keyboard-navigable and ARIA-labelled (FR / a11y).

---

## 5. Site adapter contract (the fragility firewall)

```ts
// packages/extension/src/adapters/types.ts
export interface ScrobbleEvent {
  rawTitle: string;          // on-screen title text as scraped
  mediaType?: MediaType;     // inferred if possible
  season?: number;
  episode?: number;
  progressPct: number;       // 0..1 at the moment of firing
  siteId: string;            // 'netflix'
  siteVideoId?: string;      // platform's own id, if discoverable (for deep links)
}

export interface SiteAdapter {
  readonly siteId: string;
  readonly version: string;          // bump when DOM assumptions change

  /** True if this adapter recognises the current page as a watchable player. */
  matches(): boolean;

  /** Start observing playback. Calls onFinished once per title per session at threshold. */
  startScrobbling(opts: {
    threshold: number;
    onFinished: (e: ScrobbleEvent) => void;
    onError: (err: unknown) => void;
  }): () => void;            // returns a stop() cleanup fn

  /** Build a deep link to play a TMDB title on this site, if resolvable. May return null. */
  buildPlayDeepLink(tmdbId: number): string | null;
}
```

🔒 Rules every adapter MUST follow:
1. **Never throw into the page.** Wrap all DOM reads in try/catch → call `onError`, no-op.
2. **Version your assumptions.** Any change to selectors/heuristics bumps `version`.
3. **Self-check health.** On `matches()` returning true but selectors failing, emit a
   health ping (`HEALTH_PING` message) so we learn the adapter broke in the wild.
4. **No data leaves the adapter.** It only emits `ScrobbleEvent`s; resolution + storage are
   the SW's job.

### Adapter registry

```ts
const ADAPTERS: SiteAdapter[] = [new NetflixAdapter()];
export function activeAdapter(): SiteAdapter | null {
  return ADAPTERS.find(a => a.matches()) ?? null;
}
```

Adding a platform later (Phase 3) = one new file implementing `SiteAdapter` + a manifest
match. No core changes.

---

## 6. Netflix adapter (v1) {#netflix-adapter}

Netflix is an SPA; the watch page is `netflix.com/watch/<id>`. We capture progress from the
HTML5 `<video>` element and the title from the player UI overlay.

### 6.1 Detecting playback
- `matches()` → `location.pathname.startsWith('/watch/')`.
- Find the `<video>` element (there is one main player video). Guard: it may mount after
  navigation — use a `MutationObserver` on `document` to wait for it, with a timeout.
- `siteVideoId` = the `<id>` segment of `/watch/<id>` (used for `buildPlayDeepLink`).

### 6.2 Reading progress
- `progressPct = video.currentTime / video.duration` when `duration` is a finite number > 0.
- Sample on a throttled `timeupdate` listener (≤ 1 sample / 5s) **and** only when
  `document.visibilityState === 'visible'` and `!video.paused`.
- ⚠️ Netflix sometimes reports the **recap/intro** as part of duration and shows "Next
  Episode" overlays; treat the main `<video>`'s own `duration` as truth and ignore overlay
  timers.

### 6.3 Reading the title
- Title overlay selectors are **not stable** → keep them in one `selectors.ts` constant block
  with fallbacks, e.g. try `[data-uia="video-title"]`, then the document `<title>`, then the
  player metadata. Parse `Show • S1:E3 "Episode Name"` shapes into `{title, season, episode}`.
- If no reliable title, still emit the event with `rawTitle` from `document.title`; the SW's
  `/catalog/resolve` + confidence gate handles ambiguity.

### 6.4 Firing "finished" (dedupe + debounce)
- Maintain a per-`siteVideoId` flag. Fire `onFinished` **once** when:
  `progressPct ≥ threshold` AND it has stayed ≥ threshold for ≥ 3s (avoid scrub-through
  false positives).
- Reset the flag when `siteVideoId` changes (new title) or on `ended`.
- For **autoplay-next** binge sessions, each episode's `siteVideoId` change re-arms capture,
  so each finished episode produces one `WATCH_FINISHED`.

### 6.5 Deep links (client-side only — resolves review B1)
🔒 Deep links are produced **entirely on the client**; the server never returns one (it has
no TMDB→Netflix-id map). After a `/recommend` response renders, the UI asks the active
adapter to fill `playDeepLink` for each rec:
- `buildPlayDeepLink(tmdbId)` returns a Netflix watch URL **only** when that `tmdbId` is the
  title currently/last resolved on this site (we know its `siteVideoId`). For every other
  rec it returns `null` (no guessing wrong links).
- Consequence: in practice a play link appears only when the user is *on* a title we
  recommend back to them — which is rare. That is expected; `whereToWatch` is the primary
  actionable signal, the deep link is a bonus. AC-3.6 is written to match this reality.
- Cross-title deep linking (a TMDB→Netflix-id map so any rec is playable) is Phase 2.

### 6.6 Fixture testing
Record real Netflix player DOM (sanitised, logged-out where possible) into
`adapters/netflix/__fixtures__/`. Adapter unit tests run against these fixtures with a fake
`<video>` whose `currentTime`/`duration` we drive — **no live Netflix in CI**. See
[`07-qa-test-plan.md`](07-qa-test-plan.md#adapter-tests).

---

## 7. Background service worker responsibilities {#auth}

- **Auth (email OTP):** owns the Supabase client + session. Handles `SIGN_IN_REQUEST_CODE`
  (`signInWithOtp`) then `SIGN_IN_VERIFY_CODE` (`verifyOtp`), stores the session in
  `chrome.storage.session`, exposes `GET_AUTH_STATE`/`SIGN_OUT`, and refreshes the token
  before backend calls. Full flow + rationale in [`03 §5`](03-api-contracts.md#5-auth-email-otp-code--resolves-review-b4).
- **Store:** the only writer to IndexedDB (via repos).
- **Capture handler:** on `WATCH_FINISHED` → `/catalog/resolve` → confidence gate → write
  `watch` + enqueue outbox.
- **Sync engine:** debounced (e.g. 10s after a write, or on a 5-min alarm via
  `chrome.alarms`) → drains outbox to `/sync`, applies `serverChanges`, advances cursor.
  Uses `chrome.alarms` (not `setInterval`) because the SW is ephemeral.
- **Recommend proxy:** forwards `RECOMMEND` with the JWT; never adds keys (backend has them).
- **Settings/consent gate:** refuses capture, sync, and recommend while `settings.consentedAt`
  is unset. 🔒

---

## 8. Error handling in the extension

- Every backend call goes through `lib/apiClient.ts` which: attaches JWT, sets a timeout
  (**18s recommend, 8s others** — the 18s sits above the server's ≤14s ceiling so the server's
  typed error wins instead of a blind client abort; ladder in [`03 §1`](03-api-contracts.md#1-post-recommend-core)),
  parses the envelope, and throws a typed `ApiError{code,retryable}`.
- UI components render: loading skeleton → result → typed error state with retry (if retryable).
- Adapter errors never surface to the user as crashes; they degrade to "capture paused" and a
  health ping.
- A small client-side **ring buffer** (last 50 log lines, no PII) is viewable in settings for
  bug reports. See [`09-conventions.md`](09-conventions.md#logging).
