/**
 * lib/supabase/client.js
 *
 * Browser-side Supabase client for the registry project. Anon key only —
 * this file is safe to import from client components. The service-role
 * key never lives here; it's read only inside server actions/API routes
 * (added from Phase 4 onward, per ADMIN_PANEL_MASTERPLAN.md's standing
 * rule: "the one place in the whole system a service-role key is allowed
 * to exist... never sent to the browser, never bundled client-side").
 *
 * Unlike the client-facing PWA's lib/data/client.js, there's no mock mode
 * and no per-license dynamic resolution here — this app only ever talks
 * to one fixed registry project, known at build/deploy time via env vars.
 */

import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabaseClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.local.example to .env.local and fill in the registry project\'s ' +
        'URL + anon key (see docs/PHASE_1_SETUP.md).'
    );
  }

  _client = createClient(url, anonKey);
  return _client;
}
