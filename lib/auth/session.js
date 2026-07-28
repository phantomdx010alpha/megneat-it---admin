/**
 * lib/auth/session.js
 *
 * Thin session helpers around the registry Supabase client
 * (lib/supabase/client.js#getSupabaseClient()). Mirrors the shape of the
 * client-facing PWA's own lib/auth/session.js, but simplified:
 *
 *   - No mock mode — this app only ever talks to one real registry project.
 *   - No device registration step on sign-in — that's a PWA/shell concept,
 *     not relevant to a single-operator admin tool.
 *   - Session persistence is the Supabase client's own default (localStorage
 *     is fine here per ADMIN_PANEL_MASTERPLAN.md Phase 2 — this app has no
 *     offline-first Dexie layer to keep consistent with).
 *
 * Used by:
 *   - app/login/page.js       (signInWithPassword)
 *   - app/(app)/layout.js     (getSession, onAuthStateChange — route guard)
 */

import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * Returns the current Supabase Auth session, or null if logged out.
 *
 * @returns {Promise<{ user: object, access_token: string } | null>}
 */
export async function getSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    console.warn('[lib/auth/session.js] getSession error:', error.message);
    return null;
  }
  return data?.session ?? null;
}

/**
 * Signs in with email + password against the registry project's Supabase
 * Auth — the single, manually-created admin account (no signup UI; see
 * ADMIN_PANEL_MASTERPLAN.md Phase 2's "Out of scope").
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: object, session: object }>}
 * @throws {Error} with a message safe to show directly in the UI
 */
export async function signInWithPassword(email, password) {
  if (!email || !email.trim()) {
    throw new Error('Enter the admin email address.');
  }
  if (!password) {
    throw new Error('Enter the password.');
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(error.message || 'Could not sign in with those credentials.');
  }

  return data;
}

/**
 * Signs out of the current Supabase Auth session.
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(error.message || 'Could not sign out.');
  }
}

/**
 * Subscribes to auth state changes (sign-in, sign-out, token refresh).
 *
 * @param {(event: string, session: object | null) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onAuthStateChange(callback) {
  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange(callback);
  return () => data?.subscription?.unsubscribe?.();
}
