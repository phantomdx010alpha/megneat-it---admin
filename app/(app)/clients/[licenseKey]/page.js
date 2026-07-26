'use client';

/**
 * app/(app)/clients/[licenseKey]/page.js
 *
 * Phase 9 — Device visibility per client. A click-through detail page from
 * Phase 7's list: shows the client's own registered devices — name,
 * last-seen, active/can_write — read directly from their target project,
 * without ever opening that project's own Supabase Studio.
 *
 * Read-only, deliberately. Per the masterplan's own out-of-scope note for
 * this phase, editing a device's `can_write`/`is_active` stays the
 * client-facing PWA's own job; this page has no controls that touch
 * `device_registrations` at all.
 *
 * `devicesError` (see actions.js) is shown as an inline notice rather than
 * a full-page error state whenever the registry-side client info still
 * loaded fine — an unreachable target project shouldn't hide the client's
 * own license details, same "show what you know" spirit as Phase 5's own
 * reachability badge.
 *
 * Phase 10 extends this same page with the "Move to a different project"
 * action: a button opens a BottomSheet with a project picker (every
 * *other* connected project — see actions.js's own
 * `listMoveTargetProjectOptionsAction`) and a confirmation step that
 * states, in plain language, that the client's shell and any PWA devices
 * will need to reactivate/resync on their next check-in, and that their
 * historical data does not automatically follow. Confirming calls
 * `moveClientAction`, which repoints `licenses.project_id` and nothing
 * else, then reloads this page's own data — at which point the device
 * list above will correctly show whatever the *new* target project's
 * `device_registrations` has for this license key (typically nothing yet,
 * until the client actually reactivates there).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  DeviceMobile,
  Crown,
  PencilSimpleLine,
  Eye,
  Clock,
  WarningCircle,
  ArrowsLeftRight,
  Warning,
} from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import BottomSheet from '@/components/ui/BottomSheet';
import { getSession } from '@/lib/auth/session';
import { getClientDetailAction, listMoveTargetProjectOptionsAction, moveClientAction } from './actions';

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return 'Never';
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

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const licenseKey = decodeURIComponent(params?.licenseKey ?? '');

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const [moveDialog, setMoveDialog] = useState(null); // { options, loadingOptions, optionsError, toProjectId, confirming, error } | null

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
      const result = await getClientDetailAction(token, licenseKey);
      setDetail(result);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenseKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function openMoveDialog() {
    if (!detail) return;
    setMoveDialog({ options: [], loadingOptions: true, optionsError: null, toProjectId: null, confirming: false, error: null });
    try {
      const token = await withToken();
      const options = await listMoveTargetProjectOptionsAction(token, detail.projectId);
      setMoveDialog((d) => (d ? { ...d, options, loadingOptions: false } : d));
    } catch (err) {
      setMoveDialog((d) => (d ? { ...d, loadingOptions: false, optionsError: err.message } : d));
    }
  }

  function closeMoveDialog() {
    setMoveDialog(null);
  }

  async function confirmMove() {
    if (!moveDialog || !detail) return;
    setMoveDialog((d) => ({ ...d, confirming: true, error: null }));
    try {
      const token = await withToken();
      await moveClientAction(token, {
        licenseKey: detail.licenseKey,
        companyName: detail.companyName,
        toProjectId: moveDialog.toProjectId,
      });
      setMoveDialog(null);
      await load(); // Refresh client + device list against the new target project.
    } catch (err) {
      setMoveDialog((d) => ({ ...d, confirming: false, error: err.message }));
    }
  }

  const expired = detail ? isExpired(detail.expiresAt) : false;

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--surface)',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Button variant="ghost" size="sm" onClick={() => router.push('/clients')} style={{ marginBottom: 'var(--space-5)' }}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to clients
        </Button>

        {status === 'loading' && (
          <Card padding="lg">
            <LoadingState preset="card" label="Loading client" />
          </Card>
        )}

        {status === 'error' && (
          <Card padding="lg">
            <ErrorState message={error} onRetry={load} />
          </Card>
        )}

        {status === 'ready' && detail && (
          <>
            <Card padding="lg" style={{ marginBottom: 'var(--space-5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <h1
                  style={{
                    fontSize: 'var(--font-size-lg)',
                    color: 'var(--text-primary)',
                    margin: 0,
                  }}
                >
                  {detail.companyName}
                </h1>
                {!detail.isActive && <Badge tone="muted">Suspended</Badge>}
                {expired && <Badge tone="danger">Expired</Badge>}
              </div>

              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
                {detail.contactEmail || 'No contact email'} · {detail.projectLabel}
              </p>

              <p
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-family-mono, monospace)',
                  margin: 'var(--space-1) 0 0',
                }}
              >
                {detail.licenseKey}
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  marginTop: 'var(--space-4)',
                  flexWrap: 'wrap',
                }}
              >
                <Badge tone={expired ? 'danger' : 'default'}>Expires: {formatDate(detail.expiresAt)}</Badge>
                <Badge tone="default">
                  Devices: {detail.devices === null ? 'unknown' : detail.devices.length} / {detail.maxDevices}
                </Badge>
              </div>

              <div style={{ marginTop: 'var(--space-4)' }}>
                <Button variant="ghost" size="sm" onClick={openMoveDialog}>
                  <ArrowsLeftRight size={16} weight="bold" aria-hidden="true" />
                  Move to a different project
                </Button>
              </div>
            </Card>

            <h2
              style={{
                fontSize: 'var(--font-size-md)',
                color: 'var(--text-primary)',
                marginBottom: 'var(--space-3)',
              }}
            >
              Devices
            </h2>

            {detail.devicesError && (
              <Card padding="md" style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <WarningCircle
                    size={18}
                    weight="bold"
                    color="var(--color-warning)"
                    aria-hidden="true"
                    style={{ flexShrink: 0, marginTop: 2 }}
                  />
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                    {detail.devicesError}
                  </p>
                </div>
              </Card>
            )}

            {!detail.devicesError && detail.devices && detail.devices.length === 0 && (
              <Card padding="lg">
                <EmptyState
                  title="No devices yet"
                  message="This client hasn't activated a device on their shell/PWA yet."
                />
              </Card>
            )}

            {detail.devices && detail.devices.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {detail.devices.map((device) => (
                  <Card key={device.id} padding="md">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 'var(--space-4)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <DeviceMobile size={18} weight="bold" color="var(--text-muted)" aria-hidden="true" />
                          <h3 style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-primary)', margin: 0 }}>
                            {device.deviceName || 'Unnamed device'}
                          </h3>
                          {device.isMaster && (
                            <Badge tone="accent" size="sm">
                              <Crown size={12} weight="bold" aria-hidden="true" />
                              Master
                            </Badge>
                          )}
                        </div>

                        <p
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-family-mono, monospace)',
                            margin: 'var(--space-1) 0 0',
                          }}
                        >
                          {device.deviceId}
                        </p>

                        <p
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-1)',
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-secondary)',
                            margin: 'var(--space-2) 0 0',
                          }}
                        >
                          <Clock size={14} weight="bold" aria-hidden="true" />
                          Last seen: {formatDateTime(device.lastSeenAt)}
                        </p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-end', flexShrink: 0 }}>
                        <Badge tone={device.isActive ? 'success' : 'muted'} size="sm">
                          {device.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge tone={device.canWrite ? 'accent' : 'default'} size="sm">
                          {device.canWrite ? (
                            <PencilSimpleLine size={12} weight="bold" aria-hidden="true" />
                          ) : (
                            <Eye size={12} weight="bold" aria-hidden="true" />
                          )}
                          {device.canWrite ? 'Can write' : 'Read-only'}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <BottomSheet open={Boolean(moveDialog)} onClose={moveDialog?.confirming ? undefined : closeMoveDialog} title="Move to a different project">
        {moveDialog && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              Moves <strong>{detail.companyName}</strong> from <strong>{detail.projectLabel}</strong> to the
              project you pick below. This only repoints their license in the registry.
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
              Their shell and any PWA devices will need to reactivate/resync the next time they check in.
              Their historical data does NOT automatically follow — that stays on {detail.projectLabel} unless
              you migrate it yourself.
            </p>

            {moveDialog.optionsError && (
              <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)', margin: 0 }}>
                {moveDialog.optionsError}
              </p>
            )}

            {!moveDialog.optionsError && (
              <Select
                label="Move to"
                placeholder={moveDialog.loadingOptions ? 'Loading projects...' : 'Pick a project'}
                loading={moveDialog.loadingOptions}
                disabled={moveDialog.confirming}
                value={moveDialog.toProjectId}
                onChange={(value) => setMoveDialog((d) => ({ ...d, toProjectId: value }))}
                options={moveDialog.options.map((o) => ({
                  value: o.id,
                  label: `${o.label}${o.isPaused ? ' (paused)' : ''} \u00b7 ${o.licenseCount} client${o.licenseCount === 1 ? '' : 's'}`,
                }))}
                emptyTitle="No other projects"
                emptyMessage="Connect another project under Projects first."
              />
            )}

            {moveDialog.error && (
              <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)', margin: 0 }}>
                {moveDialog.error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button
                variant="primary"
                onClick={confirmMove}
                disabled={moveDialog.confirming || !moveDialog.toProjectId}
                fullWidth
              >
                <ArrowsLeftRight size={16} weight="bold" aria-hidden="true" />
                {moveDialog.confirming ? 'Moving...' : 'Move client'}
              </Button>
              <Button variant="ghost" onClick={closeMoveDialog} disabled={moveDialog.confirming}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </main>
  );
}
