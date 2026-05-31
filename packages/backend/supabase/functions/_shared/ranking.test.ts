import { assert, assertEquals } from 'jsr:@std/assert@1';
import { buildRecommendations, groundPicks, type RetrievedCandidate } from './ranking.ts';

function cand(over: Partial<RetrievedCandidate> & { tmdbId: number }): RetrievedCandidate {
  return {
    mediaType: 'movie',
    title: `Title ${over.tmdbId}`,
    year: 2010,
    posterPath: null,
    providers: {},
    platformIds: {},
    ...over,
  };
}

const ctx = { region: 'US', subscriptions: ['Netflix'], currentSite: 'netflix' };

Deno.test('🔒 grounding gate drops picks not in the candidate set', () => {
  const kept = groundPicks(
    [
      { tmdbId: 1, why: 'a' },
      { tmdbId: 999, why: 'hallucinated' },
    ],
    new Set([1, 2]),
  );
  assertEquals(
    kept.map((p) => p.tmdbId),
    [1],
  );
});

Deno.test('🔒 all picks hallucinated → empty recommendations (caller → no-match)', () => {
  const { recommendations } = buildRecommendations(
    [cand({ tmdbId: 1 })],
    [{ tmdbId: 777, why: 'nope' }],
    ctx,
  );
  assertEquals(recommendations, []);
});

Deno.test('on-platform classification + exact link when native id known', () => {
  const candidates = [
    cand({ tmdbId: 1, providers: { US: ['Netflix'] }, platformIds: { netflix: '70131314' } }),
  ];
  const { recommendations } = buildRecommendations(candidates, [{ tmdbId: 1, why: 'x' }], ctx);
  assertEquals(recommendations[0]!.onCurrentPlatform, true);
  assertEquals(recommendations[0]!.currentPlatformUrl, 'https://www.netflix.com/title/70131314');
});

Deno.test('on-platform without native id → search link', () => {
  const candidates = [cand({ tmdbId: 1, title: 'The Prestige', providers: { US: ['Netflix'] } })];
  const { recommendations } = buildRecommendations(candidates, [{ tmdbId: 1, why: 'x' }], ctx);
  assertEquals(
    recommendations[0]!.currentPlatformUrl,
    'https://www.netflix.com/search?q=The%20Prestige',
  );
});

Deno.test('off-platform → no link, where-to-watch text only (subscriptions first)', () => {
  const candidates = [
    cand({ tmdbId: 1, providers: { US: ['Max', 'Netflix', 'Amazon Prime Video'] } }),
  ];
  // not on netflix? it IS — make a purely off-platform one instead:
  const off = [cand({ tmdbId: 2, providers: { US: ['Max', 'Amazon Prime Video'] } })];
  const { recommendations } = buildRecommendations(off, [{ tmdbId: 2, why: 'x' }], ctx);
  assertEquals(recommendations[0]!.onCurrentPlatform, false);
  assertEquals(recommendations[0]!.currentPlatformUrl, undefined);
  assertEquals(recommendations[0]!.whereToWatch, ['Max', 'Prime Video']); // normalized
  // (the `candidates` const above with Netflix would be on-platform — kept for clarity)
  assert(candidates.length === 1);
});

Deno.test('off-platform picks are capped at 2 when on-platform options exist', () => {
  const candidates = [
    cand({ tmdbId: 1, providers: { US: ['Netflix'] } }), // on
    cand({ tmdbId: 2, providers: { US: ['Max'] } }), // off
    cand({ tmdbId: 3, providers: { US: ['Hulu'] } }), // off
    cand({ tmdbId: 4, providers: { US: ['Peacock'] } }), // off (should be dropped)
  ];
  const picks = [1, 2, 3, 4].map((tmdbId) => ({ tmdbId, why: 'x' }));
  const { recommendations, hasOnPlatformAlternatives } = buildRecommendations(
    candidates,
    picks,
    ctx,
  );
  assertEquals(
    recommendations.map((r) => r.tmdbId),
    [1, 2, 3],
  ); // 4 capped out
  assertEquals(hasOnPlatformAlternatives, true); // off-platform present + on-platform existed
});

Deno.test('no on-platform options → keep off-platform, no false "alternatives" flag', () => {
  const candidates = [
    cand({ tmdbId: 2, providers: { US: ['Max'] } }),
    cand({ tmdbId: 3, providers: { US: ['Hulu'] } }),
    cand({ tmdbId: 4, providers: { US: ['Peacock'] } }),
  ];
  const picks = [2, 3, 4].map((tmdbId) => ({ tmdbId, why: 'x' }));
  const { recommendations, hasOnPlatformAlternatives } = buildRecommendations(
    candidates,
    picks,
    ctx,
  );
  assertEquals(recommendations.length, 3); // not capped when nothing is on-platform
  assertEquals(hasOnPlatformAlternatives, false);
});

Deno.test(
  'model order is preserved (an off-platform pick can lead if model ranked it first)',
  () => {
    const candidates = [
      cand({ tmdbId: 2, providers: { US: ['Max'] } }), // off, ranked #1 by model
      cand({ tmdbId: 1, providers: { US: ['Netflix'] } }), // on, ranked #2
    ];
    const { recommendations } = buildRecommendations(
      candidates,
      [
        { tmdbId: 2, why: 'much better match' },
        { tmdbId: 1, why: 'on netflix' },
      ],
      ctx,
    );
    assertEquals(
      recommendations.map((r) => r.tmdbId),
      [2, 1],
    );
  },
);
