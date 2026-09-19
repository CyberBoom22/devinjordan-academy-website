/**
 * The roster the projector polls.
 *
 * Returns exactly what the projector is allowed to paint on a wall: first name,
 * last initial, time in. The same masking as the server-rendered page, because
 * this endpoint is reachable by anybody holding the presenter token and there
 * is no second, richer version of it to accidentally call.
 *
 * The token in the path is the presenter token, not the check-in token. It
 * stops working two hours after check-in closes — presenterRoster() enforces
 * that, so an expired display degrades to an empty roster rather than serving a
 * class list for ever.
 *
 * no-store, because a cached roster on a screen is a screen that has quietly
 * stopped updating while looking like it is working.
 */

import type { APIRoute } from 'astro';
import { presenterRoster } from '../../../lib/checkin/service';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const runtimeEnv = locals.runtime?.env as Record<string, string | undefined> | undefined;
  const { session, roster } = await presenterRoster(params.token ?? '', runtimeEnv);

  if (!session) {
    return new Response(JSON.stringify({ ok: false, roster: [], count: 0 }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      count: roster.length,
      roster: roster.map((entry) => ({ name: entry.name, timeIn: entry.timeIn })),
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    },
  );
};
