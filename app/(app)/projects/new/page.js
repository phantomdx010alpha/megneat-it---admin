'use client';

/**
 * app/(app)/projects/new/page.js
 *
 * Phase 4 form: connect a new Supabase project to the registry, and
 * (optionally, same submit or separately) provision its schema.
 *
 * The "Postgres connection string" field is not in the masterplan's
 * literal list of form fields (label/URL/anon key/service-role key/notes)
 * — it's added here to close a real gap between that list and the same
 * phase's own provisioning requirement. See the top comment in
 * actions.js for the full reasoning.
 *
 * Updated by ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 1: this
 * field is no longer purely transient — if filled in, it's now also
 * stored on the new project's row so the schema-broadcast tool can reach
 * it later without asking again. Copy below updated to say so plainly
 * rather than leaving the old "never saved" claim in place and wrong.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Warning, ArrowRight, ArrowLeft } from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { getSession } from '@/lib/auth/session';
import { createProjectAction, provisionProjectAction } from './actions';

const initialFields = {
  label: '',
  supabaseUrl: '',
  anonKey: '',
  serviceRoleKey: '',
  notes: '',
  connectionString: '',
};

export default function NewProjectPage() {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [status, setStatus] = useState('idle'); // idle | saving | provisioning | done | error
  const [error, setError] = useState(null);
  const [savedProject, setSavedProject] = useState(null);
  const [tablesCreated, setTablesCreated] = useState(null);

  function update(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function withToken() {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      throw new Error('Session expired.');
    }
    return session.access_token;
  }

  async function handleSaveOnly(e) {
    e.preventDefault();
    setError(null);
    setStatus('saving');
    try {
      const token = await withToken();
      const project = await createProjectAction(token, fields);
      setSavedProject(project);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  async function handleSaveAndProvision(e) {
    e.preventDefault();
    setError(null);
    setTablesCreated(null);

    if (!fields.connectionString.trim()) {
      setError('Postgres connection string is required to provision (Settings → Database in the target project).');
      setStatus('error');
      return;
    }

    setStatus('saving');
    try {
      const token = await withToken();
      const project = await createProjectAction(token, fields);
      setSavedProject(project);

      setStatus('provisioning');
      const { tablesCreated } = await provisionProjectAction(token, {
        projectId: project.id,
        projectLabel: project.label,
        connectionString: fields.connectionString,
      });
      setTablesCreated(tablesCreated);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  function handleAddAnother() {
    setFields(initialFields);
    setSavedProject(null);
    setTablesCreated(null);
    setStatus('idle');
    setError(null);
  }

  const busy = status === 'saving' || status === 'provisioning';

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
        <Button variant="ghost" size="sm" onClick={() => router.push('/projects')} style={{ marginBottom: 'var(--space-5)' }}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to projects
        </Button>

        <h1
          style={{
            fontSize: 'var(--font-size-lg)',
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Add project
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
          Connect one of your Supabase projects to the registry, and optionally provision its schema.
        </p>

        {status === 'done' && savedProject ? (
          <Card padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              <CheckCircle size={20} weight="bold" color="var(--color-success)" aria-hidden="true" />
              <strong style={{ color: 'var(--text-primary)' }}>
                {savedProject.label} saved to the registry.
              </strong>
            </div>

            {tablesCreated && (
              <div
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                  background: 'rgba(80, 180, 120, 0.08)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)',
                }}
              >
                <div style={{ marginBottom: 'var(--space-1)' }}>
                  Provisioned — {tablesCreated.length} tables created:
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                  {tablesCreated.join(', ')}
                </div>
                <div style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                  Worth confirming directly in that project's own Supabase Studio too — don't
                  just trust this list.
                </div>
              </div>
            )}

            {!tablesCreated && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: 0 }}>
                Saved without provisioning. You can provision it later from the project's own row
                on the Projects screen once that's supported there, or add it again here with a
                connection string.
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)', flexWrap: 'wrap' }}>
              <Button variant="raised" onClick={handleAddAnother}>
                Add another project
              </Button>
              <Button variant="ghost" onClick={() => router.push('/projects')}>
                Back to projects
              </Button>
            </div>
          </Card>
        ) : (
          <Card padding="lg">
            <form style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Input
              id="label"
              label="Label"
              placeholder="e.g. Acme Corp — project 3"
              value={fields.label}
              onChange={update('label')}
              disabled={busy}
            />
            <Input
              id="supabaseUrl"
              label="Supabase project URL"
              placeholder="https://xxxx.supabase.co"
              value={fields.supabaseUrl}
              onChange={update('supabaseUrl')}
              disabled={busy}
            />
            <Input
              id="anonKey"
              label="Anon key"
              placeholder="eyJ..."
              value={fields.anonKey}
              onChange={update('anonKey')}
              disabled={busy}
            />
            <Input
              id="serviceRoleKey"
              label="Service-role key"
              type="password"
              placeholder="eyJ..."
              value={fields.serviceRoleKey}
              onChange={update('serviceRoleKey')}
              disabled={busy}
            />
            <Input
              id="notes"
              label="Notes"
              placeholder="Optional — e.g. which free-tier account this is on"
              value={fields.notes}
              onChange={update('notes')}
              disabled={busy}
            />

            <div>
              <Input
                id="connectionString"
                label="Postgres connection string (needed to provision, and stored for future schema pushes)"
                type="password"
                placeholder="postgres://postgres:[password]@db.xxxx.supabase.co:5432/postgres"
                value={fields.connectionString}
                onChange={update('connectionString')}
                disabled={busy}
              />
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                Settings → Database in the target project. Not the anon/service-role key — a
                separate direct-connection credential. Unlike before, this is now saved on the
                project's row (not just used in memory for this request) so that future schema
                changes can be pushed to every project at once without re-entering it — see
                ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md for why. Stored as plaintext in the
                registry database, same as the service-role key above; see
                0004_project_connection_strings.sql for that tradeoff written out in full.
              </p>
            </div>

            {error && (
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
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button variant="raised" onClick={handleSaveOnly} disabled={busy}>
                {status === 'saving' ? 'Saving...' : 'Save project'}
              </Button>
              <Button variant="primary" onClick={handleSaveAndProvision} disabled={busy}>
                {status === 'saving' && 'Saving...'}
                {status === 'provisioning' && 'Provisioning...'}
                {!busy && (
                  <>
                    Save &amp; provision <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
