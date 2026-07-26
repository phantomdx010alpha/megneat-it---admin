'use client';

/**
 * app/login/page.js
 *
 * Email/password sign-in against the registry project's Supabase Auth —
 * exactly one account (the operator's own), created manually in Supabase
 * Studio. No signup UI (ADMIN_PANEL_MASTERPLAN.md Phase 2 — single-operator
 * tool, no self-signup).
 *
 * Visually mirrors the client-facing PWA's app/login/page.js, minus the
 * mock-mode path and the post-login device-registration step (neither
 * concept applies to this app).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EnvelopeSimple, LockKey, ArrowRight } from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { signInWithPassword } from '@/lib/auth/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'signing-in' | 'error'
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('signing-in');
    setError(null);

    try {
      await signInWithPassword(email, password);
      router.push('/');
    } catch (err) {
      setError(err.message || 'Something went wrong signing in.');
      setStatus('error');
    }
  }

  const signingIn = status === 'signing-in';

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <h1
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-bold)',
              letterSpacing: 'var(--letter-spacing-tight)',
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Magneatit Admin
          </h1>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-2)',
            }}
          >
            Sign in with the admin account.
          </p>
        </div>

        <Card padding="lg">
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Input
              id="email"
              type="email"
              label="Email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={signingIn}
              prefix={<EnvelopeSimple size={16} weight="light" aria-hidden="true" />}
              autoComplete="username"
            />

            <Input
              id="password"
              type="password"
              label="Password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={signingIn}
              prefix={<LockKey size={16} weight="light" aria-hidden="true" />}
              autoComplete="current-password"
            />

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
                }}
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" fullWidth disabled={signingIn}>
              {signingIn ? 'Signing in...' : 'Sign in'}
              {!signingIn && <ArrowRight size={16} weight="bold" aria-hidden="true" />}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
