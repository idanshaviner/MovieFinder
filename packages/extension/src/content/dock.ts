import { render } from 'preact';
import { App } from '../ui/App';
import { DOCK_WIDTH_PX, dockCss } from '../ui/theme';

/**
 * Mounts the right-side dock. Two isolated layers (docs/04 §4):
 *  1. a Shadow-DOM host holding all our UI (style-isolated both ways);
 *  2. a single `margin-right` on <html> we fully own (the "reshape"), removed on close/disable.
 * Fullscreen playback auto-collapses to the launcher (never reshape a fullscreen video).
 */
const HOST_ID = 'moviefinder-root';
const RESHAPE_STYLE_ID = 'moviefinder-reshape';
const OPEN_KEY = 'moviefinder:dockOpen';

let open = false;
let mountPoint: HTMLDivElement | null = null;

function setReshape(active: boolean): void {
  let style = document.getElementById(RESHAPE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = RESHAPE_STYLE_ID;
    document.head.appendChild(style);
  }
  const fullscreen = Boolean(document.fullscreenElement);
  const width = active && !fullscreen ? `${DOCK_WIDTH_PX}px` : '0px';
  style.textContent = `html { margin-right: ${width} !important; }`;
}

function rerender(): void {
  if (!mountPoint) return;
  const collapsed = Boolean(document.fullscreenElement);
  render(
    App({
      open: open && !collapsed,
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
    }),
    mountPoint,
  );
  setReshape(open);
}

function setOpen(next: boolean): void {
  open = next;
  try {
    sessionStorage.setItem(OPEN_KEY, next ? '1' : '0');
  } catch {
    /* sessionStorage may be unavailable; ignore */
  }
  rerender();
}

export function mountDock(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = dockCss;
  shadow.appendChild(style);

  mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.documentElement.appendChild(host);

  try {
    open = sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    open = false;
  }

  document.addEventListener('fullscreenchange', rerender);
  rerender();
}

export function unmountDock(): void {
  document.removeEventListener('fullscreenchange', rerender);
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(RESHAPE_STYLE_ID)?.remove();
  mountPoint = null;
}
