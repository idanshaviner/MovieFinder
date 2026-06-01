/**
 * Theme tokens for the injected dock. Neutral, accessible (WCAG AA) light/dark palettes driven
 * by CSS custom properties; follows `prefers-color-scheme` with a future manual override.
 * All UI lives in a Shadow DOM so these never leak to / from the host page. (docs/04 §4)
 */
export const DOCK_WIDTH_PX = 380;

export const dockCss = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

  :host {
    --mf-bg: #ffffff;
    --mf-fg: #14171a;
    --mf-muted: #5b6470;
    --mf-border: #e3e6ea;
    --mf-accent: #c1121f;
    --mf-accent-fg: #ffffff;
    --mf-elev: rgba(0,0,0,0.12);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --mf-bg: #14171a;
      --mf-fg: #f2f4f6;
      --mf-muted: #9aa3ad;
      --mf-border: #2a2f35;
      --mf-accent: #e50914;
      --mf-accent-fg: #ffffff;
      --mf-elev: rgba(0,0,0,0.5);
    }
  }

  .launcher {
    position: fixed; top: 50%; right: 0; transform: translateY(-50%);
    z-index: 2147483647;
    background: var(--mf-accent); color: var(--mf-accent-fg);
    border: none; border-radius: 8px 0 0 8px; padding: 12px 8px;
    cursor: pointer; font-weight: 600; writing-mode: vertical-rl; letter-spacing: 0.5px;
    box-shadow: -2px 0 8px var(--mf-elev);
  }
  .launcher:focus-visible { outline: 2px solid var(--mf-fg); outline-offset: 2px; }

  .panel {
    position: fixed; top: 0; right: 0; height: 100vh; width: ${DOCK_WIDTH_PX}px;
    z-index: 2147483647;
    background: var(--mf-bg); color: var(--mf-fg);
    border-left: 1px solid var(--mf-border);
    box-shadow: -4px 0 16px var(--mf-elev);
    display: flex; flex-direction: column;
  }
  @media (prefers-reduced-motion: no-preference) {
    .panel { transition: transform .2s ease; }
  }

  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-bottom: 1px solid var(--mf-border);
  }
  .title { font-weight: 700; font-size: 15px; }
  .close { background: none; border: none; color: var(--mf-muted); cursor: pointer; font-size: 18px; }
  .close:focus-visible { outline: 2px solid var(--mf-fg); }

  .body { flex: 1; overflow-y: auto; padding: 14px; }
  .muted { color: var(--mf-muted); font-size: 13px; line-height: 1.5; }
  .btn {
    margin-top: 12px; background: var(--mf-accent); color: var(--mf-accent-fg);
    border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; font-weight: 600;
  }
  .status { margin-top: 10px; font-size: 12px; color: var(--mf-muted); }
`;
