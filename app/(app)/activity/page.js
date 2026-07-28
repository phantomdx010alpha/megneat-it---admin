'use client';

/**
 * app/(app)/activity/page.js
 *
 * Phase 11 — Audit log. A plain reverse-chronological feed of every
 * `audit_log` row (loaded via listAuditLogAction), matching the
 * masterplan's own "simple reverse-chronological feed page" spec — no
 * alerting/notification layer on top, per that phase's own "out of scope"
 * note.
 *
 * Search + action-type filter both run client-side over the one loaded
 * page of rows, same "instant, no extra round trips" reasoning
 * app/(app)/clients/page.js's own top comment already gives for its
 * search/filter — reasonable at this table's expected size for a
 * single-operator tool (see actions.js's own row-cap note).
 *
 * Each row shows actor / action / target / when at a glance; `details`
 * (jsonb) is collapsed by default and expands in place — most entries'
 * detail payload is only useful for a "wait, what exactly changed"
 * drill-down, not something worth showing inline for every row all the
 * time.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MagnifyingGlass,
  FolderPlus,
  Database,
  PauseCircle,
  PlayCircle,
  UserPlus,
  PencilSimple,
  Prohibit,
  ArrowCounterClockwise,
  Trash,
  ArrowsLeftRight,
  ArrowLeft,
  CaretDown,
  CaretUp,
  ClockCounterClockwise,
  DeviceMobile,
} from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { getSession } from '@/lib/auth/session';
import { listAuditLogAction } from './actions';

// One entry per action string a mutating server action can currently log
// (see lib/audit.js's own call sites across Phases 4-10). Kept as a plain
// map, not derived dynamically from whatever happens to be in the table
// yet, so a brand-new install with an empty log still shows a complete
// filter list and every badge/icon renders correctly from the first row on.
//
// Phase 6 (ADMIN_STATIC.md, device-delete/project-edit track) added
// `delete_device` and `edit_project` below — the two new action strings
// Phases 1-4 of that track introduced (confirmed by re-reading the actual
// `logAuditEvent()` calls in app/(app)/clients/[licenseKey]/actions.js and
// app/(app)/projects/actions.js, not assumed from the masterplan's prose).
// Before this fix, both fell through to DEFAULT_ACTION_META below: they
// still rendered (no crash, no dropped row — the fallback was already
// safe), just as their raw snake_case action string next to a generic
// clock icon, unlike every other action type here. That's a real "does it
// render sensibly" gap per this phase's own Verify step, not just a
// missing crash — fixed by adding proper entries, matching this map's own
// existing convention (danger tone + the same entity icon the source
// screen already uses, for `delete_device`; the same icon/tone
// `edit_client` already uses for `edit_project`, since both are a plain
// field edit, not specifically flagged as more dangerous here — the real
// stakes of a given edit live in that row's own `details.changes`, not in
// which color the whole action type gets).
const ACTION_META = {
  create_project: { label: 'Added project', icon: FolderPlus, tone: 'accent' },
  provision_project: { label: 'Provisioned project', icon: Database, tone: 'accent' },
  pause_project: { label: 'Paused project', icon: PauseCircle, tone: 'muted' },
  unpause_project: { label: 'Unpaused project', icon: PlayCircle, tone: 'success' },
  edit_project: { label: 'Edited project', icon: PencilSimple, tone: 'default' },
  create_client: { label: 'Added client', icon: UserPlus, tone: 'success' },
  edit_client: { label: 'Edited client', icon: PencilSimple, tone: 'default' },
  suspend_client: { label: 'Suspended client', icon: Prohibit, tone: 'warning' },
  reactivate_client: { label: 'Reactivated client', icon: ArrowCounterClockwise, tone: 'success' },
  delete_client: { label: 'Deleted client', icon: Trash, tone: 'danger' },
  move_client: { label: 'Moved client', icon: ArrowsLeftRight, tone: 'accent' },
  delete_device: { label: 'Deleted device', icon: DeviceMobile, tone: 'danger' },
};

const DEFAULT_ACTION_META = { label: null, icon: ClockCounterClockwise, tone: 'default' };

// Badge.jsx defines its own tone->color mapping internally but doesn't
// export it — this is the icon-only equivalent (a plain CSS var per tone),
// kept in sync with Badge's own five tones by hand since there's no shared
// export to import instead.
const ICON_COLOR_BY_TONE = {
  default: 'var(--text-secondary)',
  accent: 'var(--accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  muted: 'var(--text-muted)',
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All activity' },
  ...Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.label })),
];

function actionMeta(action) {
  return ACTION_META[action] ?? { ...DEFAULT_ACTION_META, label: action };
}

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

export default function ActivityPage() {
  const router = useRouter();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const session = await getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const data = await listAuditLogAction(session.access_token);
      setRows(data);
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

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.action !== filter) return false;
      if (q) {
        const haystack = `${r.actor ?? ''} ${r.target ?? ''} ${actionMeta(r.action).label ?? r.action}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, filter]);

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

        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h1
            style={{
              fontSize: 'var(--font-size-lg)',
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Activity
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Every admin action recorded here — most recent first.
          </p>
        </div>

        {status !== 'loading' && rows.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-5)',
              flexWrap: 'wrap',
            }}
          >
            <Input
              id="activity-search"
              placeholder="Search actor or target..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              prefix={<MagnifyingGlass size={16} weight="bold" aria-hidden="true" />}
              style={{ flex: '1 1 240px' }}
            />
            <Select
              options={FILTER_OPTIONS}
              value={filter}
              onChange={(value) => setFilter(value ?? 'all')}
              style={{ flex: '0 1 220px' }}
            />
          </div>
        )}

        {status === 'loading' && (
          <Card padding="lg">
            <LoadingState preset="list" rows={5} label="Loading activity" />
          </Card>
        )}

        {status === 'error' && (
          <Card padding="lg">
            <ErrorState message={error} onRetry={load} />
          </Card>
        )}

        {status === 'ready' && rows.length === 0 && (
          <Card padding="lg">
            <EmptyState
              title="No activity yet"
              message="Actions like adding a project or client will show up here as soon as you take one."
            />
          </Card>
        )}

        {status === 'ready' && rows.length > 0 && filteredRows.length === 0 && (
          <Card padding="lg">
            <EmptyState title="No matches" message="Try a different search term or filter." />
          </Card>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredRows.map((row) => {
            const meta = actionMeta(row.action);
            const Icon = meta.icon;
            const expanded = expandedId === row.id;
            const hasDetails = row.details && Object.keys(row.details).length > 0;

            return (
              <Card key={row.id} padding="md">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <Icon
                      size={20}
                      weight="bold"
                      aria-hidden="true"
                      style={{ color: ICON_COLOR_BY_TONE[meta.tone] ?? ICON_COLOR_BY_TONE.default }}
                    />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <Badge tone={meta.tone}>{meta.label ?? row.action}</Badge>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        {formatDateTime(row.createdAt)}
                      </span>
                    </div>
                    {row.target && (
                      <p
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--text-primary)',
                          margin: 'var(--space-2) 0 0',
                          wordBreak: 'break-word',
                        }}
                      >
                        {row.target}
                      </p>
                    )}
                    <p
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        margin: 'var(--space-1) 0 0',
                      }}
                    >
                      by {row.actor}
                    </p>

                    {hasDetails && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                          style={{ marginTop: 'var(--space-2)', paddingLeft: 0 }}
                        >
                          {expanded ? (
                            <CaretUp size={14} weight="bold" aria-hidden="true" />
                          ) : (
                            <CaretDown size={14} weight="bold" aria-hidden="true" />
                          )}
                          {expanded ? 'Hide details' : 'Show details'}
                        </Button>

                        {expanded && (
                          <pre
                            style={{
                              fontSize: 'var(--font-size-xs)',
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-inset)',
                              boxShadow: 'var(--shadow-inset)',
                              borderRadius: 'var(--radius-sm)',
                              padding: 'var(--space-3)',
                              marginTop: 'var(--space-2)',
                              overflowX: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(row.details, null, 2)}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}
