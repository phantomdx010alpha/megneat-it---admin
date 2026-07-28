'use server';

/**
 * app/(app)/clients/[licenseKey]/actions.js
 *
 * Phase 9 — Device visibility per client. One server action:
 *
 *   - getClientDetailAction: loads a single `licenses` row (+ its project's
 *     label) from the registry, then reads that client's own
 *     `device_registrations` rows directly from their *target* project —
 *     name, last-seen, active/can_write, read-only. No editing from here;
 *     per the masterplan's own out-of-scope note, per-device
 *     `is_active`/`can_write` edits stay the client-facing PWA's job
 *     (`deviceManager.js`'s existing `updateDevice()`), not duplicated here.
 *
 * Phase 10 — License move/reassignment tool. Two more server actions:
 *
 *   - listMoveTargetProjectOptionsAction: every *other* connected project
 *     (the client's current project is excluded — "move to a different
 *     project" implies the destination isn't the one it's already on),
 *     same `{ id, label, notes, isPaused, licenseCount }` shape Phase 6's
 *     own picker already established, reused rather than re-invented. No
 *     "recommended" pick here, unlike Phase 6's create flow — this is a
 *     deliberate, manually-triggered reassignment, not a default-suggest
 *     moment, so the operator picks explicitly every time.
 *   - moveClientAction: the entire mechanical change the masterplan's own
 *     Phase 10 spec calls for — updates `licenses.project_id` on the
 *     registry row and nothing else. Does NOT touch the client's Auth
 *     login (still exists only on their *old* project, per this file's own
 *     "what this deliberately does not do" note below) and does NOT
 *     migrate any of their historical data tables — both explicitly out of
 *     scope per the masterplan, and both stated in the confirmation dialog
 *     the client detail page shows before calling this action.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────
 * Per the masterplan's own explicit scoping: a "move" here only ever
 * repoints the registry's own `licenses.project_id`. It does not create a
 * new Auth login on the destination project, does not delete the old one,
 * and does not copy any data table. The client's shell/PWA will notice the
 * registry now points elsewhere on its own next check-in (that's the
 * shell/PWA masterplan's own reassignment-detection phases' job, not
 * this one) and prompt them to reactivate there — at which point a new
 * Auth login gets created on the new project the same way Phase 6's
 * `createClientAction` already does it for a brand-new client. Until that
 * reactivation happens, the client's *old* login on their previous project
 * still technically exists but is now orphaned from the registry's own
 * point of view — a deliberate, masterplan-endorsed gap (leaving history
 * intact and re-authenticating on next contact) rather than an oversight.
 *
 * ── ADMIN_PANEL_DEVICE_DELETE_AND_PROJECT_EDIT_MASTERPLAN.md, Phase 1 ────
 * `deleteDeviceAction`: the first real write this file has ever made to a
 * *target* project's `device_registrations` table — everything above (Phase
 * 9/10) was read-only against that table or wrote only to the registry's
 * own `licenses` row. Deletes exactly one row, scoped by BOTH `license_key`
 * and `device_id` (never a bare `device_id` match alone — that masterplan's
 * own Phase 1 spec calls this out explicitly, matching the same
 * both-fields discipline every RLS policy on this table already uses; see
 * supabase/provisioning/target_project_schema.sql SECTION 2). Re-derives
 * the authoritative `project_id` from the license row server-side rather
 * than trusting a caller-supplied `projectId` blindly — same "the server
 * enforces it, not just the UI" discipline `moveClientAction` above already
 * applies to a caller-supplied `fromProjectId`. This is a pure Supabase-row
 * delete only; it does not, and per that masterplan's own Background note
 * cannot, notify or update any shell/PWA client already using that device —
 * see Phase 2's UI copy (this track's own next phase) for how that's stated
 * honestly to the operator.
 *
 * ── "Anon is enough" (Phase 9) — the masterplan's own suggestion didn't
 * hold up ─────────────────────────────────────────────────────────────────
 * Phase 9's spec suggests "anon or service-role key — anon is enough here
 * since this is a read-only display and RLS should already permit it the
 * same way the client's own PWA reads it." That reasoning doesn't actually
 * carry over: the client PWA reads its own devices as an *authenticated*
 * user, and `device_registrations`'s own RLS policy
 * (`users_can_register_own_devices`, see
 * supabase/provisioning/target_project_schema.sql SECTION 2) scopes to
 * `to authenticated using (license_key = (auth.jwt()->'user_metadata'->>
 * 'license_key'))`. This app has no JWT for the client whose devices it's
 * looking up — it's the *operator* looking up an arbitrary client's
 * devices, not that client looking up their own — so an anon-key request
 * here would be unauthenticated and RLS would return zero rows for every
 * client, not the right ones. Using the target project's stored
 * service-role key instead (bypasses RLS, same as this file's own
 * `fetchActiveDeviceCounts` in `app/(app)/clients/actions.js` already does
 * for Phase 7's near-device-limit column) — flagging the deviation from
 * the masterplan's own wording rather than silently building something
 * that would return empty device lists for every client.
 *
 * ── Reachability, not a hard failure (Phase 9) ───────────────────────────
 * A missing/misconfigured project credential or a sleeping free-tier
 * project shouldn't crash this page — it should read as "can't reach this
 * client's project right now," same spirit as Phase 5's own reachability
 * badge. `devicesError` is returned alongside (rather than instead of) the
 * client/project info the registry itself could still supply, so the page
 * can show what it knows and explain what it couldn't reach.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit';

const DEVICE_FETCH_TIMEOUT_MS = 5000;


/**
 * @param {string} accessToken
 * @param {string} licenseKey
 * @returns {Promise<{
 *   licenseKey: string, companyName: string, contactEmail: string|null,
 *   isActive: boolean, expiresAt: string|null, maxDevices: number,
 *   projectLabel: string,
 *   devices: Array<{ id: string, deviceId: string, deviceName: string|null,
 *     registeredAt: string|null, lastSeenAt: string|null, isActive: boolean,
 *     isMaster: boolean, canWrite: boolean }> | null,
 *   devicesError: string | null
 * }>}
 */
export async function getClientDetailAction(accessToken, licenseKey) {
  await requireAdminUser(accessToken);

  if (!licenseKey) throw new Error('licenseKey is required.');

  const admin = getRegistryAdminClient();

  const { data: license, error: licenseError } = await admin
    .from('licenses')
    .select('license_key, company_name, contact_email, project_id, is_active, expires_at, max_devices')
    .eq('license_key', licenseKey)
    .single();

  if (licenseError || !license) {
    throw new Error('Could not find that client — it may have been deleted.');
  }

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, label, supabase_url, supabase_service_role_key')
    .eq('id', license.project_id)
    .single();

  if (projectError || !project) {
    throw new Error('Could not find the target project this client belongs to.');
  }

  const base = {
    licenseKey: license.license_key,
    companyName: license.company_name,
    contactEmail: license.contact_email,
    isActive: license.is_active,
    expiresAt: license.expires_at,
    maxDevices: license.max_devices,
    projectId: project.id,
    projectLabel: project.label,
  };

  if (!project.supabase_url || !project.supabase_service_role_key) {
    return {
      ...base,
      devices: null,
      devicesError: `"${project.label}" is missing its stored URL or service-role key — fix it under Projects.`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEVICE_FETCH_TIMEOUT_MS);

  try {
    const targetClient = createClient(project.supabase_url, project.supabase_service_role_key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, opts) => fetch(url, { ...opts, signal: controller.signal }) },
    });

    const { data: devices, error: devicesError } = await targetClient
      .from('device_registrations')
      .select('id, device_id, device_name, registered_at, last_seen_at, is_active, is_master, can_write')
      .eq('license_key', licenseKey)
      .order('last_seen_at', { ascending: false, nullsFirst: false });

    if (devicesError) {
      return { ...base, devices: null, devicesError: `Could not read devices: ${devicesError.message}` };
    }

    return {
      ...base,
      devices: (devices ?? []).map((d) => ({
        id: d.id,
        deviceId: d.device_id,
        deviceName: d.device_name,
        registeredAt: d.registered_at,
        lastSeenAt: d.last_seen_at,
        isActive: d.is_active,
        isMaster: d.is_master,
        canWrite: d.can_write,
      })),
      devicesError: null,
    };
  } catch (err) {
    const message = err?.name === 'AbortError' ? `"${project.label}" did not respond in time.` : err.message;
    return { ...base, devices: null, devicesError: `Could not reach "${project.label}": ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every connected project except the one this license already points at —
 * the picker for Phase 10's "move to a different project" action. Same
 * `{ id, label, notes, isPaused, licenseCount }` shape as Phase 6's own
 * `listTargetProjectOptionsAction`, reused rather than re-derived, but with
 * no "recommended" pick: unlike creating a brand-new client, moving an
 * existing one is a deliberate, manually-triggered action the operator
 * should choose explicitly every time, not something to default-suggest.
 *
 * @param {string} accessToken
 * @param {string} currentProjectId
 * @returns {Promise<Array<{ id: string, label: string, notes: string|null, isPaused: boolean, licenseCount: number }>>}
 */
export async function listMoveTargetProjectOptionsAction(accessToken, currentProjectId) {
  await requireAdminUser(accessToken);

  const admin = getRegistryAdminClient();

  const { data: projects, error: projectsError } = await admin
    .from('projects')
    .select('id, label, notes, is_paused')
    .order('label', { ascending: true });

  if (projectsError) {
    throw new Error(`Could not load projects: ${projectsError.message}`);
  }

  const { data: licenseRows, error: licensesError } = await admin.from('licenses').select('project_id');

  if (licensesError) {
    throw new Error(`Could not load license counts: ${licensesError.message}`);
  }

  const countByProjectId = new Map();
  for (const row of licenseRows ?? []) {
    countByProjectId.set(row.project_id, (countByProjectId.get(row.project_id) ?? 0) + 1);
  }

  return (projects ?? [])
    .filter((p) => p.id !== currentProjectId)
    .map((p) => ({
      id: p.id,
      label: p.label,
      notes: p.notes,
      isPaused: p.is_paused,
      licenseCount: countByProjectId.get(p.id) ?? 0,
    }));
}

/**
 * Moves a client to a different project — the entire mechanical change per
 * the masterplan's own Phase 10 spec: repoints `licenses.project_id` and
 * writes an audit entry. Nothing else. See this file's own top comment
 * ("What this deliberately does NOT do") for why the client's Auth login
 * and historical data are untouched, and what that implies until the
 * client's shell/PWA next checks in.
 *
 * Re-reads the license row server-side first (rather than trusting a
 * `fromProjectId` blindly passed from the client component) so a stale
 * page can't silently move a client whose project changed from underneath
 * it since the page loaded — same "the server enforces it, not just the
 * UI" discipline as `deleteClientAction`'s own confirmation check.
 *
 * @param {string} accessToken
 * @param {{ licenseKey: string, companyName: string, toProjectId: string }} args
 * @returns {Promise<{ licenseKey: string, projectId: string, projectLabel: string }>}
 */
export async function moveClientAction(accessToken, { licenseKey, companyName, toProjectId }) {
  const user = await requireAdminUser(accessToken);

  if (!licenseKey) throw new Error('licenseKey is required.');
  if (!toProjectId) throw new Error('Pick a destination project.');

  const admin = getRegistryAdminClient();

  const { data: license, error: licenseError } = await admin
    .from('licenses')
    .select('license_key, company_name, project_id')
    .eq('license_key', licenseKey)
    .single();

  if (licenseError || !license) {
    throw new Error('Could not find that client — it may have already been deleted.');
  }

  if (license.project_id === toProjectId) {
    throw new Error('That is already this client\u2019s current project — pick a different one.');
  }

  const { data: toProject, error: toProjectError } = await admin
    .from('projects')
    .select('id, label')
    .eq('id', toProjectId)
    .single();

  if (toProjectError || !toProject) {
    throw new Error('Could not find the selected destination project — pick again.');
  }

  const { data: fromProject } = await admin
    .from('projects')
    .select('id, label')
    .eq('id', license.project_id)
    .maybeSingle();

  const { data: updated, error: updateError } = await admin
    .from('licenses')
    .update({ project_id: toProjectId })
    .eq('license_key', licenseKey)
    .select('license_key, project_id')
    .single();

  if (updateError) {
    throw new Error(`Could not move ${licenseKey} to "${toProject.label}": ${updateError.message}`);
  }

  await logAuditEvent({
    actor: user.email,
    action: 'move_client',
    target: `${companyName || license.company_name || 'Client'} (${licenseKey})`,
    details: {
      license_key: licenseKey,
      from_project_id: license.project_id,
      from_project_label: fromProject?.label ?? '(unknown)',
      to_project_id: toProjectId,
      to_project_label: toProject.label,
    },
  });

  return { licenseKey: updated.license_key, projectId: updated.project_id, projectLabel: toProject.label };
}

/**
 * ADMIN_PANEL_DEVICE_DELETE_AND_PROJECT_EDIT_MASTERPLAN.md, Phase 1 —
 * Device delete: backend action.
 *
 * Permanently removes one row from `device_registrations` on this client's
 * *target* project (never the registry itself — that table doesn't exist
 * there). Scoped by BOTH `license_key` and `device_id`, never a bare
 * `device_id` match alone, per that masterplan's own explicit instruction —
 * see this file's top comment for the full reasoning.
 *
 * `projectId` is accepted (matching the masterplan's own documented
 * signature) but is only ever used as a staleness check against the
 * license row's own, freshly-read `project_id` — the value actually used
 * to look up the project's connection details is always the server's own,
 * never trusted blindly from the caller. If a caller doesn't have it yet,
 * omitting it (undefined) skips the check rather than failing closed.
 *
 * @param {string} accessToken
 * @param {{ licenseKey: string, deviceId: string, projectId?: string }} args
 * @returns {Promise<{ deviceId: string, deviceName: string|null, licenseKey: string }>}
 */
export async function deleteDeviceAction(accessToken, { licenseKey, deviceId, projectId }) {
  const user = await requireAdminUser(accessToken);

  if (!licenseKey) throw new Error('licenseKey is required.');
  if (!deviceId) throw new Error('deviceId is required.');

  const admin = getRegistryAdminClient();

  const { data: license, error: licenseError } = await admin
    .from('licenses')
    .select('license_key, company_name, project_id')
    .eq('license_key', licenseKey)
    .single();

  if (licenseError || !license) {
    throw new Error('Could not find that client — it may have already been deleted.');
  }

  // Staleness check only — the project actually queried below always comes
  // from license.project_id (just read fresh above), never from this
  // caller-supplied value. Same "the server enforces it, not just the UI"
  // discipline moveClientAction above already applies to a caller-supplied
  // fromProjectId: a stale page shouldn't be able to act against the wrong
  // project if this client was moved since the page loaded.
  if (projectId && projectId !== license.project_id) {
    throw new Error(
      'That client no longer belongs to the project this page loaded for — refresh the page and try again.'
    );
  }

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, label, supabase_url, supabase_service_role_key')
    .eq('id', license.project_id)
    .single();

  if (projectError || !project) {
    throw new Error('Could not find the target project this client belongs to — nothing was deleted.');
  }
  if (!project.supabase_url || !project.supabase_service_role_key) {
    throw new Error(
      `"${project.label}" is missing its stored URL or service-role key — fix it under Projects before deleting this device.`
    );
  }

  const targetClient = createClient(project.supabase_url, project.supabase_service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Scoped by BOTH fields — see this file's top comment for why, even
  // though device_registrations' own `unique(device_id)` constraint means
  // a cross-license collision can't actually happen under today's schema.
  const { data: deleted, error: deleteError } = await targetClient
    .from('device_registrations')
    .delete()
    .eq('license_key', licenseKey)
    .eq('device_id', deviceId)
    .select('id, device_id, device_name')
    .maybeSingle();

  if (deleteError) {
    throw new Error(`Could not delete that device on "${project.label}": ${deleteError.message}`);
  }

  if (!deleted) {
    throw new Error(
      'That device was not found on its target project — it may have already been removed by someone else.'
    );
  }

  await logAuditEvent({
    actor: user.email,
    action: 'delete_device',
    target: `${deleted.device_name || deviceId} — ${license.company_name} (${licenseKey})`,
    details: {
      license_key: licenseKey,
      device_id: deviceId,
      device_name: deleted.device_name,
      project_id: project.id,
      project_label: project.label,
    },
  });

  return { deviceId, deviceName: deleted.device_name, licenseKey };
}
