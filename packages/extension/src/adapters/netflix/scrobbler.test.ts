import { describe, expect, it, vi } from 'vitest';
import { type Sample, ScrobbleTracker } from './scrobbler';

const sample = (over: Partial<Sample>): Sample => ({
  siteVideoId: 'v1',
  progressPct: 0.95,
  playing: true,
  visible: true,
  now: 0,
  ...over,
});

describe('ScrobbleTracker', () => {
  it('fires once after holding ≥ threshold for stableMs', () => {
    const fire = vi.fn();
    const t = new ScrobbleTracker(0.9, fire, 3000);
    t.update(sample({ now: 0 }));
    t.update(sample({ now: 2000 }));
    expect(fire).not.toHaveBeenCalled();
    t.update(sample({ now: 3000 }));
    expect(fire).toHaveBeenCalledTimes(1);
    t.update(sample({ now: 5000 }));
    expect(fire).toHaveBeenCalledTimes(1); // never double-fires
  });

  it('ignores scrub-through (drops below threshold before stable)', () => {
    const fire = vi.fn();
    const t = new ScrobbleTracker(0.9, fire, 3000);
    t.update(sample({ now: 0, progressPct: 0.95 }));
    t.update(sample({ now: 1000, progressPct: 0.2 })); // scrubbed back
    t.update(sample({ now: 2000, progressPct: 0.95 })); // re-cross
    t.update(sample({ now: 3500, progressPct: 0.95 })); // only 1500ms since re-cross
    expect(fire).not.toHaveBeenCalled();
  });

  it('does not count paused/hidden time toward stability', () => {
    const fire = vi.fn();
    const t = new ScrobbleTracker(0.9, fire, 3000);
    t.update(sample({ now: 0 }));
    t.update(sample({ now: 2000, playing: false })); // paused → resets window
    t.update(sample({ now: 2500 })); // resume → crossedAt = 2500
    t.update(sample({ now: 4000 })); // 1500ms < 3000
    expect(fire).not.toHaveBeenCalled();
    t.update(sample({ now: 5600 })); // 3100ms ≥ 3000
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('re-arms on title change (autoplay next episode fires its own finish)', () => {
    const fire = vi.fn();
    const t = new ScrobbleTracker(0.9, fire, 3000);
    t.update(sample({ siteVideoId: 'v1', now: 0 }));
    t.update(sample({ siteVideoId: 'v1', now: 3000 }));
    expect(fire).toHaveBeenCalledTimes(1);
    t.update(sample({ siteVideoId: 'v2', now: 4000 }));
    t.update(sample({ siteVideoId: 'v2', now: 7000 }));
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('never fires below threshold', () => {
    const fire = vi.fn();
    const t = new ScrobbleTracker(0.9, fire, 3000);
    for (let now = 0; now <= 10000; now += 1000) t.update(sample({ now, progressPct: 0.5 }));
    expect(fire).not.toHaveBeenCalled();
  });
});
