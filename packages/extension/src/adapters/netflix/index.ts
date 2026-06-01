import { SCROBBLE_SAMPLE_MIN_INTERVAL_MS } from '@moviefinder/shared';
import type { ScrobbleOpts, SiteAdapter } from '../types';
import { ScrobbleTracker } from './scrobbler';
import { parseNetflixTitle } from './parse';
import { netflixVideoId, readTitleFrom, WATCH_PATH_RE } from './selectors';

/**
 * Netflix adapter v1 (docs/04 §6). Reads progress from the HTML5 <video>, samples ≤1/5s while
 * playing+visible, and fires `onFinished` once per title via the pure ScrobbleTracker. 🔒 All DOM
 * reads are wrapped so nothing ever throws into the Netflix page (degrades to no-op + onError).
 */
export class NetflixAdapter implements SiteAdapter {
  readonly siteId = 'netflix';
  readonly version = '1.0.0';

  matches(): boolean {
    return WATCH_PATH_RE.test(location.pathname);
  }

  startScrobbling(opts: ScrobbleOpts): () => void {
    const tracker = new ScrobbleTracker(opts.threshold, () => {
      try {
        const video = document.querySelector('video');
        const raw = readTitleFrom(document);
        const parsed = parseNetflixTitle(raw);
        const progressPct = video && video.duration > 0 ? video.currentTime / video.duration : 1;
        opts.onFinished({
          rawTitle: raw,
          mediaType: parsed.mediaType,
          season: parsed.season,
          episode: parsed.episode,
          progressPct,
          siteId: this.siteId,
          siteVideoId: netflixVideoId(location.pathname),
        });
      } catch (err) {
        opts.onError(err);
      }
    });

    let lastSample = 0;
    const tick = (): void => {
      try {
        const now = Date.now();
        if (now - lastSample < SCROBBLE_SAMPLE_MIN_INTERVAL_MS) return;
        lastSample = now;
        const video = document.querySelector('video');
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        tracker.update({
          siteVideoId: netflixVideoId(location.pathname),
          progressPct: video.currentTime / video.duration,
          playing: !video.paused,
          visible: document.visibilityState === 'visible',
          now,
        });
      } catch (err) {
        opts.onError(err);
      }
    };

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }

  buildPlayDeepLink(_tmdbId: number): string | null {
    // v1: the play-link upgrade for the CURRENT title is handled by the UI (which knows the
    // current title's tmdbId↔videoId). Cross-title links aren't built here (docs/04 §6.5).
    return null;
  }
}
