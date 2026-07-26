import 'server-only';

/**
 * lib/audit.js
 *
 * Phase 11 — Audit log. Every mutating server action since Phase 4 has
 * already been inserting its own `audit_log` row inline (see e.g.
 * app/(app)/clients/actions.js's several `admin.from('audit_log').insert(...)`
 * calls) — Phase 3's schema and Phase 4's own convention got there first.
 * What this phase actually adds, per the masterplan's own "In scope" text
 * ("a small shared helper... called from every mutating action... retrofit
 * those phases' actions to call it, don't leave any of them silently
 * unlogged"), is exactly this file: one place those scattered inserts now
 * go through, so the shape and failure behavior can't drift between
 * call sites the way it already had (see the reconciliation note below).
 *
 * ── A real inconsistency this retrofit fixes ────────────────────────────
 * Phase 4's own two inserts (createProjectAction, provisionProjectAction)
 * hardcoded `actor: 'admin'`. Phase 5 onward switched to the verified
 * session's real email (`user.email ?? 'admin'`) — Phase 5's own actions.js
 * comment already flagged this as "worth reconciling... when Phase 11
 * retrofits every mutating action's logging, rather than silently
 * diverging without a note." Every call site below now passes the
 * verified user's email through explicitly; there's no longer a
 * hardcoded-string call site left un-reconciled.
 *
 * ── Failure behavior: best-effort, never blocks the action it's logging
 * ──────────────────────────────────────────────────────────────────────
 * None of the pre-existing call sites checked the insert's own `error`
 * result — a failed audit write was already silently swallowed, not
 * surfaced anywhere. Preserved that same "never throw back into the
 * mutating action" behavior here deliberately: the thing being logged
 * (creating a client, deleting one, etc.) has *already succeeded* by the
 * time this is called, and failing the whole user-facing action because
 * the *log entry* about it couldn't be written would be a strange
 * trade — the operator would see "client creation failed" for a client
 * that was, in fact, created. What this file changes is making that
 * failure at least visible server-side (`console.error`) instead of a
 * totally silent no-op, so a broken audit_log (e.g. a bad RLS policy)
 * doesn't go unnoticed indefinitely.
 *
 * @param {{
 *   actor: string,
 *   action: string,
 *   target?: string | null,
 *   details?: object | null,
 * }} entry
 * @returns {Promise<void>}
 */
export async function logAuditEvent({ actor, action, target = null, details = null }) {
  if (!action) {
    console.error('[lib/audit.js] logAuditEvent called with no action — skipping insert.');
    return;
  }

  try {
    // Imported lazily inside the function body rather than at module
    // top-level: keeps this file importable from any server action
    // without every caller also needing to worry about admin-client
    // construction order.
    const { getRegistryAdminClient } = await import('@/lib/supabase/admin');
    const admin = getRegistryAdminClient();

    const { error } = await admin.from('audit_log').insert({
      actor: actor || 'admin',
      action,
      target,
      details,
    });

    if (error) {
      console.error(`[lib/audit.js] Could not write audit log entry for "${action}":`, error.message);
    }
  } catch (err) {
    console.error(`[lib/audit.js] Could not write audit log entry for "${action}":`, err.message);
  }
}
