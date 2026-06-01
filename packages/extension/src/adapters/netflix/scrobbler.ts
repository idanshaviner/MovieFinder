import { SCROBBLE_STABLE_MS } from '@moviefinder/shared';

/**
 * Finish-detection state machine (docs/04 §6.4). PURE — driven by samples, so it's unit-tested
 * without a real <video> or DOM. Fires `onFinish` exactly once per title when progress holds at/
 * above the threshold for `stableMs` (anti scrub-through), and re-arms when the title changes.
 */

export interface Sample {
  siteVideoId?: string;
  progressPct: number; // 0..1
  playing: boolean;
  visible: boolean;
  now: number; // epoch ms
}

export class ScrobbleTracker {
  private videoId: string | undefined = undefined;
  private crossedAt: number | undefined = undefined;
  private fired = false;

  constructor(
    private readonly threshold: number,
    private readonly onFinish: () => void,
    private readonly stableMs: number = SCROBBLE_STABLE_MS,
  ) {}

  update(s: Sample): void {
    // New title → re-arm (each autoplay episode produces its own finish).
    if (s.siteVideoId !== this.videoId) {
      this.videoId = s.siteVideoId;
      this.crossedAt = undefined;
      this.fired = false;
    }
    if (this.fired) return;

    const active = s.playing && s.visible && s.progressPct >= this.threshold;
    if (active) {
      this.crossedAt ??= s.now;
      if (s.now - this.crossedAt >= this.stableMs) {
        this.fired = true;
        this.onFinish();
      }
    } else {
      // dropped below threshold / paused / tab hidden → reset the stability window
      this.crossedAt = undefined;
    }
  }
}
