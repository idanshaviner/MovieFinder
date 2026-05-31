/**
 * CORS locked to the extension origin(s) from an allowlist env var (docs/06 §8). Never `*`.
 * `CORS_ALLOWED_ORIGINS` is a comma-separated list of chrome-extension://<id> origins.
 */
function allowlist(): string[] {
  return (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = allowlist().includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

/** Handle the CORS preflight; returns a Response for OPTIONS, else null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
