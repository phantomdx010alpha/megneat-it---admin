'use client';

/**
 * app/(app)/projects/[id]/edit/page.js
 *
 * ADMIN_STATIC.md (device-delete/project-edit track), Phase 4 — Project
 * edit: UI, with a warning proportional to real stakes.
 *
 * Loads the project's current values via actions.js's own
 * `getProjectForEditAction` (Phase 4 gap, flagged in that file's own top
 * comment — neither Phase 3 nor this phase's "Key files" list included a
 * read action, but "pre-filled with current values" and showing the
 * active-client count "before allowing a submit" both require one).
 *
 * `label` and `notes` are pre-filled and can be saved with zero extra
 * friction — genuinely low-risk, per the masterplan's own words. The two
 * secret fields (`anonKey`/`serviceRoleKey`) load blank on purpose: this
 * repo never echoes stored secrets to the browser (same discipline
 * `getProjectForEditAction` and every other action here already follows).
 * Typing something into one of those two fields, or changing the URL
 * field from its pre-filled value, is what "I want to change this" means
 * on this page — and is exactly the case that gets gated behind the
 * confirmation step below, not label/notes changes.
 *
 * ── The confirmation step ────────────────────────────────────────────────
 * Only triggers if the submitted values differ from what loaded for
 * `supabaseUrl`, or if `anonKey`/`serviceRoleKey` have anything typed into
 * them at all. Shows the active-client count loaded above, in the same
 * plain language the masterplan itself specifies, and states outright
 * (per that phase's own "Out of scope" note) that this repo cannot push
 * the new values out to any client already using the old ones — a
 * genuine gap, not a solved problem, so the copy says so rather than
 * implying otherwise.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Warning, CheckCircle } from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import LoadingState from '@/components/ui/LoadingState';
import ErrorState from '@/components/ui/ErrorState';
import BottomSheet from '@/components/ui/BottomSheet';
import { getSession } from '@/lib/auth/session';
import { getProjectForEditAction, updateProjectAction } from '../../actions';

const blankKeyFields = { anonKey: '', serviceRoleKey: '' };

export default function EditProjectPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = decodeURIComponent(params?.id ?? '');

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [original, setOriginal] = useState(null); // the loaded { id, label, notes, supabaseUrl, hasAnonKey, hasServiceRoleKey, activeClientCount }

  const [form, setForm] = useState({ label: '', notes: '', supabaseUrl: '', ...blankKeyFields });
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | done | error
  const [saveError, setSaveError] = useState(null);

  const [confirmDialog, setConfirmDialog] = useState(null); // { confirming } | null

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
      const result = await getProjectForEditAction(token, projectId);
      setOriginal(result);
      setForm({ label: result.label, notes: result.notes || '', supabaseUrl: result.supabaseUrl, ...blankKeyFields });
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function update(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function buildFieldsToSend() {
    const fields = {
      label: form.label,
      notes: form.notes,
      supabaseUrl: form.supabaseUrl,
    };
    // Only sent if the operator actually typed something — an omitted key
    // means "leave unchanged," per updateProjectAction's own contract.
    // Sending an intentionally-blanked secret would be rejected server-side
    // anyway (these two can't be saved empty), so there's no case where
    // leaving one blank here should be read as "clear it."
    if (form.anonKey.trim()) fields.anonKey = form.anonKey;
    if (form.serviceRoleKey.trim()) fields.serviceRoleKey = form.serviceRoleKey;
    return fields;
  }

  function isSensitiveChange() {
    if (!original) return false;
    const urlChanged = form.supabaseUrl.trim() !== (original.supabaseUrl || '');
    const anonKeyTyped = form.anonKey.trim().length > 0;
    const serviceRoleKeyTyped = form.serviceRoleKey.trim().length > 0;
    return urlChanged || anonKeyTyped || serviceRoleKeyTyped;
  }

  async function doSave() {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const token = await withToken();
      const result = await updateProjectAction(token, { projectId, fields: buildFieldsToSend() });
      setSaveStatus('done');
      setConfirmDialog(null);
      // Reflect the saved state back into `original`/`form` so a second
      // save in the same visit diffs against what's actually stored now,
      // not stale pre-load values — and so the key fields go back to
      // blank (never echoing back what was just saved either).
      setOriginal({
        id: result.id,
        label: result.label,
        notes: result.notes,
        supabaseUrl: result.supabaseUrl,
        hasAnonKey: result.hasAnonKey,
        hasServiceRoleKey: result.hasServiceRoleKey,
        activeClientCount: result.activeClientCount,
      });
      setForm({ label: result.label, notes: result.notes || '', supabaseUrl: result.supabaseUrl, ...blankKeyFields });
    } catch (err) {
      setSaveError(err.message);
      setSaveStatus('error');
      setConfirmDialog((d) => (d ? { ...d, confirming: false } : d));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.label.trim()) {
      setSaveError('Label cannot be blank.');
      setSaveStatus('error');
      return;
    }
    if (!form.supabaseUrl.trim()) {
      setSaveError('Supabase project URL cannot be blank.');
      setSaveStatus('error');
      return;
    }

    if (isSensitiveChange()) {
      setConfirmDialog({ confirming: false });
      return;
    }
    doSave();
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--surface)',
        padding: 'var(--space-6)',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/projects')}
          style={{ marginBottom: 'var(--space-5)' }}
        >
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to projects
        </Button>

        <h1 style={{ fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
          Edit project
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
          Change this project&apos;s own stored fields. Changing its connection details is a real
          hazard for any client already using them — see the warning below if that applies.
        </p>

        {status === 'loading' && (
          <Card padding="lg">
            <LoadingState preset="card" label="Loading project" />
          </Card>
        )}

        {status === 'error' && (
          <Card padding="lg">
            <ErrorState message={error} onRetry={load} />
          </Card>
        )}

        {status === 'ready' && original && (
          <Card padding="lg">
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {original.activeClientCount !== null && (
                <Badge tone="accent" style={{ alignSelf: 'flex-start' }}>
                  {original.activeClientCount} active {original.activeClientCount === 1 ? 'client' : 'clients'}{' '}
                  using this project
                </Badge>
              )}

              <Input
                id="label"
                label="Label"
                value={form.label}
                onChange={update('label')}
                disabled={saveStatus === 'saving'}
              />

              <Input
                id="notes"
                label="Notes"
                placeholder="Optional"
                value={form.notes}
                onChange={update('notes')}
                disabled={saveStatus === 'saving'}
                hint="Label and notes changes save directly — no extra confirmation needed."
              />

              <Input
                id="supabaseUrl"
                label="Supabase project URL"
                value={form.supabaseUrl}
                onChange={update('supabaseUrl')}
                disabled={saveStatus === 'saving'}
              />

              <Input
                id="anonKey"
                label="Anon key"
                type="password"
                placeholder={original.hasAnonKey ? 'Stored — leave blank to keep unchanged' : '(not set)'}
                value={form.anonKey}
                onChange={update('anonKey')}
                disabled={saveStatus === 'saving'}
                hint="Never shown once saved. Type a new value only to rotate it."
              />

              <Input
                id="serviceRoleKey"
                label="Service-role key"
                type="password"
                placeholder={original.hasServiceRoleKey ? 'Stored — leave blank to keep unchanged' : '(not set)'}
                value={form.serviceRoleKey}
                onChange={update('serviceRoleKey')}
                disabled={saveStatus === 'saving'}
                hint="Never shown once saved. Type a new value only to rotate it."
              />

              {saveStatus === 'done' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-success)',
                  }}
                >
                  <CheckCircle size={16} weight="bold" aria-hidden="true" />
                  Saved.
                </div>
              )}

              {saveError && (
                <p
                  role="alert"
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-danger)',
                    background: 'rgba(217, 79, 79, 0.08)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-3)',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  <Warning size={16} weight="bold" aria-hidden="true" />
                  {saveError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <Button variant="primary" type="submit" disabled={saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? 'Saving...' : 'Save changes'}
                </Button>
                <Button variant="ghost" onClick={() => router.push('/projects')} disabled={saveStatus === 'saving'}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>

      <BottomSheet
        open={Boolean(confirmDialog)}
        onClose={confirmDialog?.confirming ? undefined : () => setConfirmDialog(null)}
        title="Confirm connection-detail change"
      >
        {confirmDialog && original && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-2)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-secondary)',
                background: 'var(--surface-inset)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-inset)',
                padding: 'var(--space-3)',
                margin: 0,
              }}
            >
              <Warning size={16} weight="bold" color="var(--color-danger)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {original.activeClientCount === null ? (
                  <>An unknown number of active clients may be using this project&apos;s stored connection details.</>
                ) : (
                  <>
                    <strong>{original.activeClientCount}</strong> active{' '}
                    {original.activeClientCount === 1 ? 'client is' : 'clients are'} currently using this project&apos;s
                    stored connection details
                  </>
                )}{' '}
                — changing them here will NOT update those clients, and may cause their next sync to fail.
              </span>
            </p>

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: 0 }}>
              If you must rotate these values on a live project, affected clients will need to be
              manually re-activated — this repo cannot push new credentials out to them.
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmDialog((d) => ({ ...d, confirming: true }));
                  doSave();
                }}
                disabled={confirmDialog.confirming}
                fullWidth
              >
                {confirmDialog.confirming ? 'Saving...' : 'Save anyway'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmDialog(null)}
                disabled={confirmDialog.confirming}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </main>
  );
}
