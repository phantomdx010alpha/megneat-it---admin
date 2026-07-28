'use server';

/**
 * app/(app)/activity/actions.js
 *
 * Phase 11 — Audit log. One server action:
 *
 *   - listAuditLogAction: every `audit_log` row, newest first — the "simple
 *     reverse-chronological feed page" the masterplan's own Phase 11 spec
 *     asks for. Nothing here writes to `audit_log`; every write happens at
 *     its own call site via lib/audit.js#logAuditEvent, retrofitted across
 *     Phases 4-10's mutating actions.
 *
 * ── A cap, not unbounded ─────────────────────────────────────────────────
 * The masterplan doesn't mention pagination, and this is explicitly a
 * single-operator tool with a modest number of admin actions, so a single
 * capped query (most-recent 500) is enough for "review later" without
 * building pagination machinery the phase never asked for. If this table
 * ever legitimately grows past that in normal use, that's a good sign this
 * tool has been running a long time — worth revisiting with real
 * pagination then, not guessed at now.
 */

import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';

const AUDIT_LOG_ROW_LIMIT = 500;

/**
 * @param {string} accessToken
 * @returns {Promise<Array<{
 *   id: string, actor: string, action: string, target: string|null,
 *   details: object|null, createdAt: string
 * }>>}
 */
export async function listAuditLogAction(accessToken) {
  await requireAdminUser(accessToken);

  const admin = getRegistryAdminClient();

  const { data, error } = await admin
    .from('audit_log')
    .select('id, actor, action, target, details, created_at')
    .order('created_at', { ascending: false })
    .limit(AUDIT_LOG_ROW_LIMIT);

  if (error) {
    throw new Error(`Could not load the activity log: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    details: row.details,
    createdAt: row.created_at,
  }));
}
