import { describe, expect, it } from 'vitest';
import { parseNetflixTitle } from './parse';
import { netflixVideoId } from './selectors';

describe('parseNetflixTitle', () => {
  it('movie: strips " | Netflix"', () => {
    expect(parseNetflixTitle('Inception | Netflix')).toEqual({
      title: 'Inception',
      mediaType: 'movie',
    });
  });

  it('TV: "Show: Season N: Episode N"', () => {
    expect(parseNetflixTitle('Severance: Season 1: Episode 3')).toEqual({
      title: 'Severance',
      mediaType: 'tv',
      season: 1,
      episode: 3,
    });
  });

  it('TV: "Show - S1:E3 Title"', () => {
    expect(parseNetflixTitle('Severance - S1:E3 The We We Are')).toMatchObject({
      title: 'Severance',
      mediaType: 'tv',
      season: 1,
      episode: 3,
    });
  });

  it('TV: limited series → season 1', () => {
    expect(parseNetflixTitle('Beef: Limited Series: Episode 2')).toMatchObject({
      mediaType: 'tv',
      season: 1,
      episode: 2,
    });
  });

  it('TV: episode name with no number → episode undefined (resolved downstream)', () => {
    const p = parseNetflixTitle('Show: Season 2: The Reckoning');
    expect(p).toMatchObject({ title: 'Show', mediaType: 'tv', season: 2 });
    expect(p.episode).toBeUndefined();
  });
});

describe('netflixVideoId', () => {
  it('extracts the id from /watch/<id>', () => {
    expect(netflixVideoId('/watch/70131314')).toBe('70131314');
  });
  it('is undefined off the watch page', () => {
    expect(netflixVideoId('/browse')).toBeUndefined();
  });
});
