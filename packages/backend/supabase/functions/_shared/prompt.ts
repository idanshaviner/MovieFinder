import { z } from 'zod';
import type { MediaType, TasteProfile } from '@moviefinder/shared';

/**
 * Prompt builder for /recommend (docs/05 §3). 100% pure → unit-tested. Lays the messages out so
 * the STABLE prefix (rules + taste profile) is prompt-cached and only the query + candidate list
 * are fresh per call. Also parses + validates the model's JSON output.
 */

export interface PromptCandidate {
  tmdbId: number;
  title: string;
  year: number | null;
  genres: string[];
  overview: string | null;
  onPlatform: boolean;
}

export interface PromptInput {
  query: string;
  candidates: PromptCandidate[];
  profile: TasteProfile | null;
  history: ChatMsg[];
  hasOnPlatformAlternatives: boolean;
  scope?: MediaType | 'any';
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** 🔒 Cached system rules — the grounding + acknowledgment + two-tier policy (docs/05 §3.2). */
export const SYSTEM_RULES = [
  'You are MovieFinder, a knowledgeable, friendly movie & TV recommender embedded in a streaming site.',
  '',
  'RULES:',
  '- Recommend ONLY titles from the CANDIDATES list in the user message, referring to each by its exact tmdbId.',
  '  NEVER invent a title and NEVER use a tmdbId that is not in the list.',
  '- If the user names a title they liked, acknowledge it by name even if it is NOT in the candidates or not on',
  '  their platform — then make your picks.',
  '- Prefer candidates with onPlatform=yes. Choose an onPlatform=no title only when it is a clearly better match.',
  '  If hasOnPlatformAlternatives=true and you include any onPlatform=no pick, explicitly tell the user that',
  '  on-platform options also exist.',
  '- Each "why" is ONE sentence tied to the user\'s stated taste or a finished watch. No spoilers. No fluff.',
  '- Return 3–5 picks, best first.',
  '- Output ONLY valid JSON, no prose outside it:',
  '  {"assistantMessage": string, "picks": [{"tmdbId": number, "why": string}]}',
].join('\n');

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function renderProfile(p: TasteProfile | null): string {
  if (!p || p.items.length === 0) {
    return 'TASTE PROFILE: new user — no watch history yet; rely on the conversation.';
  }
  return `TASTE PROFILE:\n${p.summaryText}`;
}

export function renderCandidates(cands: PromptCandidate[]): string {
  return cands
    .map(
      (c) =>
        `- id=${c.tmdbId} | ${c.title} (${c.year ?? 'n/a'}) | ${c.genres.join('/')} | ` +
        `onPlatform=${c.onPlatform ? 'yes' : 'no'} | ${truncate(c.overview ?? '', 140)}`,
    )
    .join('\n');
}

export function buildPrompt(input: PromptInput): { system: SystemBlock[]; messages: ChatMsg[] } {
  const system: SystemBlock[] = [
    { type: 'text', text: SYSTEM_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: renderProfile(input.profile), cache_control: { type: 'ephemeral' } },
  ];
  const scopeLine =
    input.scope && input.scope !== 'any' ? `\nSCOPE: only ${input.scope} titles.` : '';
  const userText =
    `USER REQUEST: ${input.query}\n` +
    `hasOnPlatformAlternatives=${input.hasOnPlatformAlternatives}${scopeLine}\n\n` +
    `CANDIDATES:\n${renderCandidates(input.candidates)}`;
  return { system, messages: [...input.history, { role: 'user', content: userText }] };
}

// ── Output parsing ────────────────────────────────────────────────────────────

export const ModelOutputSchema = z.object({
  assistantMessage: z.string(),
  picks: z.array(z.object({ tmdbId: z.number().int(), why: z.string() })),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/** Extract the JSON object from the model text (tolerates code fences / stray prose). */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model output');
  return text.slice(start, end + 1);
}

export function parseModelOutput(text: string): ModelOutput {
  return ModelOutputSchema.parse(JSON.parse(extractJson(text)));
}
