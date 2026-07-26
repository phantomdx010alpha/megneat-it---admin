'use client';

/**
 * app/(app)/clients/page.js
 *
 * Phase 7 — browse, search, and edit existing clients without ever
 * touching Supabase Studio.
 *
 * Search matches `company_name` / `contact_email` (see actions.js's own
 * top comment for why login email isn't part of this — that credential
 * doesn't live in the registry). Filtering and searching both happen
 * client-side over the one list-load — reasonable for a single-operator
 * tool's own client list, and it means the search box and filter dropdown
 * feel instant with no extra round trips, matching the "maximum
 * user-friendly" standing goal.
 *
 * Inline edit is scoped to exactly the two fields the masterplan calls
 * out (`expires_at`, `max_devices`) — one row expands into an edit form at
 * a time, Save persists via updateClientAction and folds the row back to
 * its read view with the fresh values, Cancel discards and reverts.
 *
 * Phase 8 extends this same page with the revoke/suspend/delete lifecycle:
 *
 *   - Suspend / Reactivate — a single-click toggle (registry-only, per
 *     suspendClientAction's own doc comment), with its own tiny
 *     busy/error state per row, same pattern as Phase 5's own
 *     pause-toggle button.
 *   - Delete — deliberately NOT a single click, given the stakes. Opens
 *     a BottomSheet (the shared modal/sheet primitive Phase 67 of the
 *     shell track built) requiring the operator to type the client's own
 *     company name before the Delete button in that dialog even enables —
 *     the masterplan's own "type-the-company-name-to-confirm" requirement.
 *     The dialog also states plainly, every time, that the client's data
 *     tables on their target project are not touched by this action.
 *
 * Phase 9 adds the click-through: each row's own "Devices" button opens
 * `app/(app)/clients/[licenseKey]/page.js`, the new per-client detail view
 * with read-only device visibility. Nothing on this list page itself reads
 * `device_registrations` beyond what Phase 7 already pulled in for the
 * near-device-limit filter — the per-device name/last-seen/flags detail
 * lives entirely on that new page, loaded only once the operator actually
 * clicks through to one client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MagnifyingGlass,
  PencilSimple,
  CheckCircle,
  XCircle,
  WarningCircle,
  UserPlus,
  X,
  Prohibit,
  ArrowCounterClockwise,
  ArrowLeft,
  Trash,
  Warning,
  DeviceMobile,
} from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import BottomSheet from '@/components/ui/BottomSheet';
import { getSession } from '@/lib/auth/session';
import { listClientsAction, updateClientAction, suspendClientAction, deleteClientAction } from './actions';

const FILTER_OPTIONS = [
  { value: 'all', label: 'All clients' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'near_device_limit', label: 'Near device limit' },
];

function isExpired(client) {
  if (!client.expiresAt) return false;
  return new Date(client.expiresAt).getTime() < Date.now();
}

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Date input wants YYYY-MM-DD; expires_at is a full timestamptz.
function toDateInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function ClientsPage() {
  const router = useRouter();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const [editingKey, setEditingKey] = useState(null);
  const [editFields, setEditFields] = useState({ expiresAt: '', maxDevices: '' });
  const [savingKey, setSavingKey] = useState(null);
  const [rowError, setRowError] = useState(null);

  const [suspendingKey, setSuspendingKey] = useState(null);
  const [suspendError, setSuspendError] = useState(null);

  const [deleteDialog, setDeleteDialog] = useState(null); // { client, confirmText, deleting, error } | null

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
      const rows = await listClientsAction(token);
      setClients(rows);
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

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (q) {
        const haystack = `${c.companyName ?? ''} ${c.contactEmail ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === 'active') return c.isActive && !isExpired(c);
      if (filter === 'expired') return isExpired(c);
      if (filter === 'near_device_limit') return c.isNearDeviceLimit;
      return true;
    });
  }, [clients, query, filter]);

  function startEdit(client) {
    setRowError(null);
    setEditingKey(client.licenseKey);
    setEditFields({
      expiresAt: toDateInputValue(client.expiresAt),
      maxDevices: String(client.maxDevices),
    });
  }

  function cancelEdit() {
    setEditingKey(null);
    setRowError(null);
  }

  async function saveEdit(client) {
    setSavingKey(client.licenseKey);
    setRowError(null);
    try {
      const token = await withToken();
      const outcome = await updateClientAction(token, {
        licenseKey: client.licenseKey,
        expiresAt: editFields.expiresAt,
        maxDevices: Number(editFields.maxDevices),
      });
      setClients((rows) =>
        rows.map((r) =>
          r.licenseKey === client.licenseKey
            ? {
                ...r,
                expiresAt: outcome.expiresAt,
                maxDevices: outcome.maxDevices,
                isNearDeviceLimit:
                  r.deviceCount !== null && r.deviceCount >= outcome.maxDevices - 1,
              }
            : r
        )
      );
      setEditingKey(null);
    } catch (err) {
      setRowError(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  async function handleToggleSuspend(client) {
    setSuspendingKey(client.licenseKey);
    setSuspendError(null);
    try {
      const token = await withToken();
      const outcome = await suspendClientAction(token, {
        licenseKey: client.licenseKey,
        companyName: client.companyName,
        isActive: !client.isActive,
      });
      setClients((rows) =>
        rows.map((r) => (r.licenseKey === client.licenseKey ? { ...r, isActive: outcome.isActive } : r))
      );
    } catch (err) {
      setSuspendError(err.message);
    } finally {
      setSuspendingKey(null);
    }
  }

  function openDeleteDialog(client) {
    setDeleteDialog({ client, confirmText: '', deleting: false, error: null });
  }

  function closeDeleteDialog() {
    setDeleteDialog(null);
  }

  async function confirmDelete() {
    if (!deleteDialog) return;
    const { client, confirmText } = deleteDialog;
    setDeleteDialog((d) => ({ ...d, deleting: true, error: null }));
    try {
      const token = await withToken();
      await deleteClientAction(token, { licenseKey: client.licenseKey, confirmText });
      setClients((rows) => rows.filter((r) => r.licenseKey !== client.licenseKey));
      setDeleteDialog(null);
    } catch (err) {
      setDeleteDialog((d) => ({ ...d, deleting: false, error: err.message }));
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
            flexWrap: 'wrap',
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
              Clients
            </h1>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Every license across every connected project.
            </p>
          </div>
          <Button variant="primary" onClick={() => router.push('/clients/new')}>
            <UserPlus size={16} weight="bold" aria-hidden="true" />
            Add client
          </Button>
        </div>

        {status !== 'loading' && clients.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-5)',
              flexWrap: 'wrap',
            }}
          >
            <Input
              id="client-search"
              placeholder="Search company or contact email..."
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
            <LoadingState preset="list" rows={4} label="Loading clients" />
          </Card>
        )}

        {status === 'error' && clients.length === 0 && (
          <Card padding="lg">
            <ErrorState message={error} onRetry={load} />
          </Card>
        )}

        {status === 'ready' && clients.length === 0 && (
          <Card padding="lg">
            <EmptyState
              title="No clients yet"
              message="Add your first client to create their login and license in one step."
              action="Add client"
              onAction={() => router.push('/clients/new')}
            />
          </Card>
        )}

        {status === 'ready' && clients.length > 0 && filteredClients.length === 0 && (
          <Card padding="lg">
            <EmptyState
              title="No matches"
              message="Try a different search term or filter."
            />
          </Card>
        )}

        {suspendError && (
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
            {suspendError}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {filteredClients.map((client) => {
            const editing = editingKey === client.licenseKey;
            const saving = savingKey === client.licenseKey;
            const suspending = suspendingKey === client.licenseKey;
            const expired = isExpired(client);

            return (
              <Card key={client.licenseKey} padding="lg">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <h2
                        style={{
                          fontSize: 'var(--font-size-md)',
                          color: 'var(--text-primary)',
                          margin: 0,
                        }}
                      >
                        {client.companyName}
                      </h2>
                      {!client.isActive && <Badge tone="muted">Suspended</Badge>}
                      {expired && <Badge tone="danger">Expired</Badge>}
                      {client.isNearDeviceLimit && (
                        <Badge tone="warning">
                          <WarningCircle size={12} weight="bold" aria-hidden="true" />
                          Near device limit
                        </Badge>
                      )}
                    </div>

                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
                      {client.contactEmail || 'No contact email'} · {client.projectLabel}
                    </p>

                    <p
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-family-mono, monospace)',
                        margin: 'var(--space-1) 0 0',
                      }}
                    >
                      {client.licenseKey}
                    </p>

                    {!editing && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                          marginTop: 'var(--space-3)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Badge tone={expired ? 'danger' : 'default'}>Expires: {formatDate(client.expiresAt)}</Badge>
                        <Badge tone={client.isNearDeviceLimit ? 'warning' : 'default'}>
                          Devices: {client.deviceCount === null ? 'unknown' : client.deviceCount} / {client.maxDevices}
                        </Badge>
                      </div>
                    )}

                    {editing && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--space-3)',
                          marginTop: 'var(--space-4)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Input
                          id={`expires-${client.licenseKey}`}
                          label="Expires"
                          type="date"
                          value={editFields.expiresAt}
                          onChange={(e) => setEditFields((f) => ({ ...f, expiresAt: e.target.value }))}
                          hint="Leave blank for no expiry."
                          disabled={saving}
                          style={{ flex: '1 1 180px' }}
                        />
                        <Input
                          id={`max-devices-${client.licenseKey}`}
                          label="Max devices"
                          type="number"
                          min="1"
                          value={editFields.maxDevices}
                          onChange={(e) => setEditFields((f) => ({ ...f, maxDevices: e.target.value }))}
                          disabled={saving}
                          style={{ flex: '1 1 120px' }}
                        />
                      </div>
                    )}

                    {editing && rowError && (
                      <p
                        role="alert"
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-danger)',
                          marginTop: 'var(--space-3)',
                        }}
                      >
                        {rowError}
                      </p>
                    )}

                    {editing && (
                      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
                        <Button variant="primary" size="sm" onClick={() => saveEdit(client)} disabled={saving}>
                          <CheckCircle size={14} weight="bold" aria-hidden="true" />
                          {saving ? 'Saving...' : 'Save'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                          <XCircle size={14} weight="bold" aria-hidden="true" />
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>

                  {!editing && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-2)',
                        flexShrink: 0,
                        alignItems: 'stretch',
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/clients/${encodeURIComponent(client.licenseKey)}`)}
                      >
                        <DeviceMobile size={16} weight="bold" aria-hidden="true" />
                        Devices
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(client)}>
                        <PencilSimple size={16} weight="bold" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleSuspend(client)}
                        disabled={suspending}
                      >
                        {client.isActive ? (
                          <Prohibit size={16} weight="bold" aria-hidden="true" />
                        ) : (
                          <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
                        )}
                        {suspending ? 'Working...' : client.isActive ? 'Suspend' : 'Reactivate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeleteDialog(client)}
                        style={{ color: 'var(--color-danger)' }}
                      >
                        <Trash size={16} weight="bold" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  )}
                  {editing && (
                    <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving} style={{ flexShrink: 0 }}>
                      <X size={16} weight="bold" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <BottomSheet
        open={Boolean(deleteDialog)}
        onClose={deleteDialog?.deleting ? undefined : closeDeleteDialog}
        title="Delete client"
      >
        {deleteDialog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              This permanently deletes <strong>{deleteDialog.client.companyName}</strong>&apos;s login on{' '}
              <strong>{deleteDialog.client.projectLabel}</strong> and their license from the registry. This
              cannot be undone.
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
              Their data tables on {deleteDialog.client.projectLabel} are NOT deleted by this action —
              a deliberate choice. If you want their data removed too, that's a separate manual step in
              that project's own Supabase Studio.
            </p>

            <Input
              id="delete-confirm"
              label={`Type "${deleteDialog.client.companyName}" to confirm`}
              value={deleteDialog.confirmText}
              onChange={(e) => setDeleteDialog((d) => ({ ...d, confirmText: e.target.value }))}
              disabled={deleteDialog.deleting}
            />

            {deleteDialog.error && (
              <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)', margin: 0 }}>
                {deleteDialog.error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={deleteDialog.deleting || deleteDialog.confirmText !== deleteDialog.client.companyName}
                fullWidth
              >
                <Trash size={16} weight="bold" aria-hidden="true" />
                {deleteDialog.deleting ? 'Deleting...' : 'Delete permanently'}
              </Button>
              <Button variant="ghost" onClick={closeDeleteDialog} disabled={deleteDialog.deleting}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </main>
  );
}
