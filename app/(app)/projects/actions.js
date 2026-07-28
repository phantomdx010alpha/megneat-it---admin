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
 *
 * ── ADMIN_STATIC.md (device-delete/project-edit track), Phase 3 ─────────
 * `updateProjectAction`: the first general "edit this project's own stored
 * fields" action in this repo — everything above only ever inserted a new
 * project (`projects/new/actions.js`), toggled `is_paused`, or backfilled
 * `db_connection_string` once. This can change `label`/`notes`/
 * `supabase_url`/`supabase_anon_key`/`supabase_service_role_key` — any
 * subset, via a `fields` object where an omitted key means "leave
 * unchanged" (distinct from an explicit empty string, which is a real
 * edit for `notes` specifically — the only field allowed to be blanked
 * out; the other four can't be saved empty, since a project genuinely
 * needs all of them to function).
 *
 * Per this masterplan's own Background/House-style notes: editing a live
 * project's URL/anon key/service-role key is treated as genuinely
 * dangerous, not routine. This action itself does not block the edit —
 * there are legitimate reasons to fix a typo even on a project with active
 * clients — but it does look up how many `licenses` rows currently point
 * at this project and returns that count alongside the result, so Phase
 * 4's UI can warn proportionally to the real stakes rather than either
 * always warning or never warning.
 *
 * Every field actually changed is logged via `logAuditEvent()` as an
 * old-value → new-value pair — except `supabase_anon_key` and
 * `supabase_service_role_key`, where only a `changed: true` boolean is
 * recorded, never the values themselves. Same "never log secrets"
 * discipline `createProjectAction` and `setProjectConnectionStringAction`
 * already established for this exact pair of fields; this is not a new
 * decision, just the same one applied here too.
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

/**
 * ADMIN_STATIC.md (device-delete/project-edit track), Phase 3 — Project
 * edit: backend action, with the danger made explicit in its own contract.
 *
 * Updates any subset of a project's own stored fields. An omitted key in
 * `fields` means "leave unchanged"; an explicit empty string is only
 * accepted for `notes` (a real, legitimate way to clear it) — the other
 * four fields throw rather than silently save a blank value a project
 * can't actually function without.
 *
 * Returns `activeClientCount` alongside the updated row — how many
 * `licenses` rows currently point at this project — so callers (Phase 4's
 * edit UI) can warn proportionally to the real stakes rather than
 * guessing. This action itself never blocks on that count; there are
 * legitimate reasons to fix a typo even on a project with active clients,
 * per this masterplan's own Background note.
 *
 * @param {string} accessToken
 * @param {{
 *   projectId: string,
 *   fields: {
 *     label?: string, notes?: string,
 *     supabaseUrl?: string, anonKey?: string, serviceRoleKey?: string,
 *   },
 * }} args
 * @returns {Promise<{
 *   id: string, label: string, notes: string|null, supabaseUrl: string,
 *   hasAnonKey: boolean, hasServiceRoleKey: boolean,
 *   activeClientCount: number|null, changedFields: string[],
 * }>}
 */
export async function updateProjectAction(accessToken, { projectId, fields }) {
  const user = await requireAdminUser(accessToken);

  if (!projectId) throw new Error('projectId is required.');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('No fields to update were provided.');
  }

  const admin = getRegistryAdminClient();

  const { data: current, error: currentError } = await admin
    .from('projects')
    .select('id, label, notes, supabase_url, supabase_anon_key, supabase_service_role_key')
    .eq('id', projectId)
    .single();

  if (currentError || !current) {
    throw new Error('Could not find that project — it may have been deleted.');
  }

  // Maps the caller's camelCase field names (matching createProjectAction's
  // own convention in projects/new/actions.js) to this table's actual
  // column names.
  const FIELD_MAP = {
    label: 'label',
    notes: 'notes',
    supabaseUrl: 'supabase_url',
    anonKey: 'supabase_anon_key',
    serviceRoleKey: 'supabase_service_role_key',
  };
  const SENSITIVE_COLUMNS = new Set(['supabase_anon_key', 'supabase_service_role_key']);

  const updatePayload = {};
  for (const [inputKey, column] of Object.entries(FIELD_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(fields, inputKey)) continue;

    const raw = fields[inputKey];
    const trimmed = typeof raw === 'string' ? raw.trim() : raw;

    if (column === 'notes') {
      updatePayload.notes = trimmed || null;
      continue;
    }

    if (!trimmed) {
      throw new Error(`${inputKey} cannot be blank.`);
    }
    updatePayload[column] = trimmed;
  }

  if (Object.keys(updatePayload).length === 0) {
    throw new Error('No fields to update were provided.');
  }

  const { data: updated, error: updateError } = await admin
    .from('projects')
    .update(updatePayload)
    .eq('id', projectId)
    .select('id, label, notes, supabase_url, supabase_anon_key, supabase_service_role_key')
    .single();

  if (updateError) {
    throw new Error(`Could not update the project: ${updateError.message}`);
  }

  // Active-client count — a simple count query against the registry's own
  // `licenses` table, returned alongside the result (never blocking on
  // it) so Phase 4's UI can warn proportionally to the real stakes.
  const { count: activeClientCount, error: countError } = await admin
    .from('licenses')
    .select('license_key', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (countError) {
    // Non-fatal: the edit above already succeeded. Surfaced as null so
    // the caller can show "unknown" rather than a false 0.
    console.error(
      `[projects/actions.js] Could not read active-client count for ${projectId}:`,
      countError.message
    );
  }

  // Per-field audit trail — old value -> new value for every field that
  // actually changed, not just "project edited". Secrets are never
  // logged: for supabase_anon_key/supabase_service_role_key, only a
  // changed boolean is recorded, same discipline createProjectAction and
  // setProjectConnectionStringAction already established above.
  const changes = {};
  for (const column of Object.keys(updatePayload)) {
    const oldValue = current[column];
    const newValue = updated[column];
    if (oldValue === newValue) continue;
    changes[column] = SENSITIVE_COLUMNS.has(column) ? { changed: true } : { from: oldValue, to: newValue };
  }

  if (Object.keys(changes).length > 0) {
    await logAuditEvent({
      actor: user.email,
      action: 'edit_project',
      target: updated.label || projectId,
      details: { project_id: projectId, changes },
    });
  }

  return {
    id: updated.id,
    label: updated.label,
    notes: updated.notes,
    supabaseUrl: updated.supabase_url,
    hasAnonKey: Boolean(updated.supabase_anon_key),
    hasServiceRoleKey: Boolean(updated.supabase_service_role_key),
    activeClientCount: countError ? null : activeClientCount ?? 0,
    changedFields: Object.keys(changes),
  };
}

/**
 * ADMIN_STATIC.md (device-delete/project-edit track), Phase 4 gap, flagged
 * not guessed — the masterplan's own Phase 4 spec says the edit form
 * should be "pre-filled with current values" and show "Phase 3's own
 * active-client count plainly" *before* a submit attempt, but neither
 * Phase 3 nor Phase 4's own "Key files" list includes a read action to
 * load a single project's current values on page load — `updateProjectAction`
 * only ever returns the count *after* a write. Rather than have the edit
 * page silently start from blank fields (which would make "pre-filled"
 * false) or only learn the active-client count after the first save
 * attempt (too late to warn "before allowing a submit," per that phase's
 * own wording), this one small read action closes that gap.
 *
 * Mirrors `updateProjectAction`'s own "never echo secrets" discipline:
 * `supabase_anon_key`/`supabase_service_role_key` come back only as
 * booleans, never as values — same reason the edit form's own key fields
 * (Phase 4's UI) load blank rather than pre-filled, and typing something
 * into one is what "I want to change this" actually means there.
 *
 * @param {string} accessToken
 * @param {string} projectId
 * @returns {Promise<{
 *   id: string, label: string, notes: string|null, supabaseUrl: string,
 *   hasAnonKey: boolean, hasServiceRoleKey: boolean,
 *   activeClientCount: number|null,
 * }>}
 */
export async function getProjectForEditAction(accessToken, projectId) {
  await requireAdminUser(accessToken);

  if (!projectId) throw new Error('projectId is required.');

  const admin = getRegistryAdminClient();

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, label, notes, supabase_url, supabase_anon_key, supabase_service_role_key')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    throw new Error('Could not find that project — it may have been deleted.');
  }

  const { count: activeClientCount, error: countError } = await admin
    .from('licenses')
    .select('license_key', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (countError) {
    console.error(
      `[projects/actions.js] Could not read active-client count for ${projectId}:`,
      countError.message
    );
  }

  return {
    id: project.id,
    label: project.label,
    notes: project.notes,
    supabaseUrl: project.supabase_url,
    hasAnonKey: Boolean(project.supabase_anon_key),
    hasServiceRoleKey: Boolean(project.supabase_service_role_key),
    activeClientCount: countError ? null : activeClientCount ?? 0,
  };
}
