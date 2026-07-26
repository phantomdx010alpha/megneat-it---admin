'use server';

/**
 * app/(app)/clients/new/actions.js
 *
 * Phase 6 — the core deliverable. Two server actions:
 *
 *   - listTargetProjectOptionsAction: projects to populate the
 *     target-project picker, plus which one to suggest by default.
 *   - createClientAction: the atomic-as-possible "add a client" flow —
 *     create their Auth login on the target project, then register their
 *     license in the registry, with rollback if the second step fails
 *     after the first succeeded.
 *
 * ── "Default to whichever project Phase 5's dashboard suggests has
 * room" ─────────────────────────────────────────────────────────────────
 * Phase 5's dashboard has no explicit "suggested" flag or ranking — it
 * just shows license counts and a paused toggle side by side and leaves
 * the human to look. Interpreting "suggests" as: among non-paused
 * projects, the one with the fewest licenses currently pointing at it —
 * the same signal a human skimming that dashboard would use. Reachability
 * is deliberately NOT part of this ranking (unlike Phase 5's dashboard,
 * which does check it): re-running a per-project network probe every time
 * this form loads would slow down the one flow the masterplan explicitly
 * calls "maximum user-friendly," for a signal (transient reachability)
 * that's a poor proxy for "has room" anyway. A genuinely down project can
 * still be picked here — the operator sees it's paused (if it is) and can
 * override, same as the masterplan's own "let the operator override"
 * line already assumes they might need to.
 *
 * ── Rollback behavior ───────────────────────────────────────────────────
 * The masterplan requires "clear rollback/retry messaging if partway
 * through and something fails — don't leave a half-created client
 * silently dangling." The Auth-user-create call and the registry insert
 * can't be wrapped in one Postgres transaction (they're two different
 * databases, reached over two different connections). So: if the registry
 * insert fails after the target project's Auth user was already created,
 * this action makes a best-effort call to delete that just-created Auth
 * user before throwing — collapsing back to "nothing happened" rather
 * than leaving an orphaned login with no matching license. If the
 * rollback delete itself fails too, the thrown error says so explicitly,
 * with the email and target project named, so the operator knows exactly
 * what to go clean up by hand rather than silently losing track of it.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit';
import { generateLicenseKey, generatePassword } from '@/lib/licensing/keys';

const MAX_LICENSE_KEY_ATTEMPTS = 5;

/**
 * @param {string} accessToken
 * @returns {Promise<{
 *   options: Array<{ id: string, label: string, notes: string|null, isPaused: boolean, licenseCount: number }>,
 *   recommendedProjectId: string|null
 * }>}
 */
export async function listTargetProjectOptionsAction(accessToken) {
  await requireAdminUser(accessToken);

  const admin = getRegistryAdminClient();

  const { data: projects, error: projectsError } = await admin
    .from('projects')
    .select('id, label, notes, is_paused')
    .order('label', { ascending: true });

  if (projectsError) {
    throw new Error(`Could not load projects: ${projectsError.message}`);
  }

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

  const options = (projects ?? []).map((p) => ({
    id: p.id,
    label: p.label,
    notes: p.notes,
    isPaused: p.is_paused,
    licenseCount: countByProjectId.get(p.id) ?? 0,
  }));

  const eligible = options.filter((o) => !o.isPaused);
  const recommended = eligible.sort((a, b) => a.licenseCount - b.licenseCount)[0] ?? null;

  return { options, recommendedProjectId: recommended?.id ?? null };
}

/**
 * @param {string} accessToken
 * @param {{
 *   email: string,
 *   password?: string,           // blank/omitted => auto-generate
 *   companyName: string,
 *   contactEmail?: string,       // blank => defaults to `email`
 *   expiresAt?: string,          // ISO date, blank => never expires
 *   maxDevices?: number,         // blank => 5
 *   projectId: string,
 * }} fields
 * @returns {Promise<{
 *   licenseKey: string, companyName: string, projectLabel: string,
 *   email: string, generatedPassword: string|null
 * }>}
 */
export async function createClientAction(accessToken, fields) {
  const user = await requireAdminUser(accessToken);

  const email = fields.email?.trim();
  const companyName = fields.companyName?.trim();
  const contactEmail = fields.contactEmail?.trim() || email;
  const projectId = fields.projectId;
  const maxDevices = Number.isFinite(fields.maxDevices) && fields.maxDevices > 0 ? fields.maxDevices : 5;
  const expiresAt = fields.expiresAt?.trim() || null;
  const password = fields.password?.trim() || generatePassword();
  const wasAutoGenerated = !fields.password?.trim();

  if (!email) throw new Error('Login email is required.');
  if (!companyName) throw new Error('Company name is required.');
  if (!projectId) throw new Error('Pick a target project.');

  const admin = getRegistryAdminClient();

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, label, supabase_url, supabase_service_role_key')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    throw new Error('Could not find the selected target project — pick again.');
  }
  if (!project.supabase_url || !project.supabase_service_role_key) {
    throw new Error(`"${project.label}" is missing its stored URL or service-role key — fix it under Projects first.`);
  }

  const targetClient = createClient(project.supabase_url, project.supabase_service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Step 1: generate a unique license key, retrying on a real
  // primary-key collision only (not on other kinds of failure). ─────────
  let licenseKey = null;
  let lastKeyError = null;
  for (let attempt = 0; attempt < MAX_LICENSE_KEY_ATTEMPTS; attempt++) {
    const candidate = generateLicenseKey();
    const { data: existing, error: lookupError } = await admin
      .from('licenses')
      .select('license_key')
      .eq('license_key', candidate)
      .maybeSingle();

    if (lookupError) {
      lastKeyError = lookupError;
      continue;
    }
    if (!existing) {
      licenseKey = candidate;
      break;
    }
  }
  if (!licenseKey) {
    throw new Error(
      `Could not generate a unique license key after ${MAX_LICENSE_KEY_ATTEMPTS} attempts` +
        (lastKeyError ? `: ${lastKeyError.message}` : '.') +
        ' Nothing was created — safe to just try again.'
    );
  }

  // ── Step 2: create the Auth user on the target project, with the
  // license key already attached, per the masterplan's own "already
  // attached in the same call" requirement.
  //
  // BUGFIX (2026-07-25): max_devices must be in user_metadata too, not just
  // the registry's `licenses.max_devices` column. The target project's own
  // `devices_insert_enforce_max` RLS policy (MASTER_SQL_TARGET_PROJECT.sql)
  // reads its limit from auth.jwt()->'user_metadata'->>'max_devices' —
  // that's the ONLY place it can read it from, since the target project no
  // longer has a local `licenses` table to join against. That policy was
  // deliberately written to fail CLOSED when this metadata is missing
  // (coalesce(..., 0) — "no limit found" is treated as "zero allowed", never
  // as "unlimited"). Before this fix, every client created through this
  // form was missing this field, which meant every single device
  // registration insert was being silently rejected by RLS from the
  // moment that policy was deployed — and silently, because
  // deviceManager.js#registerDevice() on the PWA side deliberately doesn't
  // throw on an RLS rejection (treats it as "policy not set up yet, don't
  // block login"). Net effect: devices_registrations stayed empty for
  // every client, with no error surfaced anywhere. This was flagged as a
  // required companion change when the policy was written and never
  // actually applied until now. ─────────────────────────────────────────
  const { data: authData, error: authError } = await targetClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { license_key: licenseKey, max_devices: maxDevices },
  });

  if (authError) {
    throw new Error(`Could not create the client's login on "${project.label}": ${authError.message}`);
  }

  // ── Step 3: register the license in the registry. If this fails, roll
  // the Auth user back rather than leave an orphaned login. ─────────────
  const { error: licenseError } = await admin.from('licenses').insert({
    license_key: licenseKey,
    company_name: companyName,
    contact_email: contactEmail,
    project_id: projectId,
    is_active: true,
    expires_at: expiresAt,
    max_devices: maxDevices,
  });

  if (licenseError) {
    const { error: rollbackError } = await targetClient.auth.admin.deleteUser(authData.user.id);

    if (rollbackError) {
      throw new Error(
        `Registry insert failed (${licenseError.message}), AND the rollback of the ` +
          `just-created login for ${email} on "${project.label}" also failed ` +
          `(${rollbackError.message}). Nothing was left half-done silently — go delete ` +
          `that Auth user by hand in ${project.label}'s own Supabase Studio, then retry.`
      );
    }

    throw new Error(
      `Could not save the license (${licenseError.message}). The login that was about to be ` +
        `created for ${email} was rolled back — nothing was left half-created. Safe to try again.`
    );
  }

  // Phase 11 retrofit: routed through the shared helper (lib/audit.js).
  await logAuditEvent({
    actor: user.email,
    action: 'create_client',
    target: `${companyName} (${licenseKey})`,
    details: { license_key: licenseKey, project_id: projectId, email },
    // Never logs the password, generated or manual.
  });

  return {
    licenseKey,
    companyName,
    projectLabel: project.label,
    email,
    generatedPassword: wasAutoGenerated ? password : null,
  };
}
