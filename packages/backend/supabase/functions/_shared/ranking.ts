import { OFF_PLATFORM_MAX, type MediaType, type Recommendation } from '@moviefinder/shared';
import { posterUrl } from './tmdb.ts';
import { buildPlatformUrl, normalizeProviderName, providerSiteId } from './providers.ts';

/**
 * The grounding gate + availability-aware ranking + enrichment (docs/05 §2.5, §3.4). 100% pure
 * so it's exhaustively unit-tested. Turns the model's ranked picks + the retrieved candidates
 * into the final Recommendation[] the API returns.
 *
 * 🔒 Two guarantees enforced here, in code (never trusting the model):
 *  1. GROUNDING: a pick survives only if its tmdbId was actually retrieved.
 *  2. AVAILABILITY: onCurrentPlatform / whereToWatch / currentPlatformUrl are computed from
 *     catalog data, not the model. Off-platform picks are capped. playDeepLink is NEVER set
 *     server-side (the client upgrades it for the current title).
 */

export interface RetrievedCandidate {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  providers: Record<string, string[]>; // { region: [providerName, ...] }
  platformIds: Record<string, string>; // { siteId: nativeId }
}

export interface ModelPick {
  tmdbId: number;
  why: string;
}

export interface RankContext {
  region: string;
  subscriptions: string[];
  currentSite?: string;
}

export interface RankResult {
  recommendations: Recommendation[];
  /** True iff the final list has an off-platform pick AND an on-platform option existed.
   *  The prompt uses this to make the assistant mention that on-platform alternatives exist. */
  hasOnPlatformAlternatives: boolean;
}

/** 🔒 The grounding gate: drop any pick whose tmdbId wasn't in the retrieved candidate set. */
export function groundPicks(picks: ModelPick[], candidateIds: Set<number>): ModelPick[] {
  return picks.filter((p) => candidateIds.has(p.tmdbId));
}

function isOnPlatform(c: RetrievedCandidate, ctx: RankContext): boolean {
  if (!ctx.currentSite) return false;
  const here = c.providers[ctx.region] ?? [];
  return here.some((p) => providerSiteId(p) === ctx.currentSite);
}

/** Region providers as canonical names, the user's subscriptions ordered first. */
function whereToWatch(c: RetrievedCandidate, ctx: RankContext): string[] {
  const here = (c.providers[ctx.region] ?? []).map(normalizeProviderName);
  const subs = new Set(ctx.subscriptions.map((s) => s.toLowerCase()));
  return [...here].sort(
    (a, b) => (subs.has(a.toLowerCase()) ? 0 : 1) - (subs.has(b.toLowerCase()) ? 0 : 1),
  );
}

export function buildRecommendations(
  candidates: RetrievedCandidate[],
  picks: ModelPick[],
  ctx: RankContext,
): RankResult {
  const byId = new Map(candidates.map((c) => [c.tmdbId, c]));

  // 1) grounding gate, preserving the model's ranking order
  const grounded = groundPicks(picks, new Set(byId.keys())).map((p) => {
    const c = byId.get(p.tmdbId)!;
    return { pick: p, c, onPlatform: isOnPlatform(c, ctx) };
  });

  // 2) cap off-platform picks (unless there are no on-platform picks at all), keeping order
  const onCount = grounded.filter((x) => x.onPlatform).length;
  let offKept = 0;
  const kept = grounded.filter((x) => {
    if (x.onPlatform) return true;
    if (onCount === 0) return true; // nothing on-platform → keep off-platform results
    return offKept++ < OFF_PLATFORM_MAX;
  });

  // 3) enrich → Recommendation (availability fields are server-authoritative)
  const recommendations: Recommendation[] = kept.map(({ pick, c, onPlatform }) => {
    const rec: Recommendation = {
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      title: c.title,
      year: c.year ?? undefined,
      posterUrl: posterUrl(c.posterPath),
      why: pick.why,
      onCurrentPlatform: onPlatform,
      whereToWatch: whereToWatch(c, ctx),
    };
    if (onPlatform && ctx.currentSite) {
      rec.currentPlatformUrl = buildPlatformUrl(
        ctx.currentSite,
        c.title,
        c.platformIds[ctx.currentSite],
      );
    }
    return rec; // note: no playDeepLink — the client sets that for the current title only
  });

  const anyOnPlatformCandidate = candidates.some((c) => isOnPlatform(c, ctx));
  const finalHasOffPlatform = recommendations.some((r) => !r.onCurrentPlatform);
  return {
    recommendations,
    hasOnPlatformAlternatives: anyOnPlatformCandidate && finalHasOffPlatform,
  };
}
