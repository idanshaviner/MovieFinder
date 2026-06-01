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

The panel is a **right-side dock that reshapes the page** (not a floating overlay): when open,
Netflix's content shrinks to make room for a fixed right column. Two layers, both isolated:

```ts
// content/index.ts (simplified)
// 1) our UI host — a fixed right-edge column inside a Shadow DOM (style-isolated both ways)
const host = document.createElement('div');
host.id = 'moviefinder-root';
host.style.cssText = 'all: initial; position: fixed; top:0; right:0; height:100vh; z-index:2147483646;';
const shadow = host.attachShadow({ mode: 'open' });
shadow.adoptedStyleSheets = [mfStyleSheet];
document.documentElement.appendChild(host);
render(<App adapter={adapter} />, shadow);

// 2) "reshape" the page by reserving width on the RIGHT, via a single class on <html>.
//    We never restructure Netflix's DOM — just a margin we own and can cleanly remove.
const PANEL_W = '380px';
document.documentElement.style.setProperty('--mf-dock', '0px');   // closed
// open  → setProperty('--mf-dock', PANEL_W);  closed → '0px'
// styleSheet (document-level, scoped to our property): html { margin-right: var(--mf-dock) !important; transition: margin-right .2s; }
```

Rules:
- 🔒 All UI lives inside the shadow root. The only page mutations are (a) the single
  `#moviefinder-root` host and (b) one CSS custom property + a margin on `<html>` we fully own
  and remove on close/disable. Never restructure Netflix's DOM.
- **Launcher** = a small tab pinned to the right edge; clicking toggles the dock (slide-in).
  Open/closed + width persist per-tab in `sessionStorage` (UI-only state).
- **Theme-aware:** follow `prefers-color-scheme` (light UI in light mode, dark in dark) via the
  shadow root's CSS variables; expose a manual override in settings. 🔒 Must be readable over
  Netflix's dark chrome in both themes.
- **Branding (v1 default theme):** name **"MovieFinder"** (`APP_NAME` constant, swappable in one
  place). Use a **neutral, accessible palette** driven by CSS custom properties (one `--mf-*`
  token set per theme) meeting WCAG AA contrast; a simple placeholder icon (replaceable later).
  No brand assets are blocking — keep all colors/tokens in `ui/theme.ts`.
- 🔒 **Fullscreen / active playback:** when the player is fullscreen (or `requestFullscreen` is
  active), **auto-collapse to just the launcher** and set `--mf-dock: 0px` — never reshape or
  overlay a fullscreen video. Restore the user's prior dock state on exit.
- Mount lazily: `document_idle` + `requestIdleCallback`; the reshape must not jank the player.
- Respect `prefers-reduced-motion` (no slide animation); panel is focus-trapped when open,
  keyboard-navigable, ARIA-labelled (FR / a11y, AC-5.3).

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

// One raw item from the in-session viewing-activity read (FR-9, doc 12).
export interface RawViewedItem {
  rawTitle: string;
  mediaType?: MediaType;
  season?: number;
  episode?: number;
  watchedAt: number;         // epoch ms
  completionPct?: number;    // 0..1 IF the endpoint carried bookmark+duration; else undefined
  siteVideoId?: string;
}

export interface SiteAdapter {
  readonly siteId: string;
  readonly version: string;          // bump when DOM/endpoint assumptions change

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

  /** Optional (FR-9): read the user's OWN viewing activity from the logged-in session,
   *  client-side, paged. Undefined if the site has no such capability. MUST fail closed
   *  (yield nothing + health ping) on shape changes; NEVER throw into the page. doc 12. */
  readViewingActivity?(): AsyncIterable<RawViewedItem>;
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

### 6.5 Deep links & availability links {#65-deep-links--availability-links}
Two layers, by design (supersedes the earlier client-only B1 stance):

1. **Server-provided availability links (primary).** `/recommend` returns, per rec:
   `onCurrentPlatform`, `whereToWatch`, and — for on-platform titles — `currentPlatformUrl`
   (exact `netflix.com/title/<id>` when the id is known, else a `netflix.com/search?q=` link).
   The chat UI renders these directly; **no adapter work needed** for the common case. This is
   what makes "link any on-platform rec, not just the current title" work in v1.
2. **Client play-link upgrade (bonus).** After render, the UI asks the active adapter to
   *upgrade* the **currently-open** title's `currentPlatformUrl` to an exact PLAY deep link:
   - `buildPlayDeepLink(tmdbId)` returns a `netflix.com/watch/<siteVideoId>` URL **only** when
     that `tmdbId` is the title currently/last resolved on this page (we know its
     `siteVideoId`); otherwise `null` (no guessing).
   - When the adapter knows a `tmdbId ↔ siteVideoId` pair, it also fires
     `POST /catalog/platform-link` (best-effort) so the catalog learns the exact id and *every*
     user's future links for that title become exact. This is how the hybrid "exact when known"
     map fills organically — no external data source.

Off-platform recs show `whereToWatch` provider **names as text only** — no link, no play action.

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
  `chrome.alarms`) → drains outbox to `/sync`, **includes the `settings` row when it changed**
  (so `region`/`subscriptions`/`contentFilter`/`threshold`/`consentedAt` reach the `profiles`
  table `/recommend` reads), applies `serverChanges` + any newer server `settings`, advances
  cursor. Uses `chrome.alarms` (not `setInterval`) because the SW is ephemeral.
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
