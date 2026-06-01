import { useCallback, useState } from 'preact/hooks';
import { sendMessage } from '../messaging/bus';

interface AppProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Skeleton dock UI (E0-3). A launcher tab + a docked panel. The chat itself (E4) mounts here
 * later; for now it proves Shadow-DOM isolation, theming, and the message bus to the SW.
 */
export function App({ open, onOpen, onClose }: AppProps) {
  const [status, setStatus] = useState<string>('');

  const ping = useCallback(async () => {
    setStatus('pinging…');
    const res = await sendMessage({ type: 'PING' });
    setStatus(
      res.ok ? `SW alive @ ${new Date(res.data.at).toLocaleTimeString()}` : res.error.message,
    );
  }, []);

  if (!open) {
    return (
      <button class="launcher" onClick={onOpen} aria-label="Open MovieFinder">
        MovieFinder
      </button>
    );
  }

  return (
    <section class="panel" role="dialog" aria-label="MovieFinder" aria-modal="false">
      <header class="header">
        <span class="title">MovieFinder</span>
        <button class="close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>
      <div class="body">
        <p class="muted">
          This is the MovieFinder side panel. The conversational recommender lands here next — tell
          it what you love and it suggests movies &amp; shows with reasons and where to watch.
        </p>
        <button class="btn" onClick={ping}>
          Test connection
        </button>
        {status && <div class="status">{status}</div>}
      </div>
    </section>
  );
}
