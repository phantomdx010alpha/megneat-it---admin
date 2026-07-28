import 'server-only';

/**
 * lib/auth/server-session.js
 *
 * ── Why this file exists (a gap Phase 4 forced into the open) ─────────────
 * Phase 2's session (lib/auth/session.js) is a plain browser Supabase
 * client with default localStorage-backed persistence — there is no
 * session cookie. `app/(app)/layout.js`'s route guard is a client-side
 * `useEffect` check only. That's fine for gating what a *browser* renders,
 * but Phase 4 introduces the first real server actions — and a Next.js
 * server action is a callable server endpoint in its own right, reachable
 * directly (e.g. a raw POST) regardless of which page rendered the button
 * that normally calls it. Nothing server-side was checking the caller was
 * actually logged in before this file existed.
 *
 * Rather than retrofit the whole app onto @supabase/ssr's cookie-based
 * pattern (a bigger change than this phase calls for), the fix here is
 * lighter-weight bearer-token verification: the client already holds a
 * valid `access_token` after Phase 2's sign-in (see
 * lib/auth/session.js#getSession()). Every server action must now accept
 * that token as an explicit argument and verify it here — via the
 * registry's own Auth server (`auth.getUser(token)`), not by trusting the
 * caller — before doing anything privileged.
 *
 * Convention for every server action from Phase 4 onward: first argument
 * is always `accessToken`, and the very first line of the action body is
 * `await requireAdminUser(accessToken)`.
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Verifies the given access token against the registry project's own
 * Supabase Auth. Throws if missing/invalid/expired — callers should let
 * this throw propagate (it becomes a rejected server-action promise, which
 * the calling client component already handles via try/catch, same
 * pattern as lib/auth/session.js's other functions).
 *
 * @param {string} accessToken
 * @returns {Promise<object>} the verified Supabase Auth user
 */
export async function requireAdminUser(accessToken) {
  if (!accessToken) {
    throw new Error('Not signed in — no access token supplied.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  // A fresh, throwaway client per call — this only ever validates a token,
  // never persists a session server-side.
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error('Session expired or invalid — please sign in again.');
  }

  return data.user;
}
