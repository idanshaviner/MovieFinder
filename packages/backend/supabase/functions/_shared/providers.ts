/**
 * Provider normalization (review m4). TMDB returns provider names like "Amazon Prime Video";
 * our adapters use site ids like "netflix"; the user's subscriptions use display names. This is
 * the one place that reconciles all three, so availability + where-to-watch + boosting agree.
 */

interface ProviderInfo {
  canonical: string;
  siteId?: string; // present only for platforms we have an adapter / link strategy for
}

const ALIASES: Record<string, ProviderInfo> = {
  netflix: { canonical: 'Netflix', siteId: 'netflix' },
  'amazon prime video': { canonical: 'Prime Video', siteId: 'prime' },
  'prime video': { canonical: 'Prime Video', siteId: 'prime' },
  max: { canonical: 'Max', siteId: 'max' },
  'hbo max': { canonical: 'Max', siteId: 'max' },
  'disney plus': { canonical: 'Disney+', siteId: 'disney' },
  'disney+': { canonical: 'Disney+', siteId: 'disney' },
  hulu: { canonical: 'Hulu', siteId: 'hulu' },
  'apple tv plus': { canonical: 'Apple TV+', siteId: 'apple' },
  'apple tv+': { canonical: 'Apple TV+', siteId: 'apple' },
  'paramount plus': { canonical: 'Paramount+', siteId: 'paramount' },
  peacock: { canonical: 'Peacock', siteId: 'peacock' },
};

function key(name: string): string {
  return name.trim().toLowerCase();
}

/** Canonical display name (falls back to the original if unknown). */
export function normalizeProviderName(name: string): string {
  return ALIASES[key(name)]?.canonical ?? name;
}

/** The adapter site id for a provider name, or undefined (e.g. "Netflix" → "netflix"). */
export function providerSiteId(name: string): string | undefined {
  return ALIASES[key(name)]?.siteId;
}

/**
 * Best-effort link to a title ON a platform (FR-3 hybrid): exact title page when we know the
 * native id, else a platform search link. Only Netflix is wired in v1; other sites → undefined
 * (the UI then shows where-to-watch text only).
 */
export function buildPlatformUrl(
  siteId: string,
  title: string,
  nativeId?: string,
): string | undefined {
  if (siteId === 'netflix') {
    return nativeId
      ? `https://www.netflix.com/title/${nativeId}`
      : `https://www.netflix.com/search?q=${encodeURIComponent(title)}`;
  }
  return undefined;
}
