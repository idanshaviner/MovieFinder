import { APP_NAME } from '@moviefinder/shared';
import { requireUser } from '../_shared/auth.ts';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import { HandledError, jsonErr, jsonOk } from '../_shared/errors.ts';

/**
 * Harness smoke function (E0-7): proves CORS preflight, JWT auth, and the standard envelope.
 * Returns 401 without a valid JWT; otherwise the caller's id.
 */
Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const headers = corsHeaders(req);

  try {
    const { userId } = await requireUser(req);
    return jsonOk({ app: APP_NAME, userId, at: Date.now() }, headers);
  } catch (e) {
    if (e instanceof HandledError) return jsonErr(e.code, e.message, headers);
    console.error('[hello] unexpected', e);
    return jsonErr('INTERNAL', 'unexpected error', headers);
  }
});
