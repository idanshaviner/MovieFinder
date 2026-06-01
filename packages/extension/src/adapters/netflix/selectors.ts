/**
 * Netflix DOM assumptions — ALL kept here behind the adapter version, so when Netflix changes,
 * only this file (and its bump) moves (docs/04 §6). `netflixVideoId` is pure (takes a pathname)
 * so it's unit-tested; the DOM readers are thin.
 */

export const WATCH_PATH_RE = /^\/watch\/(\d+)/;

// Tried in order; falls back to document.title.
export const TITLE_SELECTORS = ['[data-uia="video-title"]', '[data-uia="player-title"]'];

/** The Netflix native id from a /watch/<id> path (the siteVideoId), or undefined. */
export function netflixVideoId(pathname: string): string | undefined {
  return pathname.match(WATCH_PATH_RE)?.[1];
}

/** Read the on-screen title, with fallbacks. Best-effort; never throws. */
export function readTitleFrom(doc: Document): string {
  for (const sel of TITLE_SELECTORS) {
    const t = doc.querySelector(sel)?.textContent?.trim();
    if (t) return t;
  }
  return doc.title;
}
