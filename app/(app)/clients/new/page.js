'use client';

/**
 * app/(app)/clients/new/page.js
 *
 * Phase 6 — the core deliverable: one form, one button, a real client
 * onboarded end to end (login + license) without ever opening Supabase
 * Studio.
 *
 * Password field defaults to "auto-generate" per the masterplan's own
 * "password manager 'we generated this for you'" framing — a manual
 * override is one click away for the rare case the operator wants to set
 * a specific password.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Warning, ArrowRight, ArrowLeft, Shuffle } from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import CopyField from '@/components/ui/CopyField';
import LoadingState from '@/components/ui/LoadingState';
import { getSession } from '@/lib/auth/session';
import { listTargetProjectOptionsAction, createClientAction } from './actions';

const initialFields = {
  email: '',
  passwordMode: 'auto', // 'auto' | 'manual'
  password: '',
  companyName: '',
  contactEmail: '',
  expiresAt: '',
  maxDevices: '5',
  projectId: '',
};

export default function NewClientPage() {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [projectOptions, setProjectOptions] = useState([]);
  const [optionsStatus, setOptionsStatus] = useState('loading'); // loading | ready | error
  const [optionsError, setOptionsError] = useState(null);

  const [status, setStatus] = useState('idle'); // idle | saving | done | error
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function withToken() {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      throw new Error('Session expired.');
    }
    return session.access_token;
  }

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      setOptionsStatus('loading');
      try {
        const token = await withToken();
        const { options, recommendedProjectId } = await listTargetProjectOptionsAction(token);
        if (cancelled) return;
        setProjectOptions(options);
        setFields((f) => ({ ...f, projectId: f.projectId || recommendedProjectId || '' }));
        setOptionsStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setOptionsError(err.message);
        setOptionsStatus('error');
      }
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  const selectOptions = projectOptions.map((p) => ({
    value: p.id,
    label: `${p.label}${p.isPaused ? ' — paused' : ''} · ${p.licenseCount} ${p.licenseCount === 1 ? 'license' : 'licenses'}`,
  }));

  const recommendedLabel = projectOptions.find((p) => p.id === fields.projectId);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setStatus('saving');
    try {
      const token = await withToken();
      const payload = {
        email: fields.email,
        password: fields.passwordMode === 'manual' ? fields.password : '',
        companyName: fields.companyName,
        contactEmail: fields.contactEmail,
        expiresAt: fields.expiresAt,
        maxDevices: Number(fields.maxDevices),
        projectId: fields.projectId,
      };
      const outcome = await createClientAction(token, payload);
      setResult(outcome);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  function handleAddAnother() {
    setFields((f) => ({ ...initialFields, projectId: f.projectId }));
    setResult(null);
    setStatus('idle');
    setError(null);
  }

  const busy = status === 'saving';

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
        {status !== 'done' && (
          <Button variant="ghost" size="sm" onClick={() => router.push('/clients')} style={{ marginBottom: 'var(--space-5)' }}>
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            Back to clients
          </Button>
        )}

        <h1
          style={{
            fontSize: 'var(--font-size-lg)',
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Add client
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
          Creates their login on the target project and registers their license — one step.
        </p>

        {status === 'done' && result ? (
          <Card padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
              <CheckCircle size={20} weight="bold" color="var(--color-success)" aria-hidden="true" />
              <strong style={{ color: 'var(--text-primary)' }}>
                {result.companyName} added to {result.projectLabel}
              </strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <CopyField label="License key" value={result.licenseKey} />
              <CopyField label="Login email" value={result.email} monospace={false} />
              {result.generatedPassword && (
                <CopyField label="Generated password" value={result.generatedPassword} />
              )}
            </div>

            {result.generatedPassword && (
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
                This password is shown once — copy it now. It isn't stored anywhere this app can
                show you again.
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              <Button variant="raised" onClick={handleAddAnother}>
                Add another client
              </Button>
              <Button variant="ghost" onClick={() => router.push('/projects')}>
                Back to projects
              </Button>
            </div>
          </Card>
        ) : (
          <Card padding="lg">
            <form
              onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
            >
              <Input
                id="companyName"
                label="Company name"
                placeholder="e.g. Acme Corp"
                value={fields.companyName}
                onChange={update('companyName')}
                disabled={busy}
              />

              <Input
                id="email"
                label="Login email"
                type="email"
                placeholder="client@example.com"
                value={fields.email}
                onChange={update('email')}
                disabled={busy}
                hint="This is what the client signs into the shell/PWA with."
              />

              <Input
                id="contactEmail"
                label="Contact email (optional)"
                type="email"
                placeholder="Defaults to the login email above"
                value={fields.contactEmail}
                onChange={update('contactEmail')}
                disabled={busy}
              />

              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--font-weight-semibold)',
                      color: 'var(--text-secondary)',
                      letterSpacing: 'var(--letter-spacing-wider)',
                      textTransform: 'uppercase',
                    }}
                  >
                    Password
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      setFields((f) => ({
                        ...f,
                        passwordMode: f.passwordMode === 'auto' ? 'manual' : 'auto',
                        password: '',
                      }))
                    }
                  >
                    <Shuffle size={14} weight="bold" aria-hidden="true" />
                    {fields.passwordMode === 'auto' ? 'Set manually instead' : 'Auto-generate instead'}
                  </Button>
                </div>

                {fields.passwordMode === 'auto' ? (
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: 0 }}>
                    A strong password will be generated and shown once after you submit.
                  </p>
                ) : (
                  <Input
                    id="password"
                    type="password"
                    placeholder="Set a password for this client"
                    value={fields.password}
                    onChange={update('password')}
                    disabled={busy}
                  />
                )}
              </div>

              <Input
                id="expiresAt"
                label="Expires (optional)"
                type="date"
                value={fields.expiresAt}
                onChange={update('expiresAt')}
                disabled={busy}
                hint="Leave blank for no expiry."
              />

              <Input
                id="maxDevices"
                label="Max devices"
                type="number"
                min="1"
                value={fields.maxDevices}
                onChange={update('maxDevices')}
                disabled={busy}
              />

              <div>
                {optionsStatus === 'loading' && <LoadingState preset="inline" label="Loading projects" />}

                {optionsStatus === 'error' && (
                  <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                    Could not load projects: {optionsError}
                  </p>
                )}

                {optionsStatus === 'ready' && projectOptions.length === 0 && (
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                    No projects connected yet —{' '}
                    <a href="/projects/new" style={{ color: 'var(--accent)' }}>
                      add one first
                    </a>
                    .
                  </p>
                )}

                {optionsStatus === 'ready' && projectOptions.length > 0 && (
                  <Select
                    label="Target project"
                    options={selectOptions}
                    value={fields.projectId}
                    onChange={(value) => setFields((f) => ({ ...f, projectId: value }))}
                    placeholder="Pick a project"
                    disabled={busy}
                    hint={
                      recommendedLabel?.isPaused
                        ? 'This project is marked paused/full — it will still work, but was not the suggested pick.'
                        : 'Defaults to the connected project with the fewest licenses.'
                    }
                  />
                )}
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
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                  }}
                >
                  <Warning size={16} weight="bold" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                disabled={busy || optionsStatus !== 'ready' || projectOptions.length === 0}
                fullWidth
              >
                {busy ? (
                  'Creating client...'
                ) : (
                  <>
                    Create client <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>
          </Card>
        )}

        {status === 'done' && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Badge tone="accent">Done — credentials shown above won't be shown again</Badge>
          </div>
        )}
      </div>
    </main>
  );
}
