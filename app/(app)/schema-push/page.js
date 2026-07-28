'use client';

/**
 * app/(app)/schema-push/page.js
 *
 * ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 2 — the broadcast UI:
 * paste SQL, pick which currently-active projects it should run against,
 * and require a genuine confirmation step before anything is allowed to
 * proceed. See that masterplan's own Phase 2 section for the exact spec
 * this implements.
 *
 * ── What this screen does and doesn't do ────────────────────────────────
 * Phase 2 built the paste-SQL / pick-projects / confirm gate: the confirm
 * button inside the BottomSheet stays disabled until the operator types
 * CONFIRM, exactly like the client-delete flow's own
 * type-the-company-name pattern in app/(app)/clients/page.js. Phase 3 (see
 * below) is what makes confirming actually do something.
 *
 * ── Where the project list comes from ───────────────────────────────────
 * Reuses `listProjectsWithStatusAction` from the Projects dashboard
 * (app/(app)/projects/actions.js) rather than duplicating a second
 * "load every project" query — same registry table, same shape needed
 * here (label, is_paused, hasConnectionString). Non-paused projects
 * (`projects.is_paused`, added in 0003_project_status.sql) are the
 * selectable list, per the masterplan's own "every non-paused project"
 * wording; paused ones are surfaced as an excluded count instead of being
 * silently dropped with no trace.
 *
 * A project missing a stored connection string (Phase 1's
 * `db_connection_string`, possibly still un-backfilled) is flagged inline
 * rather than hidden or force-excluded — see Phase 3's own handling of
 * exactly this condition in app/(app)/schema-push/actions.js.
 *
 * ── Updated by ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 3 ───────
 * `handleConfirmedRun` below used to stop at the confirmation step and
 * show a "not wired up yet" placeholder banner. It now actually calls
 * `broadcastSchemaPushAction` (app/(app)/schema-push/actions.js) and
 * renders that action's real per-project success/failure list — see that
 * file's own top comment for how the run itself works (sequential,
 * continues through individual failures, never parallel).
 *
 * ── Updated by ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 4 ───────
 * The results card now also surfaces whether this run's SQL got folded
 * into supabase/provisioning/target_project_schema.sql — either a
 * confirmation that it did (only possible when every selected project
 * came back success), or the specific reason it didn't (any failure at
 * all, or a fold-step error even after every project succeeded) — plus
 * a best-effort idempotency warning if the pasted SQL looked like it
 * might not be safe to re-run against a brand-new database later. See
 * app/(app)/schema-push/actions.js's own top comment for the full
 * reasoning behind the all-succeeded bar and the warning-not-linter
 * heuristic.
 *
 * ── Updated by ADMIN_PANEL_DEVICE_DELETE_AND_PROJECT_EDIT_MASTERPLAN.md,
 * Phase 5 ──────────────────────────────────────────────────────────────
 * A "History" card now sits below the SQL/projects form, loaded via the
 * new `listSchemaPushHistoryAction` (./actions.js) — every past
 * `schema_push_broadcast` audit entry, most-recent-first, each row
 * expandable to its own per-project outcome, purpose-built for this
 * screen instead of the operator having to go find the same entries in
 * the general Activity feed. Reloaded after every run in this session
 * (not just once on mount) so a just-completed push shows up at the top
 * immediately.
 *
 * One thing this history view genuinely can't show, and says so rather
 * than pretending otherwise: the SQL text that was actually submitted,
 * and a failed project's specific error message. Neither is in the audit
 * log entry itself — see ./actions.js's own top comment for exactly what
 * `details` does and doesn't hold, and why adding either now would be new
 * logging, which this phase's own scope rules out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Warning,
  PlayCircle,
  CheckSquare,
  Square,
  CheckCircle,
  XCircle,
  ClockCounterClockwise,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import BottomSheet from '@/components/ui/BottomSheet';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { getSession } from '@/lib/auth/session';
import { listProjectsWithStatusAction } from '../projects/actions';
import { broadcastSchemaPushAction, listSchemaPushHistoryAction } from './actions';

const CONFIRM_WORD = 'CONFIRM';

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SchemaPushPage() {
  const router = useRouter();

  const [loadStatus, setLoadStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [allProjects, setAllProjects] = useState([]);

  const [sql, setSql] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  // runStatus: 'idle' | 'running' | 'done' | 'error'
  // runError is for request-level failures (e.g. couldn't reach the
  // registry to look up the selected projects) — distinct from a
  // per-project failure, which lives inside runResult.results instead.
  const [runStatus, setRunStatus] = useState('idle');
  const [runError, setRunError] = useState(null);
  const [runResult, setRunResult] = useState(null);

  // Phase 5: schema-push history state, loaded independently of the
  // projects/form load above so a failure loading one never blocks the
  // other.
  const [historyStatus, setHistoryStatus] = useState('loading'); // loading | ready | error
  const [historyError, setHistoryError] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  async function withToken() {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      throw new Error('Session expired.');
    }
    return session.access_token;
  }

  const load = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError(null);
    try {
      const token = await withToken();
      const rows = await listProjectsWithStatusAction(token);
      setAllProjects(rows);
      // Default: every non-paused project starts checked, per the
      // masterplan's own "default: all checked" instruction.
      setSelectedIds(new Set(rows.filter((r) => !r.isPaused).map((r) => r.id)));
      setLoadStatus('ready');
    } catch (err) {
      setLoadError(err.message);
      setLoadStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadHistory = useCallback(async () => {
    setHistoryStatus('loading');
    setHistoryError(null);
    try {
      const token = await withToken();
      const rows = await listSchemaPushHistoryAction(token);
      setHistoryRows(rows);
      setHistoryStatus('ready');
    } catch (err) {
      setHistoryError(err.message);
      setHistoryStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const selectableProjects = useMemo(() => allProjects.filter((p) => !p.isPaused), [allProjects]);
  const pausedCount = allProjects.length - selectableProjects.length;
  const selectedProjects = useMemo(
    () => selectableProjects.filter((p) => selectedIds.has(p.id)),
    [selectableProjects, selectedIds]
  );

  function toggleProject(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(selectableProjects.map((p) => p.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  const canOpenConfirm = sql.trim().length > 0 && selectedProjects.length > 0;
  const canRun = confirmText.trim() === CONFIRM_WORD;

  function openConfirm() {
    setRunStatus('idle');
    setRunError(null);
    setRunResult(null);
    setConfirmText('');
    setConfirmOpen(true);
  }

  function closeConfirm() {
    setConfirmOpen(false);
    setConfirmText('');
  }

  async function handleConfirmedRun() {
    setRunStatus('running');
    setRunError(null);
    try {
      const token = await withToken();
      const result = await broadcastSchemaPushAction(token, {
        sql,
        projectIds: selectedProjects.map((p) => p.id),
      });
      setRunResult(result);
      setRunStatus('done');
      setConfirmOpen(false);
      // Phase 5: refresh history so this just-completed run shows up at
      // the top immediately, not just after a manual page reload.
      loadHistory();
    } catch (err) {
      // Request-level failure only (e.g. couldn't reach the registry at
      // all) — a per-project failure never lands here, it lands inside
      // runResult.results instead, since one project failing must never
      // read as "the whole broadcast failed."
      setRunError(err.message);
      setRunStatus('error');
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--surface)',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
          style={{ marginBottom: 'var(--space-5)' }}
        >
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to dashboard
        </Button>

        <h1
          style={{
            fontSize: 'var(--font-size-lg)',
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Schema push
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
          Paste SQL once, run it against every selected active project — sequentially, with a
          clear success/failure result reported for each one individually.
        </p>

        {loadStatus === 'loading' && (
          <Card padding="lg">
            <LoadingState preset="list" rows={3} label="Loading projects" />
          </Card>
        )}

        {loadStatus === 'error' && (
          <Card padding="lg">
            <ErrorState message={loadError} onRetry={load} />
          </Card>
        )}

        {loadStatus === 'ready' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {runStatus === 'error' && runError && (
              <Card padding="lg">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <Warning size={18} weight="bold" color="var(--color-danger)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)', margin: 0 }}>
                    Could not run the broadcast at all: {runError}. No per-project attempt was made —
                    fix this and try again.
                  </p>
                </div>
              </Card>
            )}

            {runStatus === 'done' && runResult && (
              <Card padding="lg">
                <h2 style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', marginTop: 0, marginBottom: 'var(--space-1)' }}>
                  Results — {runResult.succeededCount} succeeded, {runResult.failedCount} failed
                </h2>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
                  Ran sequentially, one project at a time. A failed project did not stop the others
                  from getting this change — see each project's own result below. Failures are not
                  retried automatically; fix the SQL or that project's stored connection string,
                  then re-run.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {runResult.results.map((r) => (
                    <div
                      key={r.projectId}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-2)',
                        padding: 'var(--space-2) var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-inset)',
                        boxShadow: 'var(--shadow-inset)',
                      }}
                    >
                      {r.status === 'success' ? (
                        <CheckCircle size={18} weight="bold" color="var(--color-success)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                      ) : (
                        <XCircle size={18} weight="bold" color="var(--color-danger)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-weight-semibold)' }}>
                          {r.label ?? r.projectId}
                        </div>
                        {r.status === 'failed' && (
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)', marginTop: 2, wordBreak: 'break-word' }}>
                            {r.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Phase 4: whether this run's SQL made it into the master
                    provisioning file, or why not. */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-inset)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                  {runResult.foldedIntoMaster ? (
                    <CheckCircle size={18} weight="bold" color="var(--color-success)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <Warning size={18} weight="bold" color="var(--color-warning, var(--text-muted))" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                  )}
                  <p style={{ fontSize: 'var(--font-size-xs)', color: runResult.foldedIntoMaster ? 'var(--text-secondary)' : 'var(--text-muted)', margin: 0 }}>
                    {runResult.foldedIntoMaster
                      ? 'Folded into supabase/provisioning/target_project_schema.sql — every future project provisioned from that file will include this change automatically.'
                      : runResult.foldSkippedReason}
                  </p>
                </div>

                {runResult.idempotencyWarning && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-inset)',
                      boxShadow: 'var(--shadow-inset)',
                    }}
                  >
                    <Warning size={18} weight="bold" color="var(--color-warning, var(--text-muted))" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', margin: 0 }}>
                      {runResult.idempotencyWarning}
                    </p>
                  </div>
                )}
              </Card>
            )}

            <Card padding="lg">
              <h2 style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
                SQL to broadcast
              </h2>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder={'-- e.g.\ncreate table if not exists public.push_subscriptions (\n  ...\n);'}
                rows={12}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font-family-mono, monospace)',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                  background: 'var(--surface-inset)',
                  boxShadow: 'var(--shadow-inset)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)',
                  resize: 'vertical',
                }}
              />
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)', marginBottom: 0 }}>
                If this SQL succeeds on every selected project, it's automatically folded into
                supabase/provisioning/target_project_schema.sql so future projects get it too —
                prefer idempotent SQL (e.g. <code>create table if not exists</code>) so that still
                works cleanly later. If even one project fails, nothing is folded in until you fix
                it and re-run.
              </p>
            </Card>

            <Card padding="lg">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', margin: 0 }}>
                  Projects ({selectedProjects.length} of {selectableProjects.length} selected)
                </h2>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button variant="ghost" size="sm" onClick={selectAll}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={selectNone}>
                    Select none
                  </Button>
                </div>
              </div>

              {selectableProjects.length === 0 ? (
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: 0 }}>
                  No non-paused projects to push to. Unpause a project from the Projects dashboard,
                  or add one, first.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {selectableProjects.map((project) => {
                    const checked = selectedIds.has(project.id);
                    const CheckIcon = checked ? CheckSquare : Square;
                    return (
                      <label
                        key={project.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                          padding: 'var(--space-2) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          background: checked ? 'var(--accent-muted)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProject(project.id)}
                          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                        />
                        <CheckIcon
                          size={18}
                          weight="bold"
                          aria-hidden="true"
                          color={checked ? 'var(--accent)' : 'var(--text-muted)'}
                          style={{ flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', flex: 1 }}>
                          {project.label}
                        </span>
                        {!project.hasConnectionString && (
                          <Badge tone="warning" size="sm">
                            No connection string stored
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              {pausedCount > 0 && (
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-3)', marginBottom: 0 }}>
                  {pausedCount} paused {pausedCount === 1 ? 'project is' : 'projects are'} excluded from
                  this list. Unpause it from the Projects dashboard first if it should get this
                  change too.
                </p>
              )}
            </Card>

            <div>
              <Button variant="primary" onClick={openConfirm} disabled={!canOpenConfirm}>
                <PlayCircle size={16} weight="bold" aria-hidden="true" />
                Review &amp; confirm
              </Button>
              {!canOpenConfirm && (
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                  Paste some SQL and select at least one project to continue.
                </p>
              )}
            </div>

            <Card padding="lg">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                <ClockCounterClockwise size={18} weight="bold" aria-hidden="true" color="var(--text-secondary)" />
                <h2 style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', margin: 0 }}>
                  History
                </h2>
              </div>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
                Every past schema push, most recent first. The raw SQL that was submitted and a
                failed project's specific error aren't captured in this history — only the outcome
                per project. Both are visible in the results above right after a run; drill into
                the general{' '}
                <a href="/activity" style={{ color: 'var(--accent)' }}>
                  Activity feed
                </a>{' '}
                for the same rows in a different view, or check
                supabase/provisioning/target_project_schema.sql for what's actually been folded in.
              </p>

              {historyStatus === 'loading' && <LoadingState preset="list" rows={3} label="Loading history" />}

              {historyStatus === 'error' && <ErrorState message={historyError} onRetry={loadHistory} />}

              {historyStatus === 'ready' && historyRows.length === 0 && (
                <EmptyState
                  title="No pushes yet"
                  message="Run a schema push above and it'll show up here."
                />
              )}

              {historyStatus === 'ready' && historyRows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {historyRows.map((row) => {
                    const expanded = expandedHistoryId === row.id;
                    const allSucceeded = row.failedCount === 0;
                    return (
                      <div
                        key={row.id}
                        style={{
                          padding: 'var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--surface-inset)',
                          boxShadow: 'var(--shadow-inset)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                          {allSucceeded ? (
                            <CheckCircle size={18} weight="bold" color="var(--color-success)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                          ) : (
                            <XCircle size={18} weight="bold" color="var(--color-danger)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-weight-semibold)' }}>
                                {row.succeededCount} succeeded, {row.failedCount} failed
                              </span>
                              {row.foldedIntoMaster && (
                                <Badge tone="success" size="sm">
                                  Folded into master
                                </Badge>
                              )}
                            </div>
                            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', margin: 'var(--space-1) 0 0' }}>
                              {formatDateTime(row.createdAt)} by {row.actor}
                            </p>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedHistoryId(expanded ? null : row.id)}
                              style={{ marginTop: 'var(--space-2)', paddingLeft: 0 }}
                            >
                              {expanded ? (
                                <CaretUp size={14} weight="bold" aria-hidden="true" />
                              ) : (
                                <CaretDown size={14} weight="bold" aria-hidden="true" />
                              )}
                              {expanded ? 'Hide per-project results' : 'Show per-project results'}
                            </Button>

                            {expanded && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                                {row.results.map((r) => (
                                  <div
                                    key={r.projectId}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 'var(--space-2)',
                                      fontSize: 'var(--font-size-xs)',
                                    }}
                                  >
                                    {r.status === 'success' ? (
                                      <CheckCircle size={14} weight="bold" color="var(--color-success)" aria-hidden="true" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} weight="bold" color="var(--color-danger)" aria-hidden="true" style={{ flexShrink: 0 }} />
                                    )}
                                    <span style={{ color: 'var(--text-secondary)' }}>{r.label ?? r.projectId}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      <BottomSheet
        open={confirmOpen}
        onClose={runStatus === 'running' ? undefined : closeConfirm}
        title="Confirm schema push"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            This will run the pasted SQL, unmodified, against{' '}
            <strong>
              {selectedProjects.length} {selectedProjects.length === 1 ? 'project' : 'projects'}
            </strong>
            : {selectedProjects.map((p) => p.label).join(', ')}.
          </p>

          <p
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-2)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-muted)',
              background: 'var(--surface-inset)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-inset)',
              padding: 'var(--space-3)',
              margin: 0,
            }}
          >
            <Warning size={16} weight="bold" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            This is real, irreversible DDL against every live database listed above, run directly —
            not a preview or a dry run. There is no undo. Double-check the SQL before continuing.
          </p>

          <Input
            id="schema-push-confirm"
            label={`Type "${CONFIRM_WORD}" to confirm`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={runStatus === 'running'}
          />

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button
              variant="danger"
              onClick={handleConfirmedRun}
              disabled={!canRun || runStatus === 'running'}
              fullWidth
            >
              <PlayCircle size={16} weight="bold" aria-hidden="true" />
              {runStatus === 'running' ? 'Running...' : 'Confirm'}
            </Button>
            <Button variant="ghost" onClick={closeConfirm} disabled={runStatus === 'running'}>
              Cancel
            </Button>
          </div>
        </div>
      </BottomSheet>
    </main>
  );
}
