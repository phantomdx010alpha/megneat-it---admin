'use server';

/**
 * app/(app)/projects/actions.js
 *
 * Phase 5: the projects dashboard's two server actions.
 *
 *   - listProjectsWithStatusAction: everything the dashboard needs in one
 *     round trip — every `projects` row, a "how many licenses point here"
 *     count (derived from the registry's own `licenses` table), and a
 *     lightweight up/down reachability indicator for each project.
 *   - toggleProjectPausedAction: flips the `is_paused` flag added in
 *     0003_project_status.sql (see that file for why it didn't already
 *     exist).
 *   - setProjectConnectionStringAction: added by
 *     ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 1 — the one-time
 *     backfill for projects that existed before
 *     0004_project_connection_strings.sql, so every currently-active
 *     project ends up with one stored, not just newly-created ones. The
 *     dashboard below only shows this prompt for a project missing one;
 *     it's a no-op once every project has been backfilled.
 *
 * ── What "reachability" actually checks, and why ───────────────────────────
 * The masterplan's own Phase 5 spec: "a lightweight reachability check (one
 * cheap REST call per project, e.g. hitting its own `licenses` count via
 * its own service-role key server-side, shown as a simple up/down
 * indicator — not a full health dashboard)". Read literally, "its own
 * licenses" means the *target* project's own local `licenses` table
 * (supabase/provisioning/target_project_schema.sql, SECTION 1) — a
 * different table from the registry's own `licenses` (0002's schema),
 * which is what the license-count column below actually joins against.
 * Confirmed the target schema really does provision a `licenses` table
 * before relying on this, rather than assuming the phase text meant the
 * registry's own table (it doesn't say "the registry's licenses", and the
 * registry has no per-project reachability to check — it's this app's own
 * database, either the whole app works or it doesn't).
 *
 * This means license count and reachability are two independently-sourced
 * numbers that can legitimately disagree (e.g. a project reachable but
 * with 0 target-side license rows if Phase 6 hasn't onboarded a client to
 * it yet) — that's expected, not a bug to reconcile.
 *
 * Each reachability check uses the stored service-role key server-side
 * only, with a short timeout so one sleeping free-tier project can't hang
 * the whole dashboard load. Keys never leave this file.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit';

const REACHABILITY_TIMEOUT_MS = 5000;

/**
 * @param {{ supabase_url: string, supabase_service_role_key: string }} project
 * @returns {Promise<'up' | 'down' | 'unknown'>}
 */
async function checkReachability(project) {
  if (!project.supabase_url || !project.supabase_service_role_key) {
    return 'unknown';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);

  try {
    const client = createClient(project.supabase_url, project.supabase_service_role_key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, opts) => fetch(url, { ...opts, signal: controller.signal }) },
    });

    const { error } = await client.from('licenses').select('*', { count: 'exact', head: true });

    // A real Postgres/PostgREST error (bad key, table missing, project
    // paused/deleted on Supabase's side) counts as down. A clean response
    // — even a count of 0 — counts as up; this is a reachability probe,
    // not a data check.
    return error ? 'down' : 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} accessToken
 * @returns {Promise<Array<{
 *   id: string, label: string, notes: string|null, isPaused: boolean,
 *   createdAt: string, licenseCount: number, reachability: 'up'|'down'|'unknown'
 * }>>}
 */
export async function listProjectsWithStatusAction(accessToken) {
  await requireAdminUser(accessToken);

  const admin = getRegistryAdminClient();

  const { data: projects, error: projectsError } = await admin
    .from('projects')
    .select(
      'id, label, notes, is_paused, created_at, supabase_url, supabase_service_role_key, db_connection_string'
    )
    .order('created_at', { ascending: false });

  if (projectsError) {
    throw new Error(`Could not load projects: ${projectsError.message}`);
  }

  // "how many licenses point here" — a simple per-project count off the
  // registry's own `licenses` table. supabase-js has no group-by
  // aggregate helper for PostgREST, and the list is small for a
  // single-operator tool, so count in JS rather than reach for an RPC.
  const { data: licenseRows, error: licensesError } = await admin
    .from('licenses')
    .select('project_id');

  if (licensesError) {
    throw new Error(`Could not load license counts: ${licensesError.message}`);
  }

  const countByProjectId = new Map();
  for (const row of licenseRows ?? []) {
    countByProjectId.set(row.project_id, (countByProjectId.get(row.project_id) ?? 0) + 1);
  }

  const reachabilities = await Promise.all((projects ?? []).map(checkReachability));

  return (projects ?? []).map((p, i) => ({
    id: p.id,
    label: p.label,
    notes: p.notes,
    isPaused: p.is_paused,
    createdAt: p.created_at,
    licenseCount: countByProjectId.get(p.id) ?? 0,
    reachability: reachabilities[i],
    // Phase 1 of the schema-broadcast track: a boolean only, so the
    // dashboard knows whether to show the one-time backfill prompt. The
    // stored connection string itself is never sent to the browser.
    hasConnectionString: Boolean(p.db_connection_string),
    // Deliberately not returned: supabase_url, supabase_service_role_key,
    // db_connection_string. The dashboard has no legitimate use for any of
    // these in the browser.
  }));
}

/**
 * @param {string} accessToken
 * @param {{ projectId: string, projectLabel: string, isPaused: boolean }} args
 * @returns {Promise<{ id: string, isPaused: boolean }>}
 */
export async function toggleProjectPausedAction(accessToken, { projectId, projectLabel, isPaused }) {
  const user = await requireAdminUser(accessToken);

  if (!projectId) throw new Error('projectId is required.');

  const admin = getRegistryAdminClient();

  const { data, error } = await admin
    .from('projects')
    .update({ is_paused: isPaused })
    .eq('id', projectId)
    .select('id, is_paused')
    .single();

  if (error) {
    throw new Error(`Could not update project status: ${error.message}`);
  }

  // Phase 11 retrofit: routed through the shared helper (lib/audit.js).
  // This action was already using the verified session's real email as
  // `actor` — Phase 4's own two inserts were the ones reconciled to match,
  // not this one; see lib/audit.js's own top comment.
  await logAuditEvent({
    actor: user.email,
    action: isPaused ? 'pause_project' : 'unpause_project',
    target: projectLabel || projectId,
    details: { project_id: projectId },
  });

  return { id: data.id, isPaused: data.is_paused };
}

/**
 * Schema-broadcast track, Phase 1: the one-time backfill for a project
 * that existed before 0004_project_connection_strings.sql and so has no
 * `db_connection_string` yet. Same shape of write as the tail end of
 * `createProjectAction` in projects/new/actions.js, just reachable from an
 * existing row instead of only at creation time.
 *
 * @param {string} accessToken
 * @param {{ projectId: string, projectLabel: string, connectionString: string }} args
 * @returns {Promise<{ id: string, hasConnectionString: boolean }>}
 */
export async function setProjectConnectionStringAction(
  accessToken,
  { projectId, projectLabel, connectionString }
) {
  const user = await requireAdminUser(accessToken);

  if (!projectId) throw new Error('projectId is required.');
  if (!connectionString?.trim()) {
    throw new Error('Postgres connection string is required.');
  }

  const admin = getRegistryAdminClient();

  const { data, error } = await admin
    .from('projects')
    .update({ db_connection_string: connectionString.trim() })
    .eq('id', projectId)
    .select('id, db_connection_string')
    .single();

  if (error) {
    throw new Error(`Could not save the connection string: ${error.message}`);
  }

  // Never logs the string itself — same care as createProjectAction.
  await logAuditEvent({
    actor: user.email,
    action: 'backfill_project_connection_string',
    target: projectLabel || projectId,
    details: { project_id: projectId },
  });

  return { id: data.id, hasConnectionString: Boolean(data.db_connection_string) };
}
