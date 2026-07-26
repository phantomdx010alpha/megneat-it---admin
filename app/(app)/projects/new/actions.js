'use server';

/**
 * app/(app)/projects/new/actions.js
 *
 * Two server actions, matching the masterplan's "same action or a
 * follow-up one" flexibility literally — the form (page.js) offers both
 * as separate buttons so the operator can add a project now and provision
 * it later, or do both in one step.
 *
 *   - createProjectAction:   inserts the registry `projects` row.
 *   - provisionProjectAction: runs the sanitized target-project schema
 *                              against a project via a direct Postgres
 *                              connection, and confirms what got created.
 *
 * ── A gap in the masterplan's own form spec, flagged not guessed ──────────
 * Phase 4's "In scope" text lists the form fields as label/URL/anon
 * key/service-role key/notes, but then says provisioning "connects to the
 * new project's Postgres directly (Supabase gives every project a direct
 * connection string, separate from the REST/anon/service keys...)". A
 * direct Postgres connection string is a distinct credential (includes the
 * DB password) that none of the listed form fields capture — it can't be
 * derived from the URL/anon/service-role keys. So `provisionProjectAction`
 * below takes that connection string as its own explicit argument; the
 * form has a field for it (see page.js).
 *
 * ── Updated by ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 1 ─────────
 * Originally (this comment used to say) that connection string was "used
 * only in-memory for this one request and never persisted." That's no
 * longer true, on purpose: the schema-broadcast tool (see that masterplan)
 * needs to reach every active project's Postgres on demand, without asking
 * the operator to re-paste 5+ connection strings every time a schema
 * change goes out. So `createProjectAction` below now also stores it, if
 * supplied, into `projects.db_connection_string`
 * (0004_project_connection_strings.sql) — see that migration's own top
 * comment for the explicit plaintext-vs-encrypted-at-rest decision this
 * involved. Still never echoed back to the browser.
 */

import { Client as PgClient } from 'pg';
import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit';
import fs from 'fs';
import path from 'path';

/**
 * Inserts a new row into the registry's `projects` table.
 *
 * @param {string} accessToken
 * @param {{ label: string, supabaseUrl: string, anonKey: string, serviceRoleKey: string, notes?: string, connectionString?: string }} fields
 * @returns {Promise<{ id: string, label: string, hasConnectionString: boolean }>} safe
 *   subset — never echoes back anon_key/service_role_key/db_connection_string
 */
export async function createProjectAction(accessToken, fields) {
  const user = await requireAdminUser(accessToken);

  const { label, supabaseUrl, anonKey, serviceRoleKey, notes, connectionString } = fields;

  if (!label?.trim()) throw new Error('Label is required.');
  if (!supabaseUrl?.trim()) throw new Error('Supabase project URL is required.');
  if (!anonKey?.trim()) throw new Error('Anon key is required.');
  if (!serviceRoleKey?.trim()) throw new Error('Service-role key is required.');

  const admin = getRegistryAdminClient();

  // Schema-broadcast track, Phase 1: store the connection string alongside
  // the other fields when the operator supplies one at creation time, so
  // this project never needs the one-time backfill prompt
  // (app/(app)/projects/page.js) later — it already has what Phase 3's
  // broadcast tool will need. Still fully optional here: a project can be
  // saved (and even provisioned once, transiently) without ever storing
  // one, same as before this track existed.
  const trimmedConnectionString = connectionString?.trim() || null;

  const { data, error } = await admin
    .from('projects')
    .insert({
      label: label.trim(),
      supabase_url: supabaseUrl.trim(),
      supabase_anon_key: anonKey.trim(),
      supabase_service_role_key: serviceRoleKey.trim(),
      notes: notes?.trim() || null,
      db_connection_string: trimmedConnectionString,
    })
    .select('id, label')
    .single();

  if (error) {
    throw new Error(`Could not save the project: ${error.message}`);
  }

  // Phase 11 retrofit: routed through the shared helper, and now logs the
  // verified session's real email as `actor` rather than Phase 4's
  // original hardcoded 'admin' string — see lib/audit.js's own top
  // comment for why that reconciliation belongs here. Never logs secrets —
  // the detail below is a boolean (was a connection string stored, yes/no),
  // never the string itself.
  await logAuditEvent({
    actor: user.email,
    action: 'create_project',
    target: data.label,
    details: {
      project_id: data.id,
      supabase_url: supabaseUrl.trim(),
      connection_string_stored: Boolean(trimmedConnectionString),
    },
  });

  return { ...data, hasConnectionString: Boolean(trimmedConnectionString) };
}

/**
 * Connects directly to a target project's Postgres and runs the sanitized
 * provisioning schema (supabase/provisioning/target_project_schema.sql).
 *
 * @param {string} accessToken
 * @param {{ projectId: string, projectLabel: string, connectionString: string }} args
 * @returns {Promise<{ tablesCreated: string[] }>}
 */
export async function provisionProjectAction(accessToken, { projectId, projectLabel, connectionString }) {
  const user = await requireAdminUser(accessToken);

  if (!connectionString?.trim()) {
    throw new Error('Postgres connection string is required to provision.');
  }

  const sqlPath = path.join(process.cwd(), 'supabase', 'provisioning', 'target_project_schema.sql');
  const script = fs.readFileSync(sqlPath, 'utf-8');

  const client = new PgClient({
    connectionString: connectionString.trim(),
    // Supabase's direct/pooler connections are TLS but not always signed by
    // a CA in Node's default trust store depending on connection type —
    // this matches Supabase's own documented `pg` connection example.
    ssl: { rejectUnauthorized: false },
  });

  let tablesCreated = [];

  try {
    await client.connect();
    await client.query(script);

    const { rows } = await client.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    );
    tablesCreated = rows.map((r) => r.table_name);
  } catch (err) {
    throw new Error(`Provisioning failed: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }

  if (projectId) {
    await logAuditEvent({
      actor: user.email,
      action: 'provision_project',
      target: projectLabel || projectId,
      details: { project_id: projectId, tables_created: tablesCreated.length },
    });
  }

  return { tablesCreated };
}
