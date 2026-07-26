'use client';

/**
 * app/(app)/projects/page.js
 *
 * Phase 5: the projects dashboard — "where do I have room for a new
 * client" at a glance. Every connected project, its license count, a
 * reachability indicator, and a manual paused/full toggle.
 *
 * No auto-refresh/polling: the masterplan is explicit this phase is
 * "not a full health dashboard" — reachability is checked once per page
 * load (server-side, via actions.js), not kept live.
 *
 * Added by ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 1: any project
 * missing a stored connection string (i.e. every project that existed
 * before 0004_project_connection_strings.sql) gets a one-time inline
 * prompt here to add one, so the schema-broadcast tool (Phase 2 onward)
 * has what it needs for every currently-active project, not just newly
 * created ones. The prompt disappears for a project once it has one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ArrowLeft, CheckCircle, XCircle, WarningCircle, PauseCircle, PlayCircle } from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { getSession } from '@/lib/auth/session';
import {
  listProjectsWithStatusAction,
  toggleProjectPausedAction,
  setProjectConnectionStringAction,
} from './actions';

const REACHABILITY_BADGE = {
  up: { tone: 'success', icon: CheckCircle, label: 'Reachable' },
  down: { tone: 'danger', icon: XCircle, label: 'Unreachable' },
  unknown: { tone: 'muted', icon: WarningCircle, label: 'Unknown' },
};

export default function ProjectsDashboardPage() {
  const router = useRouter();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  // Phase 1 of the schema-broadcast track: per-project draft value + busy
  // state for the one-time "add your connection string" backfill prompt.
  // Keyed by project id since more than one project can be missing one at
  // once. Never pre-filled from the server — there is nothing to prefill
  // with, since the actual stored value is never sent to the browser.
  const [connectionDrafts, setConnectionDrafts] = useState({});
  const [savingConnectionId, setSavingConnectionId] = useState(null);

  async function withToken() {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      throw new Error('Session expired.');
    }
    return session.access_token;
  }

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const token = await withToken();
      const rows = await listProjectsWithStatusAction(token);
      setProjects(rows);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleTogglePause(project) {
    setTogglingId(project.id);
    try {
      const token = await withToken();
      const result = await toggleProjectPausedAction(token, {
        projectId: project.id,
        projectLabel: project.label,
        isPaused: !project.isPaused,
      });
      setProjects((rows) =>
        rows.map((r) => (r.id === project.id ? { ...r, isPaused: result.isPaused } : r))
      );
    } catch (err) {
      // Surface inline rather than losing the whole list to a full-page
      // error state over one failed toggle.
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSaveConnectionString(project) {
    const value = connectionDrafts[project.id];
    if (!value?.trim()) {
      setError('Postgres connection string is required.');
      return;
    }
    setSavingConnectionId(project.id);
    setError(null);
    try {
      const token = await withToken();
      const result = await setProjectConnectionStringAction(token, {
        projectId: project.id,
        projectLabel: project.label,
        connectionString: value,
      });
      setProjects((rows) =>
        rows.map((r) =>
          r.id === project.id ? { ...r, hasConnectionString: result.hasConnectionString } : r
        )
      );
      setConnectionDrafts((d) => {
        const next = { ...d };
        delete next[project.id];
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingConnectionId(null);
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
        <Button variant="ghost" size="sm" onClick={() => router.push('/')} style={{ marginBottom: 'var(--space-5)' }}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to dashboard
        </Button>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 'var(--font-size-lg)',
                color: 'var(--text-primary)',
                marginBottom: 'var(--space-2)',
              }}
            >
              Projects
            </h1>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Every connected Supabase project, at a glance.
            </p>
          </div>
          <Button variant="primary" onClick={() => router.push('/projects/new')}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Add project
          </Button>
        </div>

        {status === 'loading' && (
          <Card padding="lg">
            <LoadingState preset="list" rows={3} label="Loading projects" />
          </Card>
        )}

        {status === 'error' && projects.length === 0 && (
          <Card padding="lg">
            <ErrorState message={error} onRetry={load} />
          </Card>
        )}

        {status === 'ready' && projects.length === 0 && (
          <Card padding="lg">
            <EmptyState
              title="No projects connected yet"
              message="Connect a Supabase project to start assigning clients to it."
              action="Add project"
              onAction={() => router.push('/projects/new')}
            />
          </Card>
        )}

        {projects.length > 0 && (
          <>
            {status === 'error' && error && (
              <p
                role="alert"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-danger)',
                  background: 'rgba(217, 79, 79, 0.08)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                {error}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {projects.map((project) => {
                const badge = REACHABILITY_BADGE[project.reachability] ?? REACHABILITY_BADGE.unknown;
                const BadgeIcon = badge.icon;
                const busy = togglingId === project.id;

                return (
                  <Card key={project.id} padding="lg">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 'var(--space-4)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <h2
                            style={{
                              fontSize: 'var(--font-size-md)',
                              color: 'var(--text-primary)',
                              margin: 0,
                            }}
                          >
                            {project.label}
                          </h2>
                          {project.isPaused && <Badge tone="warning">Paused</Badge>}
                        </div>

                        {project.notes && (
                          <p
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              color: 'var(--text-muted)',
                              marginTop: 'var(--space-2)',
                              marginBottom: 0,
                            }}
                          >
                            {project.notes}
                          </p>
                        )}

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            marginTop: 'var(--space-3)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <Badge tone="accent">
                            {project.licenseCount} {project.licenseCount === 1 ? 'license' : 'licenses'}
                          </Badge>
                          <Badge tone={badge.tone}>
                            <BadgeIcon size={12} weight="bold" aria-hidden="true" />
                            {badge.label}
                          </Badge>
                          {!project.hasConnectionString && (
                            <Badge tone="warning">No connection string stored</Badge>
                          )}
                        </div>

                        {!project.hasConnectionString && (
                          <div
                            style={{
                              marginTop: 'var(--space-3)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--space-2)',
                              maxWidth: 420,
                            }}
                          >
                            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', margin: 0 }}>
                              One-time setup — this project was connected before schema pushes
                              could be broadcast to every project at once. Add its direct Postgres
                              connection string (Settings → Database in that project) so future
                              schema changes can reach it too, without re-asking. Stored as
                              plaintext, same as the service-role key already stored for this
                              project — see 0004_project_connection_strings.sql.
                            </p>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                              <div style={{ flex: '1 1 240px', minWidth: 200 }}>
                                <Input
                                  id={`connection-string-${project.id}`}
                                  label="Postgres connection string"
                                  type="password"
                                  placeholder="postgres://postgres:[password]@db.xxxx.supabase.co:5432/postgres"
                                  value={connectionDrafts[project.id] ?? ''}
                                  onChange={(e) =>
                                    setConnectionDrafts((d) => ({ ...d, [project.id]: e.target.value }))
                                  }
                                  disabled={savingConnectionId === project.id}
                                />
                              </div>
                              <Button
                                variant="raised"
                                size="sm"
                                onClick={() => handleSaveConnectionString(project)}
                                disabled={savingConnectionId === project.id}
                              >
                                {savingConnectionId === project.id ? 'Saving...' : 'Save'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        variant={project.isPaused ? 'raised' : 'ghost'}
                        size="sm"
                        onClick={() => handleTogglePause(project)}
                        disabled={busy}
                        style={{ flexShrink: 0 }}
                      >
                        {project.isPaused ? (
                          <PlayCircle size={16} weight="bold" aria-hidden="true" />
                        ) : (
                          <PauseCircle size={16} weight="bold" aria-hidden="true" />
                        )}
                        {busy ? 'Updating...' : project.isPaused ? 'Unpause' : 'Pause / full'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
