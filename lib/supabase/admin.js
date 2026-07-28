import 'server-only';

/**
 * lib/supabase/admin.js
 *
 * Server-only Supabase client for the registry project, using the
 * REGISTRY'S OWN service-role key — the one place in the whole admin app a
 * service-role key is allowed to exist (per the comment left in
 * lib/supabase/client.js back in Phase 1). The `server-only` import above
 * makes any accidental import of this file from a 'use client' component
 * a build-time error, not just a code-review nit.
 *
 * Used by server actions (starting Phase 4) to write to the registry's own
 * `projects`/`licenses`/`audit_log` tables. This bypasses the
 * `authenticated`-scoped RLS policies from Phase 3 entirely (service_role
 * always bypasses RLS) — the actual security boundary for these writes is
 * `lib/auth/server-session.js#requireAdminUser()`, called at the top of
 * every server action, not Postgres RLS. See docs/PHASE_4_SETUP.md for the
 * reasoning behind this split.
 *
 * NOT for reading/writing a *target* client project — that's a distinct
 * client built per-request from that project's own stored credentials
 * (see app/projects/new/actions.js).
 */

import { createClient } from '@supabase/supabase-js';

let _adminClient = null;

export function getRegistryAdminClient() {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_REGISTRY_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_REGISTRY_SERVICE_ROLE_KEY. ' +
        'Set SUPABASE_REGISTRY_SERVICE_ROLE_KEY in .env.local (server-only, ' +
        'no NEXT_PUBLIC_ prefix) — see docs/PHASE_4_SETUP.md.'
    );
  }

  _adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}
