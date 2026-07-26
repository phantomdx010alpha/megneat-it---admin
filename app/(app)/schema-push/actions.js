'use server';

/**
 * app/(app)/schema-push/actions.js
 *
 * ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 3 — the pasted SQL
 * actually runs against every selected project now, one connection at a
 * time, with a full per-project success/failure report. This is what
 * Phase 2's `handleConfirmedRun` placeholder (app/(app)/schema-push/page.js)
 * pointed at without building — this file is that build.
 *
 * ── Reuses the same `pg` `Client` pattern as single-project provisioning
 * ────────────────────────────────────────────────────────────────────────
 * Same shape as `provisionProjectAction` in
 * app/(app)/projects/new/actions.js: a fresh `pg.Client` per project,
 * `ssl: { rejectUnauthorized: false }` for the same documented Supabase
 * connection reason, connect, run, then always `.end()`. The one real
 * difference: that action took its connection string as a one-time,
 * never-persisted form field; this one reads the stored
 * `db_connection_string` (0004_project_connection_strings.sql, Phase 1 of
 * this same track) for each selected project instead, since re-asking for
 * 5+ connection strings on every broadcast is exactly what this whole
 * track exists to avoid.
 *
 * ── Sequential, not parallel — a deliberate choice, not an oversight ────
 * The masterplan's own Phase 3 text is explicit: "run sequentially, not in
 * parallel (free-tier Postgres connection limits are real and shared
 * resources...)". The `for...of` loop below with an `await` per iteration
 * is what makes that true — no `Promise.all`, on purpose.
 *
 * ── One project failing never stops the others ──────────────────────────
 * Every per-project attempt is wrapped in its own try/catch; a caught
 * error is recorded on that project's own result entry and the loop moves
 * on to the next project regardless. Nothing here throws out of the loop
 * for a single project's failure — only truly request-level problems
 * (missing SQL, no projects selected, can't reach the registry itself to
 * look up which projects were selected) throw before the loop even
 * starts.
 *
 * ── Registry safety ──────────────────────────────────────────────────────
 * This only ever loops over rows already sitting in the registry's own
 * `projects` table (looked up by the exact ids the operator selected on
 * Phase 2's screen) — there is no path here that could reach the registry
 * database's own schema instead of a target project's, since the registry
 * connection (`getRegistryAdminClient`) and each target's direct Postgres
 * connection are two entirely separate clients, never conflated.
 *
 * ── Automatic retry: explicitly out of scope ────────────────────────────
 * A project that fails is reported clearly and left for the operator to
 * fix (bad SQL, bad connection string) and re-run manually. No retry loop
 * is built here, per the masterplan's own "Out of scope" line for this
 * phase — this is meant to be a rare, deliberate action, not something
 * that silently keeps hammering a broken project.
 *
 * ── Phase 4: folding a successful broadcast into the master schema file ──
 * After every selected project has been attempted, if — and only if —
 * every single one of them came back `'success'` (this track's own chosen
 * bar, out of the two the masterplan explicitly left open: "all selected,
 * non-failed projects succeeded" vs "at least one succeeded"; this file
 * uses **all selected projects succeeded, with zero failures**, full
 * stop), the submitted SQL is appended to
 * supabase/provisioning/target_project_schema.sql with a comment marking
 * when and how it was added. The reasoning, per the masterplan's own
 * words: appending schema that isn't actually live everywhere yet risks a
 * brand-new project silently diverging from the existing ones the moment
 * this file is next used to provision one. Any failure at all — even one
 * project out of five — skips the fold entirely; the operator fixes that
 * project (or its connection string) and re-runs the same SQL through
 * this same screen, which then folds it in once a clean all-success run
 * happens.
 *
 * This does not retry the failed projects itself (still out of scope, see
 * above) and does not re-run against the projects that already succeeded
 * — it only decides, once, whether *this run's* results clear the bar for
 * touching the master file.
 *
 * ── The idempotency check is a warning, not a linter or a rewrite ───────
 * `target_project_schema.sql` is re-run in full against a brand-new, empty
 * database for every future project, per its own file header — so SQL
 * folded into it needs to be safe to run on a database that has never
 * seen it before, which in practice means idempotent guards
 * (`create table if not exists`, `drop policy if exists` before
 * `create policy`, etc., matching that file's own existing conventions).
 * `checkIdempotencyHeuristic` below is a light, best-effort regex scan for
 * the single most common miss — a bare `create table` with no
 * `if not exists` — not a real SQL parser and not exhaustive. It only ever
 * produces a warning string surfaced back to the operator; it never
 * blocks the broadcast, never blocks the fold, and never rewrites the
 * operator's own submitted SQL, per this phase's own explicit
 * "Out of scope: automatically rewriting non-idempotent SQL."
 */

import fs from 'fs';
import path from 'path';
import { Client as PgClient } from 'pg';
import { requireAdminUser } from '@/lib/auth/server-session';
import { getRegistryAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit';

const TARGET_SCHEMA_PATH = path.join(
  process.cwd(),
  'supabase',
  'provisioning',
  'target_project_schema.sql'
);

/**
 * Best-effort, non-exhaustive scan for the single most common idempotency
 * miss in pasted SQL: a bare `create table` with no `if not exists`. This
 * is a heuristic warning surfaced to the operator, not a linter and not a
 * gate — see this file's own top comment for why it never blocks or
 * rewrites anything.
 *
 * @param {string} sql
 * @returns {string | null} a warning message, or null if nothing flagged
 */
function checkIdempotencyHeuristic(sql) {
  const bareCreateTable = /create\s+table\s+(?!if\s+not\s+exists)/i;
  if (bareCreateTable.test(sql)) {
    return (
      'This SQL contains a "create table" without "if not exists". It will still ' +
      'be folded into the master provisioning file, but since that file is re-run ' +
      'in full against every brand-new project, a non-idempotent statement like this ' +
      'could fail (or double-create) the next time it runs. Consider rewriting it as ' +
      '"create table if not exists" to match this file\'s own existing convention.'
    );
  }
  return null;
}

/**
 * Appends the given SQL to the end of target_project_schema.sql with a
 * clear comment marking when and how it was added, matching that file's
 * own existing comment style (a dashed section rule, then plain-English
 * context).
 *
 * @param {string} sql
 * @param {string} actorEmail
 */
function foldIntoMasterSchema(sql, actorEmail) {
  const existing = fs.readFileSync(TARGET_SCHEMA_PATH, 'utf-8');
  const timestamp = new Date().toISOString();

  const addition =
    `\n\n-- ----------------------------------------------------------------------------\n` +
    `-- Added ${timestamp} via the Schema Push broadcast tool (app/(app)/schema-push),\n` +
    `-- by ${actorEmail}, after a clean run against every selected active project.\n` +
    `-- See ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 4/5 for how this got here.\n` +
    `-- ----------------------------------------------------------------------------\n` +
    `${sql.trim()}\n`;

  fs.writeFileSync(TARGET_SCHEMA_PATH, existing + addition, 'utf-8');
}

/**
 * @param {{ id: string, label: string, db_connection_string: string | null, is_paused: boolean }} project
 * @param {string} sql
 * @returns {Promise<{ status: 'success' } | { status: 'failed', error: string }>}
 */
async function runAgainstOneProject(project, sql) {
  if (project.is_paused) {
    // Belt-and-suspenders: Phase 2's UI only offers non-paused projects for
    // selection, but this action is the actual security/consistency
    // boundary, not the UI — a paused project should never get a schema
    // push even if somehow passed in.
    return { status: 'failed', error: 'Project is paused — skipped.' };
  }

  if (!project.db_connection_string) {
    return {
      status: 'failed',
      error: 'No stored connection string for this project yet — back-fill it in from the Projects dashboard (Phase 1 of this track), then re-run.',
    };
  }

  const client = new PgClient({
    connectionString: project.db_connection_string,
    // Same reasoning as provisionProjectAction (app/(app)/projects/new/actions.js):
    // matches Supabase's own documented `pg` connection example for
    // direct/pooler connections.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(sql);
    return { status: 'success' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Runs the given SQL against every selected project, one at a time,
 * sequentially, continuing through individual failures.
 *
 * @param {string} accessToken
 * @param {{ sql: string, projectIds: string[] }} args
 * @returns {Promise<{
 *   results: Array<{ projectId: string, label: string, status: 'success'|'failed', error?: string }>,
 *   succeededCount: number,
 *   failedCount: number,
 *   foldedIntoMaster: boolean,
 *   foldSkippedReason: string | null,
 *   idempotencyWarning: string | null,
 * }>}
 */
export async function broadcastSchemaPushAction(accessToken, { sql, projectIds }) {
  const user = await requireAdminUser(accessToken);

  if (!sql?.trim()) {
    throw new Error('SQL is required.');
  }
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    throw new Error('At least one project must be selected.');
  }

  const admin = getRegistryAdminClient();

  // Look up exactly the selected rows, straight from the registry's own
  // `projects` table — never trust anything but `id` from the browser for
  // this; label/connection string/paused status are all re-fetched here
  // rather than taken on faith from Phase 2's client-side state.
  const { data: projects, error: lookupError } = await admin
    .from('projects')
    .select('id, label, db_connection_string, is_paused')
    .in('id', projectIds);

  if (lookupError) {
    throw new Error(`Could not load the selected projects from the registry: ${lookupError.message}`);
  }

  const projectsById = new Map((projects ?? []).map((p) => [p.id, p]));

  const results = [];

  // Sequential on purpose — see this file's own top comment.
  for (const projectId of projectIds) {
    const project = projectsById.get(projectId);

    if (!project) {
      // Selected on Phase 2's screen but no longer present in the registry
      // (e.g. removed between page load and confirming) — report it as a
      // failure for this project rather than silently skipping it.
      results.push({
        projectId,
        label: null,
        status: 'failed',
        error: 'This project no longer exists in the registry.',
      });
      continue;
    }

    const outcome = await runAgainstOneProject(project, sql);
    results.push({ projectId, label: project.label, ...outcome });
  }

  const succeededCount = results.filter((r) => r.status === 'success').length;
  const failedCount = results.length - succeededCount;

  // Phase 4: fold into supabase/provisioning/target_project_schema.sql,
  // but only on a clean run — this track's own chosen bar is *zero*
  // failures across every selected project, not just "at least one
  // succeeded." See this file's own top comment for the reasoning.
  let foldedIntoMaster = false;
  let foldSkippedReason = null;
  const idempotencyWarning = checkIdempotencyHeuristic(sql);

  if (failedCount > 0) {
    foldSkippedReason = `Not folded into the master provisioning file: ${failedCount} of ${results.length} project(s) failed. Fix the failure(s) and re-run this same SQL — it will fold in automatically once every selected project succeeds.`;
  } else {
    try {
      foldIntoMasterSchema(sql, user.email);
      foldedIntoMaster = true;
    } catch (err) {
      // A failure to write the master file is surfaced but never rolled
      // back against the projects it already, successfully, ran on —
      // those pushes are real and live regardless of whether this last
      // bookkeeping step succeeded. The operator can re-run to retry just
      // the fold, or edit target_project_schema.sql by hand.
      foldSkippedReason = `Every selected project succeeded, but writing to the master provisioning file failed: ${err.message}. The schema is still live on every project above — fix the file issue and re-run this same SQL to fold it in.`;
    }
  }

  // Never logs the SQL text's worth of secrets (there aren't any in SQL
  // text itself, but connection strings are never touched here either) —
  // just which projects, and the outcome, matching every other action's
  // "log the fact, not the payload" convention in this app.
  await logAuditEvent({
    actor: user.email,
    action: 'schema_push_broadcast',
    target: `${results.length} project(s)`,
    details: {
      project_ids: projectIds,
      succeeded_count: succeededCount,
      failed_count: failedCount,
      folded_into_master: foldedIntoMaster,
      results: results.map((r) => ({ projectId: r.projectId, label: r.label, status: r.status })),
    },
  });

  return { results, succeededCount, failedCount, foldedIntoMaster, foldSkippedReason, idempotencyWarning };
}
