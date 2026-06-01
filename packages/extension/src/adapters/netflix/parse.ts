import type { MediaType } from '@moviefinder/shared';

/**
 * Parse a Netflix title string → { title, mediaType, season?, episode? } (docs/04 §6.3). PURE +
 * unit-tested. Netflix DOM/strings are unstable, so this is best-effort with fallbacks: anything
 * we can't confidently parse as TV falls through to a movie title, and the resolve+confidence gate
 * downstream handles ambiguity. Keep all the fragile patterns HERE, behind tests.
 */

export interface ParsedTitle {
  title: string;
  mediaType: MediaType;
  season?: number;
  episode?: number;
}

function episodeNumber(s: string): number | undefined {
  const m = s.match(/Episode\s+(\d+)/i) ?? s.match(/^\s*(\d+)\b/);
  return m ? Number(m[1]) : undefined;
}

export function parseNetflixTitle(raw: string): ParsedTitle {
  // strip a trailing " | Netflix" / " - Netflix"
  const s = raw.replace(/\s*[|\-–]\s*Netflix\s*$/i, '').trim();

  // "Show: Season 1: Episode Name"  (or "... : Episode 3")
  let m = s.match(/^(.*?):\s*Season\s+(\d+):\s*(.*)$/i);
  if (m) {
    return {
      title: m[1]!.trim(),
      mediaType: 'tv',
      season: Number(m[2]),
      episode: episodeNumber(m[3]!),
    };
  }

  // "Show: S1:E3 ..."  or  "Show - S1:E3 ..."
  m = s.match(/^(.*?)[:\-–]\s*S(\d+)\s*[:.]?\s*E(\d+)/i);
  if (m) {
    return { title: m[1]!.trim(), mediaType: 'tv', season: Number(m[2]), episode: Number(m[3]) };
  }

  // "Show: Limited Series: Episode Name" → treat as season 1
  m = s.match(/^(.*?):\s*Limited Series:\s*(.*)$/i);
  if (m) {
    return { title: m[1]!.trim(), mediaType: 'tv', season: 1, episode: episodeNumber(m[2]!) };
  }

  // No reliable TV markers → a movie title.
  return { title: s, mediaType: 'movie' };
}
