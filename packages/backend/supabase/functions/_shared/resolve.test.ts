import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type Candidate,
  normalizeTitle,
  resolveAgainst,
  resolveTitle,
  scoreMatch,
  similarity,
} from './resolve.ts';

const inception: Candidate = { tmdbId: 27205, title: 'Inception', mediaType: 'movie', year: 2010 };
const prestige: Candidate = { tmdbId: 1124, title: 'The Prestige', mediaType: 'movie', year: 2006 };

Deno.test('normalizeTitle strips case, diacritics, punctuation', () => {
  assertEquals(normalizeTitle('  Amélie!! '), 'amelie');
  assertEquals(normalizeTitle('WALL·E'), 'wall e');
});

Deno.test('similarity: identical = 1, close < 1, unrelated near 0', () => {
  assertEquals(similarity('Inception', 'inception'), 1);
  assert(similarity('Inception', 'Inceptin') > 0.7); // typo still high
  assert(similarity('Inception', 'Paddington') < 0.5);
});

Deno.test('scoreMatch: exact title+year+type is ~1', () => {
  const s = scoreMatch({ title: 'Inception', year: 2010, type: 'movie' }, inception);
  assertEquals(s, 1);
});

Deno.test('scoreMatch: missing year renormalizes (no unfair penalty)', () => {
  // title-only exact match should score high even without a year
  const s = scoreMatch({ title: 'Inception' }, inception);
  assertEquals(s, 1);
});

Deno.test('scoreMatch: wrong year lowers but does not zero a strong title', () => {
  const s = scoreMatch({ title: 'Inception', year: 1999, type: 'movie' }, inception);
  assert(s < 1 && s > 0.7);
});

Deno.test('resolveAgainst picks the best candidate', () => {
  const best = resolveAgainst({ title: 'The Prestige', year: 2006 }, [inception, prestige]);
  assertEquals(best?.tmdbId, 1124);
});

Deno.test('resolveTitle: local hit above threshold returns without remote', async () => {
  let remoteCalled = false;
  const match = await resolveTitle(
    { title: 'Inception', year: 2010, type: 'movie' },
    {
      searchLocal: () => Promise.resolve([inception]),
      searchRemote: () => {
        remoteCalled = true;
        return Promise.resolve([]);
      },
      lazyInsert: () => Promise.resolve(),
    },
  );
  assertEquals(match?.tmdbId, 27205);
  assertEquals(remoteCalled, false);
});

Deno.test('resolveTitle: weak local → remote hit triggers lazy insert', async () => {
  let inserted = 0;
  const match = await resolveTitle(
    { title: 'Sicario', year: 2015, type: 'movie' },
    {
      searchLocal: () => Promise.resolve([]), // not in catalog yet
      searchRemote: () =>
        Promise.resolve([{ tmdbId: 273481, title: 'Sicario', mediaType: 'movie', year: 2015 }]),
      lazyInsert: () => {
        inserted++;
        return Promise.resolve();
      },
    },
  );
  assertEquals(match?.tmdbId, 273481);
  assertEquals(inserted, 1);
});

Deno.test('resolveTitle: nothing clears the floor → null (caller asks user)', async () => {
  const match = await resolveTitle(
    { title: 'Totally Made Up Film 9000' },
    {
      searchLocal: () => Promise.resolve([]),
      searchRemote: () => Promise.resolve([inception, prestige]),
      lazyInsert: () => Promise.resolve(),
    },
  );
  assertEquals(match, null);
});
