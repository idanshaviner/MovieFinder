import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  buildPrompt,
  parseModelOutput,
  type PromptCandidate,
  renderCandidates,
  renderProfile,
} from './prompt.ts';

const cands: PromptCandidate[] = [
  {
    tmdbId: 27205,
    title: 'Inception',
    year: 2010,
    genres: ['Sci-Fi', 'Thriller'],
    overview: 'A thief who steals corporate secrets through dream-sharing technology.',
    onPlatform: true,
  },
  {
    tmdbId: 273481,
    title: 'Sicario',
    year: 2015,
    genres: ['Thriller'],
    overview: null,
    onPlatform: false,
  },
];

Deno.test('renderCandidates: compact line per title with onPlatform flag', () => {
  const out = renderCandidates(cands);
  assert(out.includes('id=27205'));
  assert(out.includes('onPlatform=yes'));
  assert(out.includes('id=273481'));
  assert(out.includes('onPlatform=no'));
});

Deno.test('renderProfile: new user when no items', () => {
  assert(renderProfile(null).includes('new user'));
});

Deno.test(
  'buildPrompt: two cached system blocks + user message carries query/candidates/flag',
  () => {
    const { system, messages } = buildPrompt({
      query: 'tense morally-gray thriller',
      candidates: cands,
      profile: null,
      history: [],
      hasOnPlatformAlternatives: true,
      scope: 'movie',
    });
    assertEquals(system.length, 2);
    assert(system.every((b) => b.cache_control?.type === 'ephemeral'));
    const user = messages.at(-1)!;
    assertEquals(user.role, 'user');
    assert(user.content.includes('tense morally-gray thriller'));
    assert(user.content.includes('hasOnPlatformAlternatives=true'));
    assert(user.content.includes('SCOPE: only movie'));
    assert(user.content.includes('id=27205'));
  },
);

Deno.test('buildPrompt: prior conversation history is preserved before the new turn', () => {
  const { messages } = buildPrompt({
    query: 'more like the second one',
    candidates: cands,
    profile: null,
    history: [
      { role: 'user', content: 'thriller please' },
      { role: 'assistant', content: 'here are a few' },
    ],
    hasOnPlatformAlternatives: false,
  });
  assertEquals(messages.length, 3);
  assertEquals(messages[0]!.content, 'thriller please');
});

Deno.test('parseModelOutput: clean JSON', () => {
  const out = parseModelOutput(
    '{"assistantMessage":"try these","picks":[{"tmdbId":27205,"why":"layered"}]}',
  );
  assertEquals(out.picks[0]!.tmdbId, 27205);
});

Deno.test('parseModelOutput: tolerates code fences / stray prose around the JSON', () => {
  const text = 'Sure!\n```json\n{"assistantMessage":"x","picks":[]}\n```\nHope that helps.';
  assertEquals(parseModelOutput(text).assistantMessage, 'x');
});

Deno.test('parseModelOutput: rejects malformed output', () => {
  assertThrows(() => parseModelOutput('not json at all'));
  assertThrows(() => parseModelOutput('{"assistantMessage":"x"}')); // missing picks
});
