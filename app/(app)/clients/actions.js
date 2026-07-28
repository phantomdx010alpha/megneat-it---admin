'use server';

/**
 * app/(app)/clients/actions.js
 *
 * Phase 7 — Client list/management. Two server actions:
 *
 *   - listClientsAction: every `licenses` row across every project, joined
 *     with the project's own label, plus enough to drive the
 *     active/expired/near-device-limit filter the masterplan's own Phase 7
 *     spec calls out.
 *   - updateClientAction: inline edit for `expires_at` and `max_devices`
 *     only — a plain registry-row update, per the masterplan's own note
 *     that "these two fields don't need to touch the target project's Auth
 *     user at all, only the registry."
 *
 * Phase 8 — Revoke/suspend/delete client flow. Two more server actions:
 *
 *   - suspendClientAction: the soft path. Flips `is_active` on the
 *     registry row only — the client's Auth login and target-project data
 *     are untouched, they just fail the shell/PWA's own registry lookup
 *     cleanly (per `LicenseService.cs`'s existing `is_active` check,
 *     which is exactly why this is enough on its own). Also used to
 *     reactivate — same action, opposite boolean — since the masterplan
 *     itself only calls suspend "soft" and reversible, and building a
 *     one-way suspend button with no way back would contradict that.
 *   - deleteClientAction: the hard, destructive path. Deletes the Auth
 *     user on the target project (GoTrue Admin API) and the registry row.
 *     Explicitly does NOT touch that client's actual data tables on their
 *     target project — see this function's own doc comment for why that's
 *     a deliberate line, not an oversight.
 *
 * ── Search fields: what "email" actually means here ─────────────────────
 * The masterplan says "search by email/company name." The registry's own
 * `licenses` row has no login-email column at all — that credential lives
 * only in the target project's own Auth (per Phase 6), and reaching into
 * every target project just to make search work would be a much heavier
 * (and slower) operation than a search box should be. `licenses` does have
 * `contact_email` (Phase 3's schema), which Phase 6 already defaults to
 * the login email whenever the operator leaves it blank — the common case.
 * Search matches against `contact_email` and `company_name`; it will not
 * find a client by login email in the rarer case that field was
 * deliberately set to something else. Flagging this rather than silently
 * pretending it's a full login-email search.
 *
 * ── "Near-device-limit": a filter the schema doesn't store directly ─────
 * `licenses.max_devices` lives in the registry, but how many devices a
 * client currently has *registered* lives in `device_registrations` on
 * their own target project (see supabase/provisioning/target_project_schema.sql,
 * SECTION 2) — a table this app hasn't read from before Phase 9's own
 * per-client detail view. Phase 7's own spec still explicitly asks for a
 * "near-device-limit" filter on *this* list page, so a lightweight,
 * read-only device count is pulled here too — one query per distinct
 * target project (grouped, not one query per license), using that
 * project's own stored service-role key, same pattern and same short
 * timeout as Phase 5's own reachability check. This is a narrower read
 * than Phase 9's eventual detail view (which will show name/last-seen per
 * device) — here it's only ever reduced to a count.
 *
 * "Near" itself isn't defined anywhere in either masterplan. Chose: active
 * device count >= max_devices - 1 (i.e. at the limit or one seat away) —
 * the point at which the operator would actually want a heads-up before a
 * client's next device registration gets rejected client-side. Reversible
 * threshold; nothing downstream depends on the exact number.
 *
 * If a target project can't be reached (timeout, bad/missing stored keys,
 * a free-tier project asleep), that project's licenses get
 * `deviceCount: null` rather than silently showing `0` — an unreachable
 * project's client should read as "unknown," not "no devices registered."
 *
 * ── Finding the Auth user to delete: a gap Phase 8 had to close itself ──
 * `deleteClientAction` needs the target project's Auth user id to call
 * `auth.admin.deleteUser(id)`. Nothing in the registry stores that id —
 * Phase 6's own `createClientAction` never persisted it, only the login
 * email at creation time (and that email isn't stored in the registry
 * either; see the search note above). Rather than retrofitting Phase 6 or
 * Phase 3's schema this phase (real schema/behavior change to an earlier,
 * already-shipped phase, which the masterplan's own house style treats as
 * something to flag, not silently do), this phase looks the user up by
 * the one thing that IS guaranteed to be on their Auth record and never
 * changes: `user_metadata.license_key`, stamped on at creation in the
 * same call (Phase 6's own requirement). `auth.admin.listUsers()` has no
 * metadata filter in the GoTrue Admin API, so this pages through that
 * target project's users (1000 per page, capped at 20 pages = 20,000
 * users) looking for a metadata match. Completely fine for a
 * single-operator tool's target projects; would need a real index/lookup
 * if any target project's user count ever got large enough for that cap
 * to matter, which is not this app's situation.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit';

const DEVICE_COUNT_TIMEOUT_MS = 5000;
const NEAR_DEVICE_LIMIT_MARGIN = 1;

/**
 * @param {{ id: string, supabase_url: string, supabase_service_role_key: string }} project
 * @returns {Promise<Map<string, number> | null>} count of active devices per license_key, or
 *   null if this project couldn't be reached.
 */
async function fetchActiveDeviceCounts(project) {
  if (!project.supabase_url || !project.supabase_service_role_key) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEVICE_COUNT_TIMEOUT_MS);

  try {
    const client = createClient(project.supabase_url, project.supabase_service_role_key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, opts) => fetch(url, { ...opts, signal: controller.signal }) },
    });

    const { data, error } = await client
      .from('device_registrations')
      .select('license_key')
      .eq('is_active', true);

    if (error) return null;

    const counts = new Map();
    for (const row of data ?? []) {
      counts.set(row.license_key, (counts.get(row.license_key) ?? 0) + 1);
    }
    return counts;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} accessToken
 * @returns {Promise<Array<{
 *   licenseKey: string, companyName: string, contactEmail: string|null,
 *   projectId: string, projectLabel: string, isActive: boolean,
 *   expiresAt: string|null, maxDevices: number, createdAt: string,
 *   deviceCount: number|null, isNearDeviceLimit: boolean
 * }>>}
 */
export async function listClientsAction(accessToken) {
  await requireAdminUser(accessToken);

  const admin = getRegistryAdminClient();

  const { data: licenses, error: licensesError } = await admin
    .from('licenses')
    .select(
      'license_key, company_name, contact_email, project_id, is_active, expires_at, max_devices, created_at'
    )
    .order('created_at', { ascending: false });

  if (licensesError) {
    throw new Error(`Could not load clients: ${licensesError.message}`);
  }

  const { data: projects, error: projectsError } = await admin
    .from('projects')
    .select('id, label, supabase_url, supabase_service_role_key');

  if (projectsError) {
    throw new Error(`Could not load projects: ${projectsError.message}`);
  }

  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));

  // One device-count query per distinct project actually referenced by a
  // license, not one per license — same "group first, query once"
  // discipline as Phase 5's own reachability check.
  const referencedProjectIds = [...new Set((licenses ?? []).map((l) => l.project_id))];
  const deviceCountsByProjectId = new Map(
    await Promise.all(
      referencedProjectIds.map(async (projectId) => {
        const project = projectById.get(projectId);
        if (!project) return [projectId, null];
        return [projectId, await fetchActiveDeviceCounts(project)];
      })
    )
  );

  return (licenses ?? []).map((row) => {
    const project = projectById.get(row.project_id);
    const countsForProject = deviceCountsByProjectId.get(row.project_id);
    const deviceCount = countsForProject ? countsForProject.get(row.license_key) ?? 0 : null;
    const isNearDeviceLimit =
      deviceCount !== null && deviceCount >= row.max_devices - NEAR_DEVICE_LIMIT_MARGIN;

    return {
      licenseKey: row.license_key,
      companyName: row.company_name,
      contactEmail: row.contact_email,
      projectId: row.project_id,
      projectLabel: project?.label ?? '(deleted project)',
      isActive: row.is_active,
      expiresAt: row.expires_at,
      maxDevices: row.max_devices,
      createdAt: row.created_at,
      deviceCount,
      isNearDeviceLimit,
    };
  });
}

/**
 * Inline edit for a client's expiry date and device limit. Registry-only —
 * never touches the client's Auth user on their target project (per the
 * masterplan's own Phase 7 "out of scope" note on editing login
 * credentials from here).
 *
 * @param {string} accessToken
 * @param {{ licenseKey: string, expiresAt: string|null, maxDevices: number }} fields
 * @returns {Promise<{ licenseKey: string, expiresAt: string|null, maxDevices: number }>}
 */
export async function updateClientAction(accessToken, { licenseKey, expiresAt, maxDevices }) {
  const user = await requireAdminUser(accessToken);

  if (!licenseKey) throw new Error('licenseKey is required.');

  const normalizedMaxDevices = Number(maxDevices);
  if (!Number.isFinite(normalizedMaxDevices) || normalizedMaxDevices <= 0) {
    throw new Error('Max devices must be a whole number greater than zero.');
  }

  const normalizedExpiresAt = expiresAt?.trim() ? expiresAt.trim() : null;

  const admin = getRegistryAdminClient();

  const { data, error } = await admin
    .from('licenses')
    .update({ expires_at: normalizedExpiresAt, max_devices: normalizedMaxDevices })
    .eq('license_key', licenseKey)
    .select('license_key, company_name, expires_at, max_devices, project_id')
    .single();

  if (error) {
    throw new Error(`Could not save changes for ${licenseKey}: ${error.message}`);
  }

  // BUGFIX (2026-07-25): this action previously only updated the registry's
  // own `licenses.max_devices` column and stopped there. That column is not
  // what the target project's `devices_insert_enforce_max` RLS policy
  // actually reads — that policy reads `user_metadata.max_devices` off the
  // client's own Auth session token, which this action never touched. Net
  // effect: editing a client's device limit here silently did nothing to
  // the limit actually being enforced — it would keep using whatever value
  // (or lack of one) was set on that Auth user at creation time forever.
  // This mirrors the exact fix just applied to the "Add client" flow
  // (clients/new/actions.js) — same root cause, this is the edit-time half
  // of it. A failure here is reported but does NOT roll back the registry
  // update above — the registry value the operator asked for is still
  // correct and saved; only the live enforcement may be stale until this
  // step is retried, which is a strictly better failure mode than silently
  // reporting success while leaving both out of sync.
  let metadataSyncWarning = null;
  try {
    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, label, supabase_url, supabase_service_role_key')
      .eq('id', data.project_id)
      .single();

    if (projectError || !project) {
      throw new Error('could not find the target project this client belongs to');
    }
    if (!project.supabase_url || !project.supabase_service_role_key) {
      throw new Error(`"${project.label}" is missing its stored URL or service-role key`);
    }

    const targetClient = createClient(project.supabase_url, project.supabase_service_role_key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authUser = await findAuthUserByLicenseKey(targetClient, licenseKey);
    if (!authUser) {
      throw new Error(`no matching Auth user found on "${project.label}" for this license`);
    }

    // Merge, don't replace — updateUserById's user_metadata overwrites the
    // whole object, and this must not silently drop license_key (or any
    // other field a future change adds) while only meaning to touch
    // max_devices.
    const { data: fullUser, error: getUserError } = await targetClient.auth.admin.getUserById(authUser.id);
    if (getUserError || !fullUser?.user) {
      throw new Error(`could not read the existing Auth user to merge metadata: ${getUserError?.message ?? 'unknown error'}`);
    }

    const { error: updateMetaError } = await targetClient.auth.admin.updateUserById(authUser.id, {
      user_metadata: { ...fullUser.user.user_metadata, max_devices: normalizedMaxDevices },
    });

    if (updateMetaError) {
      throw new Error(`could not update the Auth user's metadata: ${updateMetaError.message}`);
    }
  } catch (metaErr) {
    metadataSyncWarning =
      `Saved the new limit (${normalizedMaxDevices}) to the registry, but could not refresh it on the ` +
      `client's actual login (${metaErr.message}) — the OLD limit is still what's being enforced until ` +
      `this is retried.`;
  }

  await logAuditEvent({
    actor: user.email,
    action: 'edit_client',
    target: `${data.company_name} (${data.license_key})`,
    details: {
      license_key: licenseKey,
      expires_at: data.expires_at,
      max_devices: data.max_devices,
      metadata_sync_warning: metadataSyncWarning,
    },
  });

  return {
    licenseKey: data.license_key,
    expiresAt: data.expires_at,
    maxDevices: data.max_devices,
    warning: metadataSyncWarning,
  };
}

const LIST_USERS_PAGE_SIZE = 1000;
const LIST_USERS_MAX_PAGES = 20;

/**
 * Pages through a target project's Auth users looking for the one whose
 * `user_metadata.license_key` matches. See this file's own top comment
 * ("Finding the Auth user to delete") for why this is a page-and-scan
 * rather than a direct lookup.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} targetClient
 * @param {string} licenseKey
 * @returns {Promise<{ id: string, email: string } | null>}
 */
async function findAuthUserByLicenseKey(targetClient, licenseKey) {
  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page++) {
    const { data, error } = await targetClient.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Could not list users on the target project: ${error.message}`);
    }

    const users = data?.users ?? [];
    const match = users.find((u) => u.user_metadata?.license_key === licenseKey);
    if (match) return { id: match.id, email: match.email };

    if (users.length < LIST_USERS_PAGE_SIZE) break; // last page
  }
  return null;
}

/**
 * Suspend (soft) or reactivate a client — flips `licenses.is_active` on
 * the registry row only. The client's Auth login and their data on the
 * target project are untouched either way; a suspended client simply
 * fails the shell/PWA's own registry lookup cleanly, per that lookup's
 * existing `is_active` check.
 *
 * @param {string} accessToken
 * @param {{ licenseKey: string, companyName: string, isActive: boolean }} args
 *   `isActive: false` suspends, `isActive: true` reactivates.
 * @returns {Promise<{ licenseKey: string, isActive: boolean }>}
 */
export async function suspendClientAction(accessToken, { licenseKey, companyName, isActive }) {
  const user = await requireAdminUser(accessToken);

  if (!licenseKey) throw new Error('licenseKey is required.');

  const admin = getRegistryAdminClient();

  const { data, error } = await admin
    .from('licenses')
    .update({ is_active: isActive })
    .eq('license_key', licenseKey)
    .select('license_key, is_active')
    .single();

  if (error) {
    throw new Error(`Could not ${isActive ? 'reactivate' : 'suspend'} ${licenseKey}: ${error.message}`);
  }

  await logAuditEvent({
    actor: user.email,
    action: isActive ? 'reactivate_client' : 'suspend_client',
    target: `${companyName || 'Client'} (${licenseKey})`,
    details: { license_key: licenseKey },
  });

  return { licenseKey: data.license_key, isActive: data.is_active };
}

/**
 * Delete (hard) a client — removes their Auth user on the target project
 * AND their registry row. Explicitly confirmed by the caller re-supplying
 * the client's own company name as `confirmText`; verified again here
 * server-side rather than trusted from the client component, since a
 * destructive action's confirmation gate belongs on the server that can
 * actually enforce it, not just the UI that happens to render it.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────
 * Per the masterplan's own explicit "out of scope": this does not touch
 * the client's actual data tables (mst_ledger, trn_voucher, etc.) on their
 * target project. Their login and license are gone, so they can no longer
 * activate or sync, but their historical data rows are left in place —
 * accidentally wiping a client's live data history would be far worse
 * than leaving inactive rows behind, and this is a one-way door a
 * single-operator tool should never take automatically.
 *
 * ── Ordering, and why there's no rollback on the second half ────────────
 * Deletes the Auth user first, the registry row second. If the Auth
 * delete fails, nothing else is touched — safe to just retry. If the Auth
 * delete succeeds but the registry delete then fails, there's no
 * meaningful rollback available (an already-deleted Auth user can't be
 * recreated with the same id), so the thrown error says so explicitly and
 * names exactly what's left to clean up by hand — same "never leave a
 * silent half-done state" spirit as Phase 6's own rollback handling, even
 * though the specific recovery differs here since deletion isn't
 * reversible the way creation's rollback was.
 *
 * @param {string} accessToken
 * @param {{ licenseKey: string, confirmText: string }} args
 * @returns {Promise<{ licenseKey: string, companyName: string, projectLabel: string }>}
 */
export async function deleteClientAction(accessToken, { licenseKey, confirmText }) {
  const user = await requireAdminUser(accessToken);

  if (!licenseKey) throw new Error('licenseKey is required.');

  const admin = getRegistryAdminClient();

  const { data: license, error: licenseError } = await admin
    .from('licenses')
    .select('license_key, company_name, project_id')
    .eq('license_key', licenseKey)
    .single();

  if (licenseError || !license) {
    throw new Error('Could not find that client — it may have already been deleted.');
  }

  if ((confirmText || '').trim() !== license.company_name) {
    throw new Error('Confirmation text does not match the company name — nothing was deleted.');
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
      `"${project.label}" is missing its stored URL or service-role key — fix it under Projects before deleting this client.`
    );
  }

  const targetClient = createClient(project.supabase_url, project.supabase_service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Step 1: find and delete the Auth user, if one still exists. ────────
  const authUser = await findAuthUserByLicenseKey(targetClient, licenseKey);

  if (authUser) {
    const { error: deleteAuthError } = await targetClient.auth.admin.deleteUser(authUser.id);
    if (deleteAuthError) {
      throw new Error(
        `Could not delete the login for ${authUser.email} on "${project.label}": ` +
          `${deleteAuthError.message}. Nothing was deleted — safe to try again.`
      );
    }
  }
  // If no matching Auth user was found, there's nothing to delete on that
  // side (already removed by hand, or never existed) — proceed to clean
  // up the registry row rather than treat this as a blocking error.

  // ── Step 2: delete the registry row. ────────────────────────────────────
  const { error: deleteLicenseError } = await admin.from('licenses').delete().eq('license_key', licenseKey);

  if (deleteLicenseError) {
    throw new Error(
      `The login on "${project.label}" was deleted, but the registry row for ${licenseKey} could not be ` +
        `(${deleteLicenseError.message}). Go delete that row by hand in the registry project's own Table ` +
        `Editor, then this client will be fully removed.`
    );
  }

  await logAuditEvent({
    actor: user.email,
    action: 'delete_client',
    target: `${license.company_name} (${licenseKey})`,
    details: {
      license_key: licenseKey,
      project_id: project.id,
      auth_user_deleted: Boolean(authUser),
      note: 'Target-project data tables are not automatically wiped by this action.',
    },
  });

  return { licenseKey, companyName: license.company_name, projectLabel: project.label };
}
